// player.js -- Player client: join a room (or RECONNECT to the same seat).
//
// Reconnection: on the first join the server gives us a stable "seatId" that we
// keep in this browser. A reload then reconnects to the SAME seat (same hand /
// role) instead of creating a new player. "Quitter" clears it and goes home.

const socket = io();
window.socket = socket;
window.mySeatId = null;

const params = new URLSearchParams(window.location.search);
const code = params.get("room");
const name = params.get("name");

const loadingEl = document.getElementById("loading");
const connectedEl = document.getElementById("connected");
const errorEl = document.getElementById("error");

function storedSeat() {
  try { return localStorage.getItem("gn_seat_" + code); } catch (e) { return null; }
}

// Decide, each time the socket connects, whether to join fresh or reconnect.
function identify() {
  if (!code) { showError("Code de salle manquant."); return; }
  const seatId = storedSeat();
  if (seatId) socket.emit("player:reconnect", { code, seatId });
  else if (name) socket.emit("player:join", { code, name });
  else showError("Pseudo manquant.");
}
socket.on("connect", identify);
if (socket.connected) identify();

function remember(seatId) {
  window.mySeatId = seatId;
  try { localStorage.setItem("gn_seat_" + code, seatId); } catch (e) {}
}
function setup(game, youName) {
  applyTheme(game.theme);
  // Pull in THIS game's view code (games/<id>/client/player.js) if not already.
  if (window.GameClient) GameClient.load(game.id, "player");
  document.getElementById("game-emoji").textContent = game.emoji;
  document.getElementById("game-name").textContent = game.name;
  document.getElementById("you-name").textContent = youName;
  document.getElementById("room-code").textContent = code;
}
function showConnected() {
  loadingEl.classList.add("hidden");
  errorEl.classList.add("hidden");
  document.getElementById("game-root").classList.add("hidden");
  connectedEl.classList.remove("hidden");
}
function showGame() {
  loadingEl.classList.add("hidden");
  connectedEl.classList.add("hidden");
  document.getElementById("game-root").classList.remove("hidden");
}

socket.on("join:success", ({ game, you, seatId }) => {
  remember(seatId);
  setup(game, you.name);
  showConnected();
});

socket.on("reconnect:success", ({ game, you, seatId, inGame }) => {
  remember(seatId);
  setup(game, you.name);
  if (inGame) showGame(); else showConnected();
});

// Seat is gone (grace expired, room closed...) -> try a fresh join if we can.
socket.on("reconnect:failed", () => {
  try { localStorage.removeItem("gn_seat_" + code); } catch (e) {}
  if (name) socket.emit("player:join", { code, name });
  else showError("Impossible de te reconnecter. Retourne a l'accueil.");
});

socket.on("room:playersUpdate", ({ players }) => {
  const list = document.getElementById("player-list");
  document.getElementById("player-count").textContent = players.length;
  list.innerHTML = "";
  players.forEach((p) => {
    const li = document.createElement("li");
    li.textContent = p.name + (p.connected === false ? " (deconnecte…)" : "");
    if (p.connected === false) li.classList.add("empty");
    list.appendChild(li);
  });
});

socket.on("game:cheat", ({ cheat }) => showCheatEffect(cheat));
socket.on("game:started", showGame);
socket.on("join:error", ({ message }) => showError(message));

// The room closed -> forget the seat so we don't try to rejoin a dead room.
socket.on("room:closed", ({ message }) => {
  try { localStorage.removeItem("gn_seat_" + code); } catch (e) {}
  showError(message || "La salle est fermee.");
});

// Leave on purpose -> stop auto-reconnect and go back to the menu.
const leaveBtn = document.getElementById("leave-btn");
if (leaveBtn) leaveBtn.addEventListener("click", () => {
  socket.emit("player:leave");
  try { localStorage.removeItem("gn_seat_" + code); } catch (e) {}
  window.location.href = "/";
});

function showError(message) {
  loadingEl.classList.add("hidden");
  connectedEl.classList.add("hidden");
  document.getElementById("game-root").classList.add("hidden");
  document.getElementById("error-text").textContent = message;
  errorEl.classList.remove("hidden");
}
