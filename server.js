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
// Calls a function of the room's game module SAFELY: if the game has a bug and
// throws an error, we log it and warn the host screen, but the server keeps
// running (before, one error in one game stopped the whole site, every room).
function callGame(room, fn, ...args) {
  const module = gameModules[room.gameId];
  if (!module || typeof module[fn] !== "function") return undefined;
  try {
    // handle() is the only one with another order: handle(api, actor, room, type, payload)
    if (fn === "handle") return module.handle(makeApi(room), args[0], room, args[1], args[2]);
    return module[fn](makeApi(room), room, ...args);
  } catch (e) {
    console.error(`[room ${room.code}] ERREUR dans le jeu "${room.gameId}" (${fn}) :`, e && e.stack || e);
    if (room.hostSocketId) io.to(room.hostSocketId).emit("game:error", { message: "Petit souci dans le jeu (action ignorée). Si ça bloque, relance une partie." });
    return undefined;
  }
}
// Tells the game that a player's name or avatar changed (so it refreshes).
function playerUpdated(room, seatId) {
  const module = gameModules[room.gameId];
  if (!room.gameState || !module) return;
  if (module.onPlayerUpdate) callGame(room, "onPlayerUpdate", seatId);
  else callGame(room, "onAvatarChange", seatId);
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

// playable = the game has rules (a module); the others are "coming soon" cards.
app.get("/api/games", (req, res) => res.json(games.map((g) => Object.assign({ playable: !!gameModules[g.id] }, g))));
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
// The key is the FEEDBACK_KEY setting in Render (Environment). There is NO
// default any more: the code is public on GitHub, so a default would be known
// by everyone. Without the setting, the page stays closed.
// NOTE: the file lives on Render's disk, which is WIPED on every redeploy -> read
// it before pushing an update if you want to keep older retours.
const FEEDBACK_KEY = process.env.FEEDBACK_KEY || "";
function escHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}
// /admin?key=...  -> the rooms in progress (who plays what) + link to the feedback.
app.get("/admin", (req, res) => {
  if (!FEEDBACK_KEY) return res.status(503).type("text").send("Page fermée : ajoute un mot de passe FEEDBACK_KEY dans Render (Environment).");
  if ((req.query.key || "") !== FEEDBACK_KEY) return res.status(403).type("text").send("Accès refusé. Ajoute ?key=TON_MOT_DE_PASSE à l'adresse.");
  const list = Object.values(rooms);
  const rows = list.map((r) => {
    const g = getGameById(r.gameId) || { name: r.gameId };
    const ppl = r.players.map((p) => escHtml(p.name) + (p.isBot ? " (bot)" : "") + (p.spectator ? " (spect.)" : "") + (p.connected ? "" : " ⚠")).join(", ");
    const phase = r.gameState ? (r.gameState.phase || "en jeu") : "hall";
    return `<tr><td><b>${r.code}</b></td><td>${escHtml(g.name)}</td><td>${escHtml(phase)}${r.paused ? " ⏸" : ""}</td><td>${r.hostSocketId ? "✅" : "⚠ absent"}</td><td>${ppl || "—"}</td></tr>`;
  }).join("") || `<tr><td colspan="5"><em>Aucune salle ouverte.</em></td></tr>`;
  const mb = Math.round(process.memoryUsage().rss / 1048576);
  const up = Math.round(process.uptime() / 60);
  res.send(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <meta http-equiv="refresh" content="20"><title>Admin — Game Night</title>
    <style>body{font:15px/1.5 system-ui,sans-serif;margin:0;background:#0f172a;color:#e5edff;padding:24px}
    table{border-collapse:collapse;width:100%;max-width:1100px}td,th{border-bottom:1px solid #2b365e;padding:8px 10px;text-align:left;vertical-align:top}
    th{opacity:.7;font-weight:600}a{color:#7cc4ff}.note{opacity:.7;font-size:.85rem}.wrap{overflow-x:auto}</style></head><body>
    <h1 style="margin:0 0 4px">Game Night — admin</h1>
    <p class="note">${list.length} salle(s) · serveur allumé depuis ${up} min · mémoire ${mb} Mo · se rafraîchit toutes les 20 s · <a href="/admin/feedback?key=${encodeURIComponent(req.query.key)}">Lire les retours</a></p>
    <div class="wrap"><table><tr><th>Salle</th><th>Jeu</th><th>Étape</th><th>Host</th><th>Joueurs</th></tr>${rows}</table></div></body></html>`);
});

app.get("/admin/feedback", (req, res) => {
  if (!FEEDBACK_KEY) {
    return res.status(503).type("text").send("Page fermée : ajoute un mot de passe FEEDBACK_KEY dans Render (Environment), puis ouvre /admin/feedback?key=TON_MOT_DE_PASSE");
  }
  if ((req.query.key || "") !== FEEDBACK_KEY) {
    return res.status(403).type("text").send("Accès refusé. Ajoute ?key=TON_MOT_DE_PASSE à l'adresse.");
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

// Room creation limits (anti-abuse): a script could otherwise create thousands
// of rooms and fill the server's memory. A real host creates one or two.
const MAX_ROOMS = 300;               // whole server
const ROOMS_PER_IP = 10;             // per visitor (IP address) ...
const ROOMS_WINDOW_MS = 10 * 60000;  // ... every 10 minutes
const roomsByIp = new Map();         // ip -> [creation times]
function ipOf(socket) {
  const fwd = String(socket.handshake.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return fwd || socket.handshake.address || "?";
}
function canCreateRoom(socket) {
  if (Object.keys(rooms).length >= MAX_ROOMS) return "Le site est plein pour le moment, réessaie dans quelques minutes.";
  const ip = ipOf(socket), now = Date.now();
  const list = (roomsByIp.get(ip) || []).filter((t) => now - t < ROOMS_WINDOW_MS);
  if (list.length >= ROOMS_PER_IP) return "Trop de salles créées d'un coup. Attends quelques minutes.";
  list.push(now); roomsByIp.set(ip, list);
  return null;
}
setInterval(() => { // forget old entries
  const now = Date.now();
  for (const [ip, l] of roomsByIp) { const k = l.filter((t) => now - t < ROOMS_WINDOW_MS); if (k.length) roomsByIp.set(ip, k); else roomsByIp.delete(ip); }
}, ROOMS_WINDOW_MS).unref();

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
  return room.players.map((p) => ({ id: p.seatId, name: p.name, connected: p.connected, avatar: p.avatar, isBot: !!p.isBot,
    ready: !!p.ready, spectator: !!p.spectator }));
}
function broadcastPlayers(room) {
  io.to(room.code).emit("room:playersUpdate", { players: publicPlayers(room), hostAvatar: room.hostAvatar, inGame: !!room.gameState });
}
// Seats that PLAY (spectators only watch until the next game).
const playing = (room) => room.players.filter((p) => !p.spectator);

// A player removed after the grace delay can take their place back with the
// same name for 10 minutes (same seat id: same avatar, and a game that welcomes
// late players seats them again).
const RETURN_MS = 10 * 60000;
function rememberDeparted(room, seat) {
  room.departed = (room.departed || []).filter((d) => Date.now() - d.at < RETURN_MS && !sameName(d.name, seat.name));
  room.departed.push({ name: seat.name, seatId: seat.seatId, avatar: seat.avatar, at: Date.now() });
}
function takeDeparted(room, name) {
  const list = (room.departed || []).filter((d) => Date.now() - d.at < RETURN_MS);
  const d = list.find((x) => sameName(x.name, name));
  room.departed = list.filter((x) => x !== d);
  return d || null;
}
// Back to the lobby: the game stops, spectators become players.
function stopGame(room) {
  if (room.gameState) callGame(room, "onClose");
  room.gameState = null;
  room.paused = false;
  room.players.forEach((p) => { p.spectator = false; p.ready = false; });
  io.to(room.code).emit("game:stopped", {});
  broadcastPlayers(room);
}

// The "api" is the ONLY way a game module talks to the browsers. Players are
// addressed by their stable seatId; the api routes to their CURRENT socket.
function makeApi(room) {
  return {
    players: () => playing(room).map((p) => ({ id: p.seatId, name: p.name, avatar: p.avatar, isBot: !!p.isBot, hostDevice: !!p.hostDevice })),
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
    // true while the host has paused the game (engine pause, any game)
    paused: () => !!room.paused,
    // Shared engine services a game may use (none of them know any game rules).
    music,
    now: () => Date.now(),
  };
}

// The same seat (or host screen) opened in a SECOND tab / window: the new tab
// takes over, and the old one is told (instead of silently receiving nothing).
function replaceOldSocket(oldId, newSocket, room) {
  if (!oldId || oldId === newSocket.id) return;
  const old = io.sockets.sockets.get(oldId);
  if (!old) return;
  old.emit("session:replaced", {});
  old.leave(room.code);
  old.data = {}; // its disconnect must not start a grace timer for the seat
}

function closeRoom(room, message) {
  if (!rooms[room.code]) return;
  if (room.hostGrace) clearTimeout(room.hostGrace);
  room.players.forEach((p) => { if (p.grace) clearTimeout(p.grace); });
  io.to(room.code).emit("room:closed", { message: message || "La salle est fermée." });
  delete rooms[room.code];
  console.log(`[room ${room.code}] closed`);
}

io.on("connection", (socket) => {
  // ---------- HOST: create a room ----------
  socket.on("host:createRoom", ({ gameId, avatar } = {}) => {
    const game = getGameById(gameId);
    if (!game) return socket.emit("room:error", { message: "Ce jeu n'existe pas." });
    const refused = canCreateRoom(socket);
    if (refused) return socket.emit("room:error", { message: refused });

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
    const transfer = room && room.pendingHost && room.pendingHost.token === hostToken && Date.now() - room.pendingHost.at < 10 * 60000;
    if (!room || (room.hostToken !== hostToken && !transfer)) {
      return socket.emit("host:reconnectFailed", {});
    }
    if (transfer) { // the screen changes hands: the old host screen is told
      room.hostToken = hostToken;
      room.pendingHost = null;
      const old = room.hostSocketId && io.sockets.sockets.get(room.hostSocketId);
      if (old && old.id !== socket.id) { old.emit("host:transferred", {}); old.leave(room.code); old.data = {}; }
      room.hostSocketId = null;
    }
    if (room.hostGrace) { clearTimeout(room.hostGrace); room.hostGrace = null; }
    replaceOldSocket(room.hostSocketId, socket, room);
    room.hostSocketId = socket.id;
    if (avatar) room.hostAvatar = cleanAvatar(avatar);
    socket.join(room.code);
    socket.data = { role: "host", code: room.code };
    socket.emit("host:reconnected", {
      code: room.code, game: getGameById(room.gameId),
      players: publicPlayers(room), inGame: !!room.gameState, paused: !!room.paused,
    });
    io.to(room.code).emit("room:hostStatus", { connected: true });
    if (room.gameState) callGame(room, "onReconnect", { isHost: true });
    console.log(`[room ${room.code}] host reconnected`);
  });

  // ---------- PLAYER: join a room ----------
  socket.on("player:join", ({ code, name, avatar, hostDevice } = {}) => {
    code = String(code || "").toUpperCase().trim();
    name = String(name || "").trim();
    const room = rooms[code];
    if (!room) return socket.emit("join:error", { message: "Ce code de salle n'existe pas." });
    if (!name) return socket.emit("join:error", { message: "Choisis un pseudo." });
    if (name.length > 16) name = name.slice(0, 16);
    if (room.players.some((p) => sameName(p.name, name))) {
      return socket.emit("join:error", { message: "Ce pseudo est déjà pris ici." });
    }
    if (room.players.length >= 20) return socket.emit("join:error", { message: "La salle est pleine (20 personnes maximum)." });
    // A game is running: the game module says whether it can seat a late player
    // (module.allowLateJoin(room)). If not, the newcomer WATCHES (spectator) and
    // plays from the next game on, instead of being refused.
    const module = gameModules[room.gameId];
    const running = !!room.gameState;
    const lateOk = running && !!(module && typeof module.allowLateJoin === "function" && module.allowLateJoin(room));
    const back = takeDeparted(room, name); // same name as someone removed a moment ago: same place

    // hostDevice = this phone is ALSO the host's device (the host plays from it)
    const seat = { seatId: back ? back.seatId : token(), name, socketId: socket.id, connected: true, grace: null,
      avatar: avatar ? cleanAvatar(avatar) : (back ? back.avatar : cleanAvatar(null)), hostDevice: !!hostDevice,
      spectator: running && !lateOk, ready: false };
    room.players.push(seat);
    socket.join(code);
    socket.data = { role: "player", code, seatId: seat.seatId };
    socket.emit("join:success", {
      code, game: getGameById(room.gameId), you: { id: seat.seatId, name, avatar: seat.avatar },
      seatId: seat.seatId, inGame: running && lateOk, spectator: seat.spectator, back: !!back,
    });
    broadcastPlayers(room);
    // Late arrival: let the game module seat this new player (it decides how).
    if (lateOk) callGame(room, "onPlayerJoin", seat.seatId);
    console.log(`[room ${code}] "${name}" joined (${room.players.length})${seat.spectator ? " as spectator" : ""}${back ? " (came back)" : ""}`);
  });

  // ---------- PLAYER: reconnect to a seat ----------
  socket.on("player:reconnect", ({ code, seatId }) => {
    const room = rooms[String(code || "").toUpperCase()];
    const seat = room && room.players.find((p) => p.seatId === seatId);
    if (!room || !seat) return socket.emit("reconnect:failed", {});

    if (seat.grace) { clearTimeout(seat.grace); seat.grace = null; }
    replaceOldSocket(seat.socketId, socket, room);
    seat.socketId = socket.id;
    seat.connected = true;
    socket.join(room.code);
    socket.data = { role: "player", code: room.code, seatId };
    socket.emit("reconnect:success", {
      code: room.code, game: getGameById(room.gameId),
      you: { id: seatId, name: seat.name, avatar: seat.avatar }, seatId,
      inGame: !!room.gameState && !seat.spectator, spectator: !!seat.spectator, paused: !!room.paused,
    });
    broadcastPlayers(room);
    if (room.gameState && !seat.spectator) callGame(room, "onReconnect", { seatId });
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
    if (room.gameState && !seat.spectator) callGame(room, "onPlayerLeave", seat.seatId);
    broadcastPlayers(room);
    socket.leave(room.code);
    socket.data = {};
    console.log(`[room ${room.code}] "${seat.name}" left on purpose`);
  });
  socket.on("host:leave", () => {
    const room = rooms[socket.data.code];
    if (room && socket.data.role === "host") closeRoom(room, "L'host a fermé la salle.");
  });

  // ---------- HOST: start the game ----------
  socket.on("host:startGame", () => {
    const room = rooms[socket.data.code];
    if (!room || socket.data.role !== "host") return;
    const module = gameModules[room.gameId];
    if (!module) return socket.emit("game:error", { message: "Ce jeu n'a pas encore de règles (bientôt !)." });
    room.players.forEach((p) => { p.spectator = false; });
    if (room.players.length < (module.minPlayers || 1)) {
      return socket.emit("game:error", { message: `Il faut au moins ${module.minPlayers} joueurs pour lancer.` });
    }
    room.players.forEach((p) => { p.ready = false; });
    room.paused = false;
    callGame(room, "start");
    broadcastPlayers(room);
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
    if (late) callGame(room, "onPlayerJoin", seat.seatId);
    console.log(`[room ${room.code}] bot added (${room.players.length})`);
  });

  // ---------- Lobby: "Prêt" ----------
  socket.on("player:ready", ({ ready } = {}) => {
    const room = rooms[socket.data.code];
    if (!room || socket.data.role !== "player" || room.gameState) return;
    const seat = room.players.find((p) => p.seatId === socket.data.seatId);
    if (!seat) return;
    seat.ready = !!ready;
    broadcastPlayers(room);
  });

  // ---------- HOST: remove a player or a bot ----------
  socket.on("host:kick", ({ seatId } = {}) => {
    const room = rooms[socket.data.code];
    if (!room || socket.data.role !== "host") return;
    const seat = room.players.find((p) => p.seatId === seatId);
    if (!seat) return;
    if (seat.grace) clearTimeout(seat.grace);
    room.players = room.players.filter((p) => p !== seat);
    if (seat.socketId) {
      const s = io.sockets.sockets.get(seat.socketId);
      if (s) { s.emit("room:kicked", {}); s.leave(room.code); s.data = {}; }
    }
    if (room.gameState && !seat.spectator) callGame(room, "onPlayerLeave", seat.seatId);
    broadcastPlayers(room);
    console.log(`[room ${room.code}] "${seat.name}" removed by the host`);
  });

  // ---------- HOST: stop the game and go back to the lobby ----------
  socket.on("host:backToLobby", () => {
    const room = rooms[socket.data.code];
    if (!room || socket.data.role !== "host" || !room.gameState) return;
    stopGame(room);
    console.log(`[room ${room.code}] back to the lobby`);
  });

  // ---------- HOST: change game, same room, same players ----------
  socket.on("host:changeGame", ({ gameId } = {}) => {
    const room = rooms[socket.data.code];
    const game = getGameById(gameId);
    if (!room || socket.data.role !== "host" || !game) return;
    if (room.gameState) stopGame(room);
    room.gameId = game.id;
    io.to(room.code).emit("room:gameChanged", { game });
    broadcastPlayers(room);
    console.log(`[room ${room.code}] game changed to "${game.id}"`);
  });

  // ---------- HOST: pause / resume (any game) ----------
  // The engine blocks the players' actions and shows "Pause" everywhere; a game
  // that has clocks (songs, timers) is told via onPause(api, room, paused).
  socket.on("host:pause", ({ paused } = {}) => {
    const room = rooms[socket.data.code];
    if (!room || socket.data.role !== "host" || !room.gameState) return;
    room.paused = !!paused;
    io.to(room.code).emit("room:paused", { paused: room.paused });
    callGame(room, "onPause", room.paused);
  });

  // ---------- HOST: hand the shared screen over to a player ----------
  // The player's phone gets a link that opens the host screen with a NEW host
  // key; as soon as it connects, the old host screen is told and stops.
  socket.on("host:transfer", ({ seatId } = {}) => {
    const room = rooms[socket.data.code];
    if (!room || socket.data.role !== "host") return;
    const seat = room.players.find((p) => p.seatId === seatId && !p.isBot && p.connected);
    if (!seat || !seat.socketId) return;
    room.pendingHost = { token: token(), seatId, at: Date.now() };
    io.to(seat.socketId).emit("host:offer", { code: room.code, gameId: room.gameId, token: room.pendingHost.token });
    socket.emit("host:offerSent", { name: seat.name });
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
    if (room.gameState) callGame(room, "onCheat", cheatId);
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
    const actor = { isHost: socket.data.role === "host", seatId: socket.data.seatId || null };
    if (room.paused && !actor.isHost) return; // the host paused the game
    const me = !actor.isHost && room.players.find((p) => p.seatId === actor.seatId);
    if (me && me.spectator) return;            // spectators watch, they do not play
    callGame(room, "handle", actor, type, payload);
  });

  // ---------- Client bundle loaded -> push it the current state ----------
  // A game's browser code is now loaded ON DEMAND, so its socket listeners attach
  // AFTER the room may already have broadcast. When the bundle is ready it asks
  // for a resync, and we replay the current state to it (same path as reconnect).
  socket.on("game:sync", () => {
    const room = rooms[socket.data.code];
    if (!room || !room.gameState) return;
    const who = socket.data.role === "host" ? { isHost: true } : { seatId: socket.data.seatId };
    callGame(room, "onReconnect", who);
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
        if (!seat.spectator) rememberDeparted(room, seat);
        if (room.gameState && !seat.spectator) callGame(room, "onPlayerLeave", seat.seatId);
        broadcastPlayers(room);
        console.log(`[room ${room.code}] "${seat.name}" removed (grace expired)`);
      }, GRACE_MS);
      console.log(`[room ${room.code}] "${seat.name}" disconnected (grace)`);
    }
  });
});

// ---------- Last safety net ----------
// Errors thrown later, inside a game's own timers (setTimeout), cannot be caught
// by callGame. Node would then stop the whole server; we log them instead.
process.on("uncaughtException", (e) => console.error("[ERREUR non rattrapée]", e && e.stack || e));
process.on("unhandledRejection", (e) => console.error("[ERREUR non rattrapée (promesse)]", e && e.stack || e));

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
  io.emit("server:restarting", { message: "Le site redémarre pour une mise à jour : la partie en cours va s'arrêter. Recharge la page dans 1 minute." });
  setTimeout(() => process.exit(0), 1500);
});

server.listen(PORT, () => console.log(`Game Night server running on http://localhost:${PORT}`));
