// host.js -- Host client: create a room (or RECONNECT to it) and show the lobby.
//
// Reconnection: once a room is created, its code goes into the URL (?room=CODE)
// and the host token into this browser's storage. So a reload re-attaches to the
// SAME room instead of opening a new one. Starting a NEW game from the menu uses
// a URL WITHOUT ?room, so it creates a fresh room.

const socket = io();
window.socket = socket;

const params = new URLSearchParams(window.location.search);
const gameId = params.get("game");
const roomParam = (params.get("room") || "").toUpperCase();

const loadingEl = document.getElementById("loading");
const lobbyEl = document.getElementById("lobby");
const errorEl = document.getElementById("error");

function storedHostToken(code) {
  try { return localStorage.getItem("gn_host_" + code); } catch (e) { return null; }
}

// Decide, each time the socket connects, whether to create or reconnect.
function identify() {
  if (!gameId && !roomParam) { showError("Aucun jeu selectionne. Retourne a l'accueil."); return; }
  const tok = roomParam ? storedHostToken(roomParam) : null;
  if (roomParam && tok) socket.emit("host:reconnect", { code: roomParam, hostToken: tok });
  else socket.emit("host:createRoom", { gameId });
}
socket.on("connect", identify);
if (socket.connected) identify();

// Fill the lobby scaffolding (code, game info, cheat console, start button).
function setupLobby(code, game) {
  applyTheme(game.theme);
  // Pull in THIS game's board code (games/<id>/client/host.js) if not already.
  if (window.GameClient) GameClient.load(game.id, "host");
  document.getElementById("game-emoji").textContent = game.emoji;
  document.getElementById("game-name").textContent = game.name;
  document.getElementById("game-tagline").textContent = game.tagline;
  document.getElementById("room-code").textContent = code;
  document.getElementById("site-url").textContent = window.location.host;
  renderCheatConsole(game);
  const startBtn = document.getElementById("start-btn");
  startBtn.classList.remove("hidden");
  document.getElementById("start-hint").textContent = "Lance quand tous les joueurs ont rejoint.";
}

function showLobby() {
  loadingEl.classList.add("hidden");
  errorEl.classList.add("hidden");
  document.getElementById("game-root").classList.add("hidden");
  lobbyEl.classList.remove("hidden");
}
function showGame() {
  loadingEl.classList.add("hidden");
  lobbyEl.classList.add("hidden");
  document.getElementById("game-root").classList.remove("hidden");
}

// Fresh room created.
socket.on("room:created", ({ code, hostToken, game }) => {
  try { localStorage.setItem("gn_host_" + code, hostToken); } catch (e) {}
  // Put the code in the URL so a reload reconnects to THIS room.
  history.replaceState(null, "", "?game=" + encodeURIComponent(gameId) + "&room=" + code);
  setupLobby(code, game);
  showLobby();
});

// Reconnected to an existing room (after a reload / network blip).
socket.on("host:reconnected", ({ code, game, inGame }) => {
  setupLobby(code, game);
  if (inGame) showGame(); else showLobby();
});

// The stored room no longer exists -> make a fresh one.
socket.on("host:reconnectFailed", () => {
  try { localStorage.removeItem("gn_host_" + roomParam); } catch (e) {}
  socket.emit("host:createRoom", { gameId });
});

document.getElementById("start-btn").addEventListener("click", () => socket.emit("host:startGame"));
socket.on("game:error", ({ message }) => { document.getElementById("start-hint").textContent = message; });
socket.on("game:started", showGame);

function renderCheatConsole(game) {
  const panel = document.getElementById("cheat-console");
  const buttons = document.getElementById("cheat-buttons");
  buttons.innerHTML = "";
  if (!game.cheats || game.cheats.length === 0) { panel.classList.add("hidden"); return; }
  game.cheats.forEach((cheat) => {
    const btn = document.createElement("button");
    btn.className = "cheat-btn";
    btn.innerHTML = `<span class="cheat-btn-emoji">${cheat.emoji || "✨"}</span> ${cheat.label}`;
    btn.addEventListener("click", () => socket.emit("host:cheat", { cheatId: cheat.id }));
    buttons.appendChild(btn);
  });
  panel.classList.remove("hidden");
}

socket.on("game:cheat", ({ cheat }) => showCheatEffect(cheat));

socket.on("room:playersUpdate", ({ players }) => {
  const list = document.getElementById("player-list");
  document.getElementById("player-count").textContent = players.length;
  if (players.length === 0) { list.innerHTML = '<li class="empty">En attente de joueurs…</li>'; return; }
  list.innerHTML = "";
  players.forEach((p) => {
    const li = document.createElement("li");
    li.textContent = p.name + (p.connected === false ? " (deconnecte…)" : "");
    if (p.connected === false) li.classList.add("empty");
    list.appendChild(li);
  });
});

// Leave the room on purpose -> stop auto-reconnect and go back to the menu.
const leaveBtn = document.getElementById("leave-btn");
if (leaveBtn) leaveBtn.addEventListener("click", () => {
  socket.emit("host:leave");
  try { localStorage.removeItem("gn_host_" + (roomParam || document.getElementById("room-code").textContent)); } catch (e) {}
  window.location.href = "/";
});

socket.on("room:closed", ({ message }) => showError(message || "La salle est fermee."));
socket.on("room:error", ({ message }) => showError(message));

function showError(message) {
  loadingEl.classList.add("hidden");
  lobbyEl.classList.add("hidden");
  document.getElementById("game-root").classList.add("hidden");
  errorEl.innerHTML = "";
  const p = document.createElement("p");
  p.textContent = message;
  const a = document.createElement("a");
  a.href = "/"; a.className = "back-link"; a.textContent = "← Retour a l'accueil";
  errorEl.appendChild(p); errorEl.appendChild(a);
  errorEl.classList.remove("hidden");
}
