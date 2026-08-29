// host.js -- Host client: create a room for the chosen game, then show the lobby.

const socket = io(); // open the real-time connection to the server
window.socket = socket; // expose it so the game-specific script can use it

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
  renderCheatConsole(game); // build the cheat buttons for THIS game
  loadingEl.classList.add("hidden");
  lobbyEl.classList.remove("hidden");
  // Show the "start game" button now that the room exists.
  const startBtn = document.getElementById("start-btn");
  startBtn.classList.remove("hidden");
  document.getElementById("start-hint").textContent =
    "Lance quand tous les joueurs ont rejoint.";
});

// Host clicks "Start": ask the server to begin the game.
document.getElementById("start-btn").addEventListener("click", () => {
  socket.emit("host:startGame");
});

// The game couldn't start (no rules yet, too few players...).
socket.on("game:error", ({ message }) => {
  document.getElementById("start-hint").textContent = message;
});

// The game started: hide the lobby, reveal the game board (drawn by the game's script).
socket.on("game:started", () => {
  lobbyEl.classList.add("hidden");
  document.getElementById("game-root").classList.remove("hidden");
});

// Build the cheat console from the game's declared cheats. Generic: it shows
// whatever the game listed, so new games' cheats appear here automatically.
function renderCheatConsole(game) {
  const panel = document.getElementById("cheat-console");
  const buttons = document.getElementById("cheat-buttons");
  buttons.innerHTML = "";

  if (!game.cheats || game.cheats.length === 0) {
    panel.classList.add("hidden"); // this game has no cheats -> no console
    return;
  }

  game.cheats.forEach((cheat) => {
    const btn = document.createElement("button");
    btn.className = "cheat-btn";
    btn.innerHTML =
      `<span class="cheat-btn-emoji">${cheat.emoji || "✨"}</span> ${cheat.label}`;
    // Clicking a cheat asks the server to trigger it (server checks we're host).
    btn.addEventListener("click", () => {
      socket.emit("host:cheat", { cheatId: cheat.id });
    });
    buttons.appendChild(btn);
  });
  panel.classList.remove("hidden");
}

// A cheat was triggered (by us) -> show the shared on-screen effect.
socket.on("game:cheat", ({ cheat }) => showCheatEffect(cheat));

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
