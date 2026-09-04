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
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
// How long a seat (or the host slot) is kept after a disconnect, in ms.
const GRACE_MS = Number(process.env.GRACE_MS) || 90000;

app.use(express.static(path.join(__dirname, "public")));
// Each game's browser code lives in its own folder (games/<id>/client/*.js) and
// is loaded on demand by the active game only (see public/js/game-loader.js).
app.use("/games", express.static(path.join(__dirname, "games")));

app.get("/api/games", (req, res) => res.json(games));
app.get("/api/games/:id", (req, res) => {
  const game = getGameById(req.params.id);
  if (!game) return res.status(404).json({ error: "Game not found" });
  res.json(game);
});

// ----- Rooms state (in memory) -----
// rooms[CODE] = { code, gameId, hostToken, hostSocketId, hostGrace,
//                 players: [{ seatId, name, socketId, connected, grace }],
//                 gameState }
const rooms = {};

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
  return room.players.map((p) => ({ name: p.name, connected: p.connected }));
}
function broadcastPlayers(room) {
  io.to(room.code).emit("room:playersUpdate", { players: publicPlayers(room) });
}

// The "api" is the ONLY way a game module talks to the browsers. Players are
// addressed by their stable seatId; the api routes to their CURRENT socket.
function makeApi(room) {
  return {
    players: () => room.players.map((p) => ({ id: p.seatId, name: p.name })),
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
  socket.on("host:createRoom", ({ gameId }) => {
    const game = getGameById(gameId);
    if (!game) return socket.emit("room:error", { message: "Unknown game." });

    const code = generateRoomCode();
    rooms[code] = {
      code, gameId, hostToken: token(), hostSocketId: socket.id,
      hostGrace: null, players: [], gameState: null,
    };
    socket.join(code);
    socket.data = { role: "host", code };
    socket.emit("room:created", { code, hostToken: rooms[code].hostToken, game });
    console.log(`[room ${code}] created for "${gameId}"`);
  });

  // ---------- HOST: reconnect to an existing room ----------
  socket.on("host:reconnect", ({ code, hostToken }) => {
    const room = rooms[String(code || "").toUpperCase()];
    if (!room || room.hostToken !== hostToken) {
      return socket.emit("host:reconnectFailed", {});
    }
    if (room.hostGrace) { clearTimeout(room.hostGrace); room.hostGrace = null; }
    room.hostSocketId = socket.id;
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
  socket.on("player:join", ({ code, name }) => {
    code = String(code || "").toUpperCase().trim();
    name = String(name || "").trim();
    const room = rooms[code];
    if (!room) return socket.emit("join:error", { message: "Ce code de salle n'existe pas." });
    if (!name) return socket.emit("join:error", { message: "Choisis un pseudo." });
    if (room.gameState) return socket.emit("join:error", { message: "La partie a deja commence." });
    if (room.players.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
      return socket.emit("join:error", { message: "Ce pseudo est deja pris ici." });
    }

    const seat = { seatId: token(), name, socketId: socket.id, connected: true, grace: null };
    room.players.push(seat);
    socket.join(code);
    socket.data = { role: "player", code, seatId: seat.seatId };
    socket.emit("join:success", {
      code, game: getGameById(room.gameId), you: { id: seat.seatId, name },
      seatId: seat.seatId, inGame: false,
    });
    broadcastPlayers(room);
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
      you: { id: seatId, name: seat.name }, seatId, inGame: !!room.gameState,
    });
    broadcastPlayers(room);
    const module = gameModules[room.gameId];
    if (room.gameState && module && module.onReconnect) {
      module.onReconnect(makeApi(room), room, { seatId });
    }
    console.log(`[room ${room.code}] "${seat.name}" reconnected`);
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

  // ---------- HOST: cheat ----------
  socket.on("host:cheat", ({ cheatId }) => {
    const room = rooms[socket.data.code];
    if (!room || socket.data.role !== "host") return;
    const game = getGameById(room.gameId);
    const cheat = game && game.cheats ? game.cheats.find((c) => c.id === cheatId) : null;
    if (!cheat) return;
    io.to(room.code).emit("game:cheat", { cheat });
    const module = gameModules[room.gameId];
    if (room.gameState && module && module.onCheat) module.onCheat(makeApi(room), room, cheatId);
  });

  // ---------- In-game action ----------
  socket.on("game:action", ({ type, payload }) => {
    const room = rooms[socket.data.code];
    if (!room || !room.gameState) return;
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

server.listen(PORT, () => console.log(`Game Night server running on http://localhost:${PORT}`));
