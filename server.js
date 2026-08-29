// server.js -- The GENERIC ENGINE of the platform.
//
// Responsibilities (and ONLY these):
//   1. Serve the web pages (homepage, host view, player view).
//   2. Manage rooms and the real-time link between the host and the players.
//
// It knows NOTHING about how any individual game is played. It only knows that
// "there are rooms, one host, and some players". Everything game-specific lives
// in games.js (and, later, in per-game modules). This separation is what keeps
// the platform generic: adding a game must never force a change in this file.

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const { games, getGameById } = require("./games");
const gameModules = require("./game-modules"); // games that have server-side rules

const app = express();
const server = http.createServer(app);
const io = new Server(server); // Socket.IO = real-time messaging over WebSocket.

const PORT = process.env.PORT || 3000;

// Serve every static file (HTML, CSS, JS) from the "public" folder.
app.use(express.static(path.join(__dirname, "public")));

// Tiny API so the browser can ask the server for the games (single source of
// truth). "API" here = a URL the browser calls to get data back as JSON.
app.get("/api/games", (req, res) => {
  res.json(games);
});
app.get("/api/games/:id", (req, res) => {
  const game = getGameById(req.params.id);
  if (!game) return res.status(404).json({ error: "Game not found" });
  res.json(game);
});

// ----- Rooms state (kept in memory) -----
// rooms is a plain object: rooms[CODE] = { code, gameId, hostId, players: [] }.
// "In memory" = stored in a normal variable. If the server restarts, rooms are
// lost -- fine for now, since a game night is short-lived.
const rooms = {};

// Generate a short, easy-to-read-aloud room code (4 letters).
function generateRoomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // no I / O to avoid confusion
  let code;
  do {
    code = "";
    for (let i = 0; i < 4; i++) {
      code += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
  } while (rooms[code]); // guarantees the code is not already used
  return code;
}

// The "api" is the ONLY way a game module talks to the browsers. It hides
// Socket.IO from the module, so the module stays pure game logic.
function makeApi(room) {
  return {
    players: () => room.players, // [{id, name}]
    hostId: room.hostId,
    toHost: (event, data) => io.to(room.hostId).emit(event, data),
    toPlayer: (playerId, event, data) => io.to(playerId).emit(event, data),
    toAll: (event, data) => io.to(room.code).emit(event, data),
  };
}

// A "socket" is one connected browser (a host OR a player).
io.on("connection", (socket) => {
  // --- HOST creates a room for a chosen game ---
  socket.on("host:createRoom", ({ gameId }) => {
    const game = getGameById(gameId);
    if (!game) {
      socket.emit("room:error", { message: "Unknown game." });
      return;
    }
    const code = generateRoomCode();
    rooms[code] = { code, gameId, hostId: socket.id, players: [] };

    socket.join(code); // put this socket in a Socket.IO room, for broadcasting
    socket.data.role = "host"; // remember role + room, for cleanup on disconnect
    socket.data.roomCode = code;

    socket.emit("room:created", { code, game });
    console.log(`[room ${code}] created for game "${gameId}"`);
  });

  // --- PLAYER joins an existing room using its code ---
  socket.on("player:join", ({ code, name }) => {
    code = String(code || "").toUpperCase().trim();
    name = String(name || "").trim();
    const room = rooms[code];

    if (!room) {
      socket.emit("join:error", { message: "This room code doesn't exist." });
      return;
    }
    if (!name) {
      socket.emit("join:error", { message: "Please choose a name." });
      return;
    }
    // Prevent two players sharing the same name in one room.
    const nameTaken = room.players.some(
      (p) => p.name.toLowerCase() === name.toLowerCase()
    );
    if (nameTaken) {
      socket.emit("join:error", { message: "That name is already taken here." });
      return;
    }

    const player = { id: socket.id, name };
    room.players.push(player);

    socket.join(code);
    socket.data.role = "player";
    socket.data.roomCode = code;
    socket.data.playerName = name;

    const game = getGameById(room.gameId);
    // Tell the player they're in (with the game, so they get the right DA).
    socket.emit("join:success", { code, game, you: player });
    // Tell everyone in the room (host + players) the new player list.
    io.to(code).emit("room:playersUpdate", { players: room.players });
    console.log(`[room ${code}] "${name}" joined (${room.players.length} total)`);
  });

  // --- HOST triggers a cheat from the console ---
  // The engine only RELAYS the cheat; what it means belongs to the game.
  socket.on("host:cheat", ({ cheatId }) => {
    const code = socket.data.roomCode;
    const room = rooms[code];
    // Security: only the room's own host may trigger cheats. A player (or any
    // other socket) trying this is ignored.
    if (!room || socket.data.role !== "host") return;

    // The cheat must be one the current game actually declares (guards against
    // a forged or outdated cheatId).
    const game = getGameById(room.gameId);
    const cheat = game && game.cheats
      ? game.cheats.find((c) => c.id === cheatId)
      : null;
    if (!cheat) return;

    // Broadcast the little banner to everyone (nice feedback).
    io.to(code).emit("game:cheat", { cheat });
    // If the running game defines what this cheat DOES, let it act on the state.
    const module = gameModules[room.gameId];
    if (room.gameState && module && module.onCheat) {
      module.onCheat(makeApi(room), room, cheatId);
    }
    console.log(`[room ${code}] cheat "${cheatId}" triggered by host`);
  });

  // --- HOST starts the actual game (only if the game has a rules module) ---
  socket.on("host:startGame", () => {
    const code = socket.data.roomCode;
    const room = rooms[code];
    if (!room || socket.data.role !== "host") return;

    const module = gameModules[room.gameId];
    if (!module) {
      socket.emit("game:error", {
        message: "Ce jeu n'a pas encore de regles (bientot !).",
      });
      return;
    }
    if (room.players.length < (module.minPlayers || 1)) {
      socket.emit("game:error", {
        message: `Il faut au moins ${module.minPlayers} joueurs pour lancer.`,
      });
      return;
    }
    module.start(makeApi(room), room);
    io.to(code).emit("game:started", { gameId: room.gameId });
    console.log(`[room ${code}] game "${room.gameId}" started`);
  });

  // --- Any in-game action from a player or the host -> routed to the module ---
  socket.on("game:action", ({ type, payload }) => {
    const code = socket.data.roomCode;
    const room = rooms[code];
    if (!room || !room.gameState) return;
    const module = gameModules[room.gameId];
    if (module && module.handle) {
      module.handle(makeApi(room), socket, room, type, payload);
    }
  });

  // --- Cleanup when a browser leaves (tab closed, reload, network lost) ---
  socket.on("disconnect", () => {
    const code = socket.data.roomCode;
    if (!code || !rooms[code]) return;
    const room = rooms[code];

    if (socket.data.role === "host") {
      // No host = the room can't work. Warn the players and close the room.
      io.to(code).emit("room:closed", {
        message: "The host has left. The room is closed.",
      });
      delete rooms[code];
      console.log(`[room ${code}] closed (host left)`);
    } else if (socket.data.role === "player") {
      // If a game is running, let its module react before we drop the player.
      const module = gameModules[room.gameId];
      if (room.gameState && module && module.onPlayerLeave) {
        module.onPlayerLeave(makeApi(room), room, socket.id);
      }
      // Remove this player and refresh everyone's list.
      room.players = room.players.filter((p) => p.id !== socket.id);
      io.to(code).emit("room:playersUpdate", { players: room.players });
      console.log(`[room ${code}] "${socket.data.playerName}" left`);
    }
  });
});

server.listen(PORT, () => {
  console.log(`Game Night server running on http://localhost:${PORT}`);
});
