// player.js -- Player client: join a room (or RECONNECT to the same seat).
//
// Reconnection: on the first join the server gives us a stable "seatId" that we
// keep in this browser. A reload then reconnects to the SAME seat (same hand /
// role) instead of creating a new player. "Quitter" clears it and goes home.

// WebSocket first (faster start), long-polling as a fallback for strict networks.
const socket = io({ transports: ["websocket", "polling"] });
window.socket = socket;
window.mySeatId = null;

const params = new URLSearchParams(window.location.search);
const code = params.get("room");
const name = params.get("name");

const loadingEl = document.getElementById("loading");
const connectedEl = document.getElementById("connected");
const errorEl = document.getElementById("error");

// The avatar made on the home page travels in the link too (&av=...), so it is
// kept even when the browser refuses to remember things (private browsing).
function myAvatar() {
  if (!window.PixelAvatar) return null;
  const fromLink = params.get("av") && PixelAvatar.decode(params.get("av"));
  if (fromLink) { PixelAvatar.save(fromLink); return fromLink; }
  return PixelAvatar.mine();
}
// This phone also hosts the room (same browser) -> the game can avoid showing
// the host twice.
function isHostDevice() {
  try { return !!localStorage.getItem("gn_host_" + code); } catch (e) { return false; }
}
function storedSeat() {
  try { return localStorage.getItem("gn_seat_" + code); } catch (e) { return null; }
}

// Decide, each time the socket connects, whether to join fresh or reconnect.
function identify() {
  if (!code) { showError("Code de salle manquant."); return; }
  const seatId = storedSeat();
  if (seatId) socket.emit("player:reconnect", { code, seatId });
  else if (name) socket.emit("player:join", { code, name, avatar: myAvatar(), hostDevice: isHostDevice() });
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
  showMyAvatar();
  document.getElementById("room-code").textContent = code;
  if (window.Reactions) Reactions.enable(game, "player");
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

socket.on("join:success", ({ game, you, seatId, inGame }) => {
  remember(seatId);
  setup(game, you.name);
  // inGame = we arrived while a game was already running (games that allow it)
  if (inGame) showGame(); else showConnected();
});

socket.on("reconnect:success", ({ game, you, seatId, inGame }) => {
  remember(seatId);
  setup(game, you.name);
  if (inGame) showGame(); else showConnected();
});

// Seat is gone (grace expired, room closed...) -> try a fresh join if we can.
let hadSeat = false;
socket.on("reconnect:failed", () => {
  try { localStorage.removeItem("gn_seat_" + code); } catch (e) {}
  hadSeat = true; // we WERE in this room: if it is gone, explain why
  if (name) socket.emit("player:join", { code, name, avatar: myAvatar(), hostDevice: isHostDevice() });
  else showError("Impossible de te reconnecter. Retourne à l'accueil.");
});

socket.on("room:playersUpdate", ({ players }) => renderPlayerList(players));

// ----- my avatar: shown in the lobby, editable at any time (also by games) -----
function showMyAvatar() {
  const img = document.getElementById("you-avatar");
  if (img && window.PixelAvatar) img.src = PixelAvatar.url(PixelAvatar.mine());
}
window.editMyAvatar = function () {
  if (!window.AvatarCreator) return;
  AvatarCreator.open({
    value: PixelAvatar.mine(),
    onSave: (a) => { PixelAvatar.save(a); socket.emit("player:setAvatar", { avatar: a }); showMyAvatar(); },
  });
};
document.getElementById("edit-avatar").addEventListener("click", () => window.editMyAvatar());

// ----- changing my name (lobby) -----
window.renameMe = function () {
  const box = document.getElementById("rename-box");
  if (!box) return;
  box.hidden = !box.hidden;
  if (!box.hidden) { const i = document.getElementById("rename-input"); i.value = document.getElementById("you-name").textContent; i.focus(); }
};
document.getElementById("rename-btn").addEventListener("click", () => window.renameMe());
document.getElementById("rename-box").addEventListener("submit", (e) => {
  e.preventDefault();
  const v = document.getElementById("rename-input").value.trim();
  if (v) socket.emit("player:rename", { name: v });
});
socket.on("rename:ok", ({ name: n }) => {
  document.getElementById("you-name").textContent = n;
  document.getElementById("rename-box").hidden = true;
  try { localStorage.setItem("gn_last_name", n); } catch (e) {}
});
socket.on("rename:error", ({ message }) => { const h = document.getElementById("rename-hint"); if (h) h.textContent = message; });

socket.on("game:cheat", ({ cheat }) => showCheatEffect(cheat));
socket.on("game:started", showGame);
socket.on("join:error", ({ message }) => {
  if (hadSeat && /n'existe pas/.test(message)) {
    // the room disappeared (usually: the site restarted for an update)
    showError("Cette salle a été fermée (le site a sans doute redémarré pour une mise à jour). Retour à l'accueil dans 6 secondes…");
    setTimeout(() => { location.href = "/?room="; }, 6000);
    return;
  }
  showError(message);
});

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
