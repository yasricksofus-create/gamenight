// host-tools.js -- GENERIC tools of the host screen, for EVERY game (engine side).
//
// A small "Host" menu (bottom left) while a game runs:
//   - Pause / Reprendre  (key P)   -> the engine blocks the players' actions and
//                                     tells the game (games with clocks freeze them)
//   - Plein écran        (key F)
//   - Retour au hall                -> the game stops, same room, same players
//   - Changer de jeu                -> back to the hall with another game
//   - Raccourcis         (key ?)
// The mouse pointer also hides after 3 s without moving (it is a TV screen).
// A game can reuse these with window.GN.fullscreen() / window.GN.togglePause().
(function () {
  const socket = window.socket;
  let paused = false, inGame = false, games = [];

  function fullscreen() {
    const d = document;
    if (d.fullscreenElement || d.webkitFullscreenElement) { (d.exitFullscreen || d.webkitExitFullscreen).call(d); return; }
    const el = d.documentElement;
    const f = el.requestFullscreen || el.webkitRequestFullscreen;
    if (f) { try { const r = f.call(el); if (r && r.catch) r.catch(() => {}); } catch (e) {} }
  }
  function togglePause() { if (inGame) socket.emit("host:pause", { paused: !paused }); }
  window.GN = Object.assign(window.GN || {}, { fullscreen, togglePause, isPaused: () => paused });

  // ---- the menu ----
  const box = document.createElement("div");
  box.className = "gn-tools hidden";
  box.innerHTML = `<button type="button" class="gn-tools-btn" aria-expanded="false" aria-controls="gn-tools-menu">⚙ Host</button>
    <div class="gn-tools-menu" id="gn-tools-menu" hidden>
      <button type="button" data-t="pause">⏸ Pause <kbd>P</kbd></button>
      <button type="button" data-t="full">⛶ Plein écran <kbd>F</kbd></button>
      <button type="button" data-t="lobby">↩ Retour au hall</button>
      <label class="gn-tools-game">Changer de jeu<select id="gn-game-select" aria-label="Changer de jeu"></select></label>
      <button type="button" data-t="keys">⌨ Raccourcis <kbd>?</kbd></button>
      <p class="gn-tools-confirm" hidden></p>
    </div>`;
  document.body.appendChild(box);
  const btn = box.querySelector(".gn-tools-btn"), menu = box.querySelector(".gn-tools-menu");
  const confirmP = box.querySelector(".gn-tools-confirm");
  btn.onclick = () => { menu.hidden = !menu.hidden; btn.setAttribute("aria-expanded", String(!menu.hidden)); confirmP.hidden = true; };

  // Stopping a game is a big step: ask once more, inside the menu (no browser pop-up).
  function ask(text, go) {
    confirmP.hidden = false;
    confirmP.innerHTML = "";
    confirmP.append(text + " ");
    const yes = document.createElement("button"); yes.type = "button"; yes.textContent = "Oui";
    const no = document.createElement("button"); no.type = "button"; no.textContent = "Non";
    yes.onclick = () => { confirmP.hidden = true; menu.hidden = true; go(); };
    no.onclick = () => { confirmP.hidden = true; };
    confirmP.append(yes, no);
  }
  menu.addEventListener("click", (e) => {
    const b = e.target.closest("[data-t]"); if (!b) return;
    const t = b.dataset.t;
    if (t === "pause") { togglePause(); menu.hidden = true; }
    else if (t === "full") { fullscreen(); menu.hidden = true; }
    else if (t === "keys") { menu.hidden = true; showKeys(); }
    else if (t === "lobby") ask("Arrêter la partie et revenir au hall ?", () => socket.emit("host:backToLobby"));
  });
  const sel = box.querySelector("#gn-game-select");
  sel.onchange = () => {
    const g = games.find((x) => x.id === sel.value);
    if (!g) return;
    ask("Passer à « " + g.name + " » ? (la partie en cours s'arrête)", () => socket.emit("host:changeGame", { gameId: g.id }));
  };
  fetch("/api/games").then((r) => r.json()).then((list) => {
    games = (list || []).filter((g) => g.playable);
    sel.innerHTML = `<option value="">—</option>` + games.map((g) => `<option value="${g.id}">${g.name}</option>`).join("");
  }).catch(() => {});

  function showKeys() {
    let m = document.getElementById("gn-keys");
    if (m) { m.remove(); return; }
    m = document.createElement("div");
    m.id = "gn-keys"; m.className = "gn-modal";
    m.innerHTML = `<div class="gn-modal-box" role="dialog" aria-modal="true" aria-label="Raccourcis clavier"><h3>Raccourcis clavier</h3>
      <p><kbd>P</kbd> pause / reprendre</p><p><kbd>F</kbd> plein écran</p><p><kbd>?</kbd> cette aide</p>
      <p class="hint">Certains jeux ont leurs propres raccourcis en plus (ex. Kietkoutsa : Espace, N, R, C).</p>
      <button type="button" class="gn-modal-ok">OK</button></div>`;
    m.onclick = (e) => { if (e.target === m || e.target.classList.contains("gn-modal-ok")) m.remove(); };
    document.body.appendChild(m);
  }
  document.addEventListener("keydown", (e) => {
    const t = e.target;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === "f") fullscreen();
    else if (k === "p" && inGame) togglePause();
    else if (k === "?") showKeys();
  });

  // ---- pause banner on the host screen ----
  const banner = document.createElement("div");
  banner.className = "gn-pause-host";
  banner.hidden = true;
  banner.innerHTML = `⏸ PAUSE <button type="button">Reprendre</button>`;
  banner.querySelector("button").onclick = togglePause;
  document.body.appendChild(banner);
  function setPaused(p) { paused = !!p; banner.hidden = !paused; box.querySelector('[data-t="pause"]').firstChild.textContent = paused ? "▶ Reprendre " : "⏸ Pause "; }
  socket.on("room:paused", ({ paused: p }) => setPaused(p));
  socket.on("host:reconnected", ({ inGame: g, paused: p }) => { setInGame(!!g); setPaused(p); });

  // ---- shown only during a game ----
  function setInGame(v) { inGame = v; box.classList.toggle("hidden", !v); if (!v) { setPaused(false); menu.hidden = true; } }
  socket.on("game:started", () => setInGame(true));
  socket.on("game:stopped", () => setInGame(false));
  socket.on("room:gameChanged", () => setInGame(false));

  // ---- the mouse pointer hides after 3 s without moving ----
  let t = null;
  const wake = () => { document.body.classList.remove("gn-nocursor"); clearTimeout(t); t = setTimeout(() => { if (inGame) document.body.classList.add("gn-nocursor"); }, 3000); };
  document.addEventListener("mousemove", wake);
  wake();
})();
