// server.js -- The GENERIC ENGINE of the platform.
//
// Responsibilities (and ONLY these):
//   1. Serve the web pages (homepage, host view, player view).
//   2. Manage rooms + the real-time link between the host and the players,
//      INCLUDING reconnection: each person has a stable "seat" (a token). If
//      their socket drops (reload, network blip), their seat is kept for a grace
//      period so they can rejoin the SAME place (same role/hand). The host has an
//      equivalent token so a host reload no longer closes the room.
//
// It knows NOTHING about how a game is played. Game logic lives in game modules;
// players are identified to the modules by their stable seatId (never a socket).

const express = require("express");
const http = require("http");
const crypto = require("crypto");
const { Server } = require("socket.io");
const path = require("path");
const fs = require("fs");
// Pixel-art avatars (shared with the browsers): used to CHECK what a browser
// sends and to give bots a face. Each seat (and the host) carries one.
const PixelAvatar = require("./public/js/pixel-avatar.js");
const cleanAvatar = (a) => PixelAvatar.clean(a) || PixelAvatar.random();
// "Léa", "lea" and "LEA " are the same name (no look-alike duplicates in a room).
const sameName = (a, b) => String(a).normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase() ===
  String(b).normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
// Avatar / name changes: at most one every 1.5 s per connection.
function tooFast(socket, key) {
  const now = Date.now();
  socket.data.lastChange = socket.data.lastChange || {};
  if (now - (socket.data.lastChange[key] || 0) < 1500) return true;
  socket.data.lastChange[key] = now;
  return false;
}
// Tells the game that a player's name or avatar changed (so it refreshes).
function playerUpdated(room, seatId) {
  const module = gameModules[room.gameId];
  if (!room.gameState || !module) return;
  if (module.onPlayerUpdate) module.onPlayerUpdate(makeApi(room), room, seatId);
  else if (module.onAvatarChange) module.onAvatarChange(makeApi(room), room, seatId);
}
// The engine loads every game from its own folder under /games (see the loader).
const { games, getGameById, gameModules } = require("./engine/games-loader");

// ----- Player feedback -----
// Feedback typed in-game is sent HERE. It always goes to the server logs and a
// local file (feedback.log); if a Discord webhook URL is configured it is ALSO
// posted to that channel (the recommended "shared folder"). Set the webhook in
// Render: Environment -> add  FEEDBACK_WEBHOOK = https://discord.com/api/webhooks/...
const FEEDBACK_WEBHOOK = process.env.FEEDBACK_WEBHOOK || "";
function recordFeedback(f) {
  const line = `[FEEDBACK] ${f.at} | ${f.game} | salle ${f.code} | ${f.who}: ${f.text}`;
  console.log(line);
  try { fs.appendFileSync(path.join(__dirname, "feedback.log"), line + "\n"); } catch (e) {}
  if (FEEDBACK_WEBHOOK && typeof fetch === "function") {
    const content = `📝 **Feedback** — *${f.game}* (salle ${f.code})\n**${f.who}** : ${f.text}`;
    // allowed_mentions: {parse:[]} stops any @everyone / @here injection.
    fetch(FEEDBACK_WEBHOOK, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: content.slice(0, 1900), allowed_mentions: { parse: [] } }),
    }).catch(() => {});
  }
}

const app = express();
// Render (and most hosts) sit behind a proxy: trust it so req.ip is the real
// visitor IP (needed by the per-IP anti-abuse limiter of the music service).
app.set("trust proxy", 1);
const server = http.createServer(app);
const io = new Server(server, {
  // A message from a browser is never bigger than a few KB here: refuse bigger
  // ones (default is 1 MB) so nobody can flood the server's memory.
  maxHttpBufferSize: 64 * 1024,
  // Compress big real-time messages (end-of-game recap, settings...). Small ones
  // (a vote) are sent as is: compressing them would cost more than it saves.
  perMessageDeflate: { threshold: 2048 },
});

const PORT = process.env.PORT || 3000;
// How long a seat (or the host slot) is kept after a disconnect, in ms.
const GRACE_MS = Number(process.env.GRACE_MS) || 90000;

// Compress everything the server sends (HTML, JS, CSS, JSON): files get ~3-4x
// lighter, so pages load faster on phones. Audio/images are skipped (already
// compressed formats).
app.use(require("compression")());

// Browser cache. Images, sounds and fonts rarely change: the browser keeps them
// 1 hour (long enough for an evening, short enough that a replaced image shows
// up quickly). Code and pages (html/js/css) are always re-checked, but answered
// with a tiny "not modified" when unchanged, so an update is seen at once.
function cacheHeaders(res, filePath) {
  if (/\.(png|jpe?g|gif|webp|svg|ico|mp3|wav|ogg|m4a|woff2?|ttf)$/i.test(filePath)) {
    res.setHeader("Cache-Control", "public, max-age=3600");
  } else {
    res.setHeader("Cache-Control", "no-cache");
  }
}
app.use(express.static(path.join(__dirname, "public"), { setHeaders: cacheHeaders }));
// Each game's browser code lives in its own folder (games/<id>/client/*.js) and
// is loaded on demand by the active game only (see public/js/game-loader.js).
app.use("/games", express.static(path.join(__dirname, "games"), { setHeaders: cacheHeaders }));

app.get("/api/games", (req, res) => res.json(games));
app.get("/api/games/:id", (req, res) => {
  const game = getGameById(req.params.id);
  if (!game) return res.status(404).json({ error: "Game not found" });
  res.json(game);
});

// ----- Generic music service (used by music games like Kietkoutsa) -----
// Search (Deezer + iTunes fallback), trending charts, and a safe preview proxy.
// All the logic is in engine/music.js; it is game-agnostic and reusable.
const music = require("./engine/music");
music.mount(app);

// ----- Read the collected feedback (protected page) -----
// Open  /admin/feedback?key=YOUR_KEY  in a browser to read every retour.
// The key is "gamenight" unless you set FEEDBACK_KEY in Render's Environment.
// NOTE: the file lives on Render's disk, which is WIPED on every redeploy -> read
// it before pushing an update if you want to keep older retours.
const FEEDBACK_KEY = process.env.FEEDBACK_KEY || "gamenight";
function escHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}
app.get("/admin/feedback", (req, res) => {
  if ((req.query.key || "") !== FEEDBACK_KEY) {
    return res.status(403).send("Acces refuse. Ajoute  ?key=TON_MOT_DE_PASSE  a l'URL.");
  }
  let raw = "";
  try { raw = fs.readFileSync(path.join(__dirname, "feedback.log"), "utf8"); } catch (e) {}
  const lines = raw.split("\n").filter(Boolean).reverse(); // newest first
  const items = lines.map((l) => `<li>${escHtml(l)}</li>`).join("") ||
    "<li><em>Aucun retour pour l'instant.</em></li>";
  res.send(`<!doctype html><html lang="fr"><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>Retours — Game Night</title>
    <style>body{font:15px/1.55 system-ui,sans-serif;margin:0;background:#0f172a;color:#e5edff;padding:24px;}
    h1{font-size:1.4rem;margin:0 0 4px;}.note{opacity:.7;font-size:.85rem;margin:0 0 18px;max-width:900px;}
    ul{list-style:none;padding:0;max-width:900px;margin:0;}
    li{background:#1a2340;border:1px solid #2b365e;border-radius:10px;padding:10px 14px;margin:8px 0;word-break:break-word;}</style>
    </head><body><h1>📝 Retours des joueurs (${lines.length})</h1>
    <p class="note">Du plus récent au plus ancien. ⚠️ Cette liste est remise à zéro à chaque redéploiement du serveur (chaque mise en ligne) — relis-la avant de pousser une mise à jour si tu veux garder les anciens.</p>
    <ul>${items}</ul></body></html>`);
});

// ----- Rooms state (in memory) -----
// rooms[CODE] = { code, gameId, hostToken, hostSocketId, hostGrace,
//                 players: [{ seatId, name, socketId, connected, grace }],
//                 gameState }
const rooms = {};

// The emojis allowed for live reactions (keep in sync with public/js/reactions.js).
const REACTIONS = ["🔥", "😂", "😍", "🤯", "💀", "🤮", "👏", "🥱"];

function token() { return crypto.randomBytes(9).toString("hex"); }

function generateRoomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // no I / O to avoid confusion
  let code;
  do {
    code = "";
    for (let i = 0; i < 4; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)];
  } while (rooms[code]);
  return code;
}

// The public player list (names + connection state) sent to the lobby views.
function publicPlayers(room) {
  return room.players.map((p) => ({ id: p.seatId, name: p.name, connected: p.connected, avatar: p.avatar, isBot: !!p.isBot }));
}
function broadcastPlayers(room) {
  io.to(room.code).emit("room:playersUpdate", { players: publicPlayers(room), hostAvatar: room.hostAvatar });
}

// The "api" is the ONLY way a game module talks to the browsers. Players are
// addressed by their stable seatId; the api routes to their CURRENT socket.
function makeApi(room) {
  return {
    players: () => room.players.map((p) => ({ id: p.seatId, name: p.name, avatar: p.avatar, isBot: !!p.isBot, hostDevice: !!p.hostDevice })),
    hostAvatar: () => room.hostAvatar,
    connected: (seatId) => {
      const p = room.players.find((x) => x.seatId === seatId);
      return !!(p && p.connected);
    },
    toHost: (event, data) => { if (room.hostSocketId) io.to(room.hostSocketId).emit(event, data); },
    toPlayer: (seatId, event, data) => {
      const p = room.players.find((x) => x.seatId === seatId);
      if (p && p.connected && p.socketId) io.to(p.socketId).emit(event, data);
    },
    toAll: (event, data) => io.to(room.code).emit(event, data),
    // Shared engine services a game may use (none of them know any game rules).
    music,
    now: () => Date.now(),
  };
}

function closeRoom(room, message) {
  if (!rooms[room.code]) return;
  if (room.hostGrace) clearTimeout(room.hostGrace);
  room.players.forEach((p) => { if (p.grace) clearTimeout(p.grace); });
  io.to(room.code).emit("room:closed", { message: message || "La salle est fermee." });
  delete rooms[room.code];
  console.log(`[room ${room.code}] closed`);
}

io.on("connection", (socket) => {
  // ---------- HOST: create a room ----------
  socket.on("host:createRoom", ({ gameId, avatar } = {}) => {
    const game = getGameById(gameId);
    if (!game) return socket.emit("room:error", { message: "Unknown game." });

    const code = generateRoomCode();
    rooms[code] = {
      code, gameId, hostToken: token(), hostSocketId: socket.id,
      hostGrace: null, players: [], gameState: null, hostAvatar: cleanAvatar(avatar),
    };
    socket.join(code);
    socket.data = { role: "host", code };
    socket.emit("room:created", { code, hostToken: rooms[code].hostToken, game });
    console.log(`[room ${code}] created for "${gameId}"`);
  });

  // ---------- HOST: reconnect to an existing room ----------
  socket.on("host:reconnect", ({ code, hostToken, avatar } = {}) => {
    const room = rooms[String(code || "").toUpperCase()];
    if (!room || room.hostToken !== hostToken) {
      return socket.emit("host:reconnectFailed", {});
    }
    if (room.hostGrace) { clearTimeout(room.hostGrace); room.hostGrace = null; }
    room.hostSocketId = socket.id;
    if (avatar) room.hostAvatar = cleanAvatar(avatar);
    socket.join(room.code);
    socket.data = { role: "host", code: room.code };
    socket.emit("host:reconnected", {
      code: room.code, game: getGameById(room.gameId),
      players: publicPlayers(room), inGame: !!room.gameState,
    });
    io.to(room.code).emit("room:hostStatus", { connected: true });
    const module = gameModules[room.gameId];
    if (room.gameState && module && module.onReconnect) {
      module.onReconnect(makeApi(room), room, { isHost: true });
    }
    console.log(`[room ${room.code}] host reconnected`);
  });

  // ---------- PLAYER: join a room ----------
  socket.on("player:join", ({ code, name, avatar, hostDevice } = {}) => {
    code = String(code || "").toUpperCase().trim();
    name = String(name || "").trim();
    const room = rooms[code];
    if (!room) return socket.emit("join:error", { message: "Ce code de salle n'existe pas." });
    if (!name) return socket.emit("join:error", { message: "Choisis un pseudo." });
    // Joining a running game is refused, UNLESS the game module says it can
    // welcome late players (module.allowLateJoin(room) returns true).
    const module = gameModules[room.gameId];
    const lateJoin = !!room.gameState;
    if (lateJoin && !(module && typeof module.allowLateJoin === "function" && module.allowLateJoin(room))) {
      return socket.emit("join:error", { message: "La partie a déjà commencé." });
    }
    if (name.length > 16) name = name.slice(0, 16);
    if (room.players.some((p) => sameName(p.name, name))) {
      return socket.emit("join:error", { message: "Ce pseudo est déjà pris ici." });
    }

    // hostDevice = this phone is ALSO the host's device (the host plays from it)
    const seat = { seatId: token(), name, socketId: socket.id, connected: true, grace: null, avatar: cleanAvatar(avatar), hostDevice: !!hostDevice };
    room.players.push(seat);
    socket.join(code);
    socket.data = { role: "player", code, seatId: seat.seatId };
    socket.emit("join:success", {
      code, game: getGameById(room.gameId), you: { id: seat.seatId, name, avatar: seat.avatar },
      seatId: seat.seatId, inGame: lateJoin,
    });
    broadcastPlayers(room);
    // Late arrival: let the game module seat this new player (it decides how).
    if (lateJoin && module.onPlayerJoin) module.onPlayerJoin(makeApi(room), room, seat.seatId);
    console.log(`[room ${code}] "${name}" joined (${room.players.length})`);
  });

  // ---------- PLAYER: reconnect to a seat ----------
  socket.on("player:reconnect", ({ code, seatId }) => {
    const room = rooms[String(code || "").toUpperCase()];
    const seat = room && room.players.find((p) => p.seatId === seatId);
    if (!room || !seat) return socket.emit("reconnect:failed", {});

    if (seat.grace) { clearTimeout(seat.grace); seat.grace = null; }
    seat.socketId = socket.id;
    seat.connected = true;
    socket.join(room.code);
    socket.data = { role: "player", code: room.code, seatId };
    socket.emit("reconnect:success", {
      code: room.code, game: getGameById(room.gameId),
      you: { id: seatId, name: seat.name, avatar: seat.avatar }, seatId, inGame: !!room.gameState,
    });
    broadcastPlayers(room);
    const module = gameModules[room.gameId];
    if (room.gameState && module && module.onReconnect) {
      module.onReconnect(makeApi(room), room, { seatId });
    }
    console.log(`[room ${room.code}] "${seat.name}" reconnected`);
  });

  // ---------- Changing one's avatar (lobby or during a game) ----------
  // The game module is told (onPlayerUpdate, old name onAvatarChange) so it can refresh its screens.
  socket.on("player:setAvatar", ({ avatar } = {}) => {
    const room = rooms[socket.data.code];
    if (!room || socket.data.role !== "player" || tooFast(socket, "avatar")) return;
    const seat = room.players.find((p) => p.seatId === socket.data.seatId);
    const clean = PixelAvatar.clean(avatar);
    if (!seat || !clean) return;
    seat.avatar = clean;
    broadcastPlayers(room);
    playerUpdated(room, seat.seatId);
  });
  // Changing one's name (from the lobby or a game). Same rules as joining.
  socket.on("player:rename", ({ name } = {}) => {
    const room = rooms[socket.data.code];
    if (!room || socket.data.role !== "player" || tooFast(socket, "name")) return;
    const seat = room.players.find((p) => p.seatId === socket.data.seatId);
    name = String(name || "").trim().slice(0, 16);
    if (!seat || !name) return;
    if (room.players.some((p) => p !== seat && sameName(p.name, name))) return socket.emit("rename:error", { message: "Ce pseudo est déjà pris ici." });
    seat.name = name;
    socket.emit("rename:ok", { name });
    broadcastPlayers(room);
    playerUpdated(room, seat.seatId);
  });
  socket.on("host:setAvatar", ({ avatar } = {}) => {
    const room = rooms[socket.data.code];
    const clean = PixelAvatar.clean(avatar);
    if (!room || socket.data.role !== "host" || !clean || tooFast(socket, "avatar")) return;
    room.hostAvatar = clean;
    broadcastPlayers(room);
    playerUpdated(room, "__host__");
  });

  // ---------- Leaving on purpose (back to the menu) ----------
  socket.on("player:leave", () => {
    const room = rooms[socket.data.code];
    if (!room || socket.data.role !== "player") return;
    const seat = room.players.find((p) => p.seatId === socket.data.seatId);
    if (!seat) return;
    if (seat.grace) clearTimeout(seat.grace);
    room.players = room.players.filter((p) => p.seatId !== seat.seatId);
    const module = gameModules[room.gameId];
    if (room.gameState && module && module.onPlayerLeave) {
      module.onPlayerLeave(makeApi(room), room, seat.seatId);
    }
    broadcastPlayers(room);
    socket.leave(room.code);
    socket.data = {};
    console.log(`[room ${room.code}] "${seat.name}" left on purpose`);
  });
  socket.on("host:leave", () => {
    const room = rooms[socket.data.code];
    if (room && socket.data.role === "host") closeRoom(room, "L'host a ferme la salle.");
  });

  // ---------- HOST: start the game ----------
  socket.on("host:startGame", () => {
    const room = rooms[socket.data.code];
    if (!room || socket.data.role !== "host") return;
    const module = gameModules[room.gameId];
    if (!module) return socket.emit("game:error", { message: "Ce jeu n'a pas encore de regles (bientot !)." });
    if (room.players.length < (module.minPlayers || 1)) {
      return socket.emit("game:error", { message: `Il faut au moins ${module.minPlayers} joueurs pour lancer.` });
    }
    module.start(makeApi(room), room);
    io.to(room.code).emit("game:started", { gameId: room.gameId });
    console.log(`[room ${room.code}] game "${room.gameId}" started`);
  });

  // ---------- HOST: add a BOT (dev/solo testing) ----------
  // A bot is a seat with no socket: connected:true so it counts as a player, and
  // isBot:true so a game module can drive it (submit/vote automatically).
  // In the lobby always; during a game only if the game accepts late arrivals
  // (module.allowLateJoin). Kietkoutsa, Cascade and Undercover drive their bots.
  socket.on("host:addBot", () => {
    const room = rooms[socket.data.code];
    if (!room || socket.data.role !== "host") return;
    const module = gameModules[room.gameId];
    const late = !!room.gameState;
    if (late && !(module && typeof module.allowLateJoin === "function" && module.allowLateJoin(room))) return;
    if (room.players.length >= 10) return;
    const n = room.players.filter((p) => p.isBot).length + 1;
    let name = "Bot " + n;
    while (room.players.some((p) => sameName(p.name, name))) name += "*";
    const seat = { seatId: token(), name, socketId: null, connected: true, grace: null, isBot: true, avatar: PixelAvatar.random() };
    room.players.push(seat);
    broadcastPlayers(room);
    if (late && module.onPlayerJoin) module.onPlayerJoin(makeApi(room), room, seat.seatId);
    console.log(`[room ${room.code}] bot added (${room.players.length})`);
  });

  // ---------- HOST: cheat ----------
  socket.on("host:cheat", ({ cheatId }) => {
    const room = rooms[socket.data.code];
    if (!room || socket.data.role !== "host") return;
    const game = getGameById(room.gameId);
    const cheat = game && game.cheats ? game.cheats.find((c) => c.id === cheatId) : null;
    if (!cheat) return;
    // A cheat marked `secret: true` in the game's meta.js is shown on the host
    // screen only; the others are announced to everyone (the fun of it).
    if (cheat.secret) socket.emit("game:cheat", { cheat });
    else io.to(room.code).emit("game:cheat", { cheat });
    const module = gameModules[room.gameId];
    if (room.gameState && module && module.onCheat) module.onCheat(makeApi(room), room, cheatId);
  });

  // ---------- In-game action ----------
  socket.on("game:action", ({ type, payload } = {}) => {
    const room = rooms[socket.data.code];
    if (!room || !room.gameState) return;
    // Anti-spam: each connection gets 15 quick actions, then 8 per second.
    // Extra clicks are simply ignored (a normal player never reaches that).
    const now = Date.now();
    const b = socket.data.bucket || { tokens: 15, t: now };
    b.tokens = Math.min(15, b.tokens + ((now - b.t) / 1000) * 8);
    b.t = now;
    socket.data.bucket = b;
    if (b.tokens < 1) return;
    b.tokens -= 1;
    const module = gameModules[room.gameId];
    if (!module || !module.handle) return;
    const actor = { isHost: socket.data.role === "host", seatId: socket.data.seatId || null };
    module.handle(makeApi(room), actor, room, type, payload);
  });

  // ---------- Client bundle loaded -> push it the current state ----------
  // A game's browser code is now loaded ON DEMAND, so its socket listeners attach
  // AFTER the room may already have broadcast. When the bundle is ready it asks
  // for a resync, and we replay the current state to it (same path as reconnect).
  socket.on("game:sync", () => {
    const room = rooms[socket.data.code];
    if (!room || !room.gameState) return;
    const module = gameModules[room.gameId];
    if (!module || !module.onReconnect) return;
    const who = socket.data.role === "host" ? { isHost: true } : { seatId: socket.data.seatId };
    module.onReconnect(makeApi(room), room, who);
  });

  // ---------- Clock sync ----------
  // Browsers ask "what time is it on the server?" so that everyone can start a
  // sound at the SAME instant (each computer's clock is a bit different).
  socket.on("clock:ping", (cb) => { if (typeof cb === "function") cb(Date.now()); });

  // ---------- Live emoji reactions (generic, opt-in per game) ----------
  // A game turns them on with `reactions: true` in its meta.js. Anyone in the
  // room sends one emoji from a fixed list; everyone receives it with a name.
  socket.on("room:react", ({ emoji } = {}) => {
    const room = rooms[socket.data.code];
    if (!room || !room.gameState) return;
    const game = getGameById(room.gameId);
    if (!game || !game.reactions || !REACTIONS.includes(emoji)) return;
    const now = Date.now();
    if (socket.data.lastReact && now - socket.data.lastReact < 600) return; // anti-spam
    socket.data.lastReact = now;
    let name = "Host";
    if (socket.data.role === "player") {
      const p = room.players.find((x) => x.seatId === socket.data.seatId);
      name = p ? p.name : "?";
    }
    io.to(room.code).emit("room:reaction", { emoji, name });
  });

  // ---------- Player feedback (in-game "Feedback" button) ----------
  socket.on("feedback", ({ text } = {}) => {
    if (typeof text !== "string") return;
    text = text.trim().replace(/\s+\n/g, "\n").slice(0, 1000);
    if (!text) return;
    const now = Date.now();
    if (socket.data.lastFeedback && now - socket.data.lastFeedback < 4000) return; // anti-spam
    socket.data.lastFeedback = now;
    const room = rooms[socket.data.code];
    let who = "Anonyme", game = "?", code = socket.data.code || "?";
    if (room) {
      game = room.gameId;
      if (socket.data.role === "host") who = "Host";
      else {
        const p = room.players.find((x) => x.seatId === socket.data.seatId);
        who = p ? p.name : "Joueur";
      }
    }
    recordFeedback({ who, game, code, text, at: new Date().toISOString() });
    socket.emit("feedback:ok");
  });

  // ---------- Disconnect: start a grace timer, don't drop immediately ----------
  socket.on("disconnect", () => {
    const room = rooms[socket.data.code];
    if (!room) return;

    if (socket.data.role === "host" && room.hostSocketId === socket.id) {
      room.hostSocketId = null;
      io.to(room.code).emit("room:hostStatus", { connected: false });
      room.hostGrace = setTimeout(() => closeRoom(room, "L'host n'est pas revenu."), GRACE_MS);
      console.log(`[room ${room.code}] host disconnected (grace)`);
    } else if (socket.data.role === "player") {
      const seat = room.players.find((p) => p.seatId === socket.data.seatId);
      if (!seat || seat.socketId !== socket.id) return; // already replaced/left
      seat.connected = false;
      seat.socketId = null;
      broadcastPlayers(room);
      seat.grace = setTimeout(() => {
        room.players = room.players.filter((p) => p.seatId !== seat.seatId);
        const module = gameModules[room.gameId];
        if (room.gameState && module && module.onPlayerLeave) {
          module.onPlayerLeave(makeApi(room), room, seat.seatId);
        }
        broadcastPlayers(room);
        console.log(`[room ${room.code}] "${seat.name}" removed (grace expired)`);
      }, GRACE_MS);
      console.log(`[room ${room.code}] "${seat.name}" disconnected (grace)`);
    }
  });
});

// ---------- Health check ----------
app.get("/healthz", (req, res) => res.type("text").send("ok"));

// ---------- Stay awake during game nights (Render free plan) ----------
// Render puts the free site to sleep after 15 min without visits; waking it takes
// ~1 min. While at least one room exists (and 20 min after the last one), the
// server visits its own public address every 10 min so it stays awake between
// games. With no room, it lets itself sleep as usual (saves the free hours).
// RENDER_EXTERNAL_URL is set automatically by Render.
const SELF_URL = process.env.RENDER_EXTERNAL_URL || "";
let lastRoomAt = 0;
if (SELF_URL && typeof fetch === "function") {
  setInterval(() => {
    if (Object.keys(rooms).length) lastRoomAt = Date.now();
    if (Date.now() - lastRoomAt < 20 * 60 * 1000) fetch(SELF_URL + "/healthz").catch(() => {});
  }, 10 * 60 * 1000).unref();
}

// ---------- Restart warning ----------
// When Render deploys an update it stops this server (signal SIGTERM). Rooms live
// in memory, so running games are lost: we at least warn everyone, so nobody
// thinks the game just froze.
let stopping = false;
process.on("SIGTERM", () => {
  if (stopping) return;
  stopping = true;
  io.emit("server:restarting", { message: "Le site redemarre pour une mise a jour : la partie en cours va s'arreter. Recharge la page dans 1 minute." });
  setTimeout(() => process.exit(0), 1500);
});

server.listen(PORT, () => console.log(`Game Night server running on http://localhost:${PORT}`));
