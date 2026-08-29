// player.js -- Player client: join a room with a code, then wait in the lobby.

const socket = io();
window.socket = socket; // expose it so the game-specific script can use it

// The code + name were passed in the URL by the homepage join form.
const params = new URLSearchParams(window.location.search);
const code = params.get("room");
const name = params.get("name");

const loadingEl = document.getElementById("loading");
const connectedEl = document.getElementById("connected");
const errorEl = document.getElementById("error");

if (!code || !name) {
  showError("Code de salle ou pseudo manquant.");
} else {
  socket.emit("player:join", { code, name });
}

// Successfully joined the room.
socket.on("join:success", ({ code, game, you }) => {
  applyTheme(game.theme); // same DA as the host's screen
  document.getElementById("game-emoji").textContent = game.emoji;
  document.getElementById("game-name").textContent = game.name;
  document.getElementById("you-name").textContent = you.name;
  document.getElementById("room-code").textContent = code;
  loadingEl.classList.add("hidden");
  connectedEl.classList.remove("hidden");
});

// The player list changed (someone joined or left).
socket.on("room:playersUpdate", ({ players }) => {
  const list = document.getElementById("player-list");
  document.getElementById("player-count").textContent = players.length;
  list.innerHTML = "";
  players.forEach((p) => {
    const li = document.createElement("li");
    li.textContent = p.name;
    list.appendChild(li);
  });
});

// The host triggered a cheat -> show the shared on-screen effect.
socket.on("game:cheat", ({ cheat }) => showCheatEffect(cheat));

// The game started: hide the lobby view, reveal the game board (drawn by the game's script).
socket.on("game:started", () => {
  connectedEl.classList.add("hidden");
  document.getElementById("game-root").classList.remove("hidden");
});

// Could not join (bad code, name taken, missing name...).
socket.on("join:error", ({ message }) => showError(message));

// The host closed the room (left or reloaded their page).
socket.on("room:closed", ({ message }) => showError(message));

function showError(message) {
  loadingEl.classList.add("hidden");
  connectedEl.classList.add("hidden");
  document.getElementById("error-text").textContent = message;
  errorEl.classList.remove("hidden");
}
