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
