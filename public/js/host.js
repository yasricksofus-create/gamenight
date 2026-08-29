// host.js -- Host client: create a room for the chosen game, then show the lobby.

const socket = io(); // open the real-time connection to the server

// Which game did the host pick? It is in the URL, e.g. host.html?game=quiz-party
const params = new URLSearchParams(window.location.search);
const gameId = params.get("game");

const loadingEl = document.getElementById("loading");
const lobbyEl = document.getElementById("lobby");
const errorEl = document.getElementById("error");

if (!gameId) {
  showError("Aucun jeu selectionne. Retourne a l'accueil.");
} else {
  // Ask the server to create a room for this game.
  socket.emit("host:createRoom", { gameId });
}

// The server confirms the room is ready.
socket.on("room:created", ({ code, game }) => {
  applyTheme(game.theme); // apply this game's DA to the page
  document.getElementById("game-emoji").textContent = game.emoji;
  document.getElementById("game-name").textContent = game.name;
  document.getElementById("game-tagline").textContent = game.tagline;
  document.getElementById("room-code").textContent = code;
  document.getElementById("site-url").textContent = window.location.host;
  loadingEl.classList.add("hidden");
  lobbyEl.classList.remove("hidden");
});

// The player list changed (someone joined or left).
socket.on("room:playersUpdate", ({ players }) => {
  const list = document.getElementById("player-list");
  document.getElementById("player-count").textContent = players.length;
  if (players.length === 0) {
    list.innerHTML = '<li class="empty">En attente de joueurs…</li>';
    return;
  }
  list.innerHTML = "";
  players.forEach((p) => {
    const li = document.createElement("li");
    li.textContent = p.name;
    list.appendChild(li);
  });
});

socket.on("room:error", ({ message }) => showError(message));

function showError(message) {
  loadingEl.classList.add("hidden");
  lobbyEl.classList.add("hidden");
  errorEl.textContent = message;
  errorEl.classList.remove("hidden");
}
