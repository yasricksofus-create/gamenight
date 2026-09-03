// uno-host.js -- Host-side table for "Cascade" (shown on the shared screen).
// The host never holds cards: this is the public table (draw pile, discard top,
// active color, direction, whose turn, each player's card count) + settings vote
// tally + the host cheat bar. It only reacts to "cascade:*" events.
(function () {
  const socket = window.socket;
  const root = document.getElementById("game-root");
  let state = null;
  let prev = null;   // previous public state (for sound diffs)
  let cheats = [];
  unoInjectStyles();

  // ----- Sound (same engine as Undercover): ONE music at a time (crossfaded),
  // SFX played over it (the music ducks). Missing mp3 files simply stay silent,
  // so you can add them later by dropping files in public/sounds/.
  //   reglages.mp3  -> settings vote    ambiance.mp3 -> in-game (loops)
  //   victoire.mp3  -> a player wins
  //   carte.mp3 -> card played   pioche.mp3 -> draw   attaque.mp3 -> +2/+4
  //   uno.mp3 -> a player calls UNO
  if (window.Sound) {
    Sound.registerAuto("reglages", "reglages");
    Sound.registerAuto("ambiance", "ambiance", { loop: true });
    Sound.registerAuto("victoire", "victoire");
    Sound.registerAuto("carte", "carte");
    Sound.registerAuto("pioche", "pioche");
    Sound.registerAuto("attaque", "attaque");
    Sound.registerAuto("uno", "uno");
  }
  function playSounds(p, s) {
    if (!window.Sound) return;
    if (!p || s.phase !== p.phase) { // phase changed -> switch the music
      if (s.phase === "settings") Sound.music("reglages");
      else if (s.phase === "playing") Sound.music("ambiance");
      else if (s.phase === "ended") Sound.music("victoire");
    }
    if (!p || p.phase !== "playing" || s.phase !== "playing") return; // SFX only play-to-play
    const topChanged = s.top && p.top && s.top.id !== p.top.id;
    const pendingUp = (s.pendingDraw || 0) > (p.pendingDraw || 0);
    if (topChanged) Sound.sfx(pendingUp ? "attaque" : "carte");
    else {
      const sum = (arr) => arr.reduce((t, x) => t + x.count, 0);
      if (sum(s.players) > sum(p.players)) Sound.sfx("pioche");
    }
    const said = (arr) => arr.filter((x) => x.said && x.count === 1).map((x) => x.id).sort().join(",");
    if (said(s.players) && said(s.players) !== said(p.players)) Sound.sfx("uno");
  }

  // Load this game's declared cheats so we can show the host cheat bar.
  fetch("/api/games/cascade").then((r) => r.json())
    .then((g) => { cheats = g.cheats || []; lastSig = null; render(); })
    .catch(() => {});

  socket.on("cascade:state", (s) => { playSounds(prev, s); prev = s; state = s; render(); });
  socket.on("cascade:cheatReveal", ({ hands }) => showHandsOverlay(hands));

  // Skip rebuilding the DOM when nothing visible changed (prevents flicker).
  let lastSig = null;
  function stateSig(s) {
    if (!s) return "";
    if (s.phase === "settings") return "set|" + s.voted + "|" + s.total + "|" + JSON.stringify(s.counts) + "|" + cheats.length;
    if (s.phase === "ended") return "end|" + s.winner + "|" + cheats.length;
    return ["play", s.turn, s.dir, s.activeColor, s.pendingDraw, s.drawCount,
      s.top && s.top.id, s.winner, cheats.length,
      s.players.map((p) => p.id + ":" + p.count + ":" + (p.connected !== false ? 1 : 0) + ":" + (p.said ? 1 : 0)).join(","),
      s.lastAction ? s.lastAction.name + s.lastAction.kind : ""].join("|");
  }

  function send(type, payload) { socket.emit("game:action", { type, payload }); }

  // Live countdown during the settings vote.
  setInterval(() => {
    const el = document.getElementById("uno-countdown");
    if (el && state && state.endsAt) {
      el.textContent = Math.max(0, Math.round((state.endsAt - Date.now()) / 1000)) + "s";
    }
  }, 500);

  const RULES = [
    { key: "cumul", name: "Cumul des pioches", desc: "Empiler +2 sur +2 (ou +4 sur +4) pour renvoyer la pioche au suivant." },
    { key: "jumpin", name: "Jump-in", desc: "Jouer hors de son tour une carte STRICTEMENT identique au dessus." },
    { key: "drawUntil", name: "Pioche jusqu'a jouable", desc: "Piocher tant qu'on n'a pas de carte jouable (au lieu d'une seule)." },
    { key: "customs", name: "Cartes maison", desc: "Ajouter Flush, Pay, +1 pour tous, Copie et Protection au paquet." },
  ];

  function cheatBar() {
    if (!cheats.length) return "";
    const btns = cheats.map((c) =>
      `<button class="uno-cheat" data-cheat="${c.id}">${c.emoji || "✨"} ${c.label}</button>`).join("");
    return `<div class="uno-cheatbar"><span class="uno-cheatbar-title">Console host</span>${btns}</div>`;
  }

  function render() {
    if (!state) return;
    const sg = stateSig(state);
    if (sg === lastSig) return; // nothing visible changed -> don't rebuild the DOM
    lastSig = sg;
    const s = state;
    let html = "";

    if (s.phase === "settings") {
      const rows = RULES.map((r) => {
        const c = (s.counts && s.counts[r.key]) || [0, 0];
        return `<div class="uno-rule"><h3>${r.name}</h3><p>${r.desc}</p>
          <div class="uno-tally">Pour : <strong>${c[0]}</strong> &nbsp;·&nbsp; Contre : <strong>${c[1]}</strong></div></div>`;
      }).join("");
      html = `<div class="uno-wrap"><p class="uno-eyebrow">Mise en place</p>
        <h1 class="uno-title">Reglages de la partie</h1>
        <p class="uno-sub">Les joueurs votent les regles sur leur telephone — <strong id="uno-countdown">…</strong></p>
        <div class="uno-rules">${rows}</div>
        <p class="uno-sub">${s.voted || 0}/${s.total || 0} ont vote</p>
        <button id="uno-finalize" class="uno-btn">Lancer maintenant</button></div>`;
    } else if (s.phase === "playing") {
      html = `<div class="uno-wrap">${tableHtml(s)}${cheatBar()}</div>`;
    } else if (s.phase === "ended") {
      const winName = winnerName(s);
      html = `<div class="uno-wrap" style="text-align:center">
        <p class="uno-eyebrow">Fin de la manche</p>
        <h1 class="uno-win">🎉 ${winName} a vide sa main !</h1>
        <p class="uno-sub">Vous pouvez relancer une manche (nouveau vote des regles).</p>
        <button id="uno-replay" class="uno-btn">Rejouer</button>${cheatBar()}</div>`;
    }

    root.innerHTML = html;
    bind("uno-finalize", () => send("finalizeSettings"));
    bind("uno-replay", () => send("replay"));
    root.querySelectorAll(".uno-cheat").forEach((b) => {
      b.onclick = () => socket.emit("host:cheat", { cheatId: b.getAttribute("data-cheat") });
    });
  }

  function tableHtml(s) {
    const dirArrow = s.dir === 1 ? "↻" : "↺";
    const activeColorName = UNO_COLOR_NAMES[s.activeColor] || "—";
    const pending = s.pendingDraw > 0
      ? `<div class="uno-pending">⚠ Pioche en attente : +${s.pendingDraw}</div>` : "";
    const last = s.lastAction
      ? `<p class="uno-sub"><strong>${s.lastAction.name}</strong> a joue ${lastActionLabel(s.lastAction)}.</p>` : "";

    const center = `<div class="uno-center">
      <div class="uno-pile"><span class="uno-pile-label">Pioche (${s.drawCount})</span>${unoBackHtml(0)}</div>
      <div class="uno-pile"><span class="uno-pile-label">Defausse</span>${unoCardHtml(s.top)}</div>
      <div class="uno-pile"><span class="uno-pile-label">Couleur active</span>
        <span class="uno-colorchip">${unoDot(s.activeColor)} ${activeColorName}</span>
        <span class="uno-dir">Sens ${dirArrow}</span></div>
    </div>`;

    const seats = `<div class="uno-seats">` + s.players.map((p) => {
      const isTurn = p.id === s.turn;
      const mini = `<span class="uno-mini">` +
        Array.from({ length: Math.min(p.count, 12) }, () => `<span class="m"></span>`).join("") + `</span>`;
      const said = p.said && p.count === 1 ? ` <span class="uno-said">UNO!</span>` : "";
      const off = p.connected === false ? " off" : "";
      return `<div class="uno-seat${isTurn ? " turn" : ""}${off}">
        <div><div class="uno-seat-name">${p.name}${said}</div>
        <div class="uno-seat-meta">${p.count} carte${p.count > 1 ? "s" : ""}${p.connected === false ? " · deconnecte" : ""}</div></div>
        ${mini}</div>`;
    }).join("") + `</div>`;

    return `<p class="uno-eyebrow">Cascade — en jeu</p>
      <h1 class="uno-title">Au tour de ${turnName(s)}</h1>
      ${pending}${center}${seats}${last}`;
  }

  function lastActionLabel(a) {
    const c = { kind: a.kind, color: a.color, value: a.value };
    return "« " + unoCardLabel(c) + " »";
  }
  function turnName(s) { const p = s.players.find((x) => x.id === s.turn); return p ? p.name : "?"; }
  function winnerName(s) { const p = s.players.find((x) => x.id === s.winner); return p ? p.name : "?"; }

  function showHandsOverlay(hands) {
    let ov = document.getElementById("uno-hands-overlay");
    if (!ov) {
      ov = document.createElement("div");
      ov.id = "uno-hands-overlay"; ov.className = "uno-overlay";
      document.body.appendChild(ov);
    }
    const body = hands.map((h) => {
      const cards = h.cards.map((c) => unoCardHtml(c, { small: true })).join("");
      return `<div style="margin:10px 0"><div class="uno-seat-name" style="margin-bottom:4px">${h.name} (${h.cards.length})</div>
        <div class="uno-hand" style="justify-content:flex-start">${cards}</div></div>`;
    }).join("");
    ov.innerHTML = `<div class="uno-sheet" style="max-width:760px;text-align:left">
      <h2 style="text-align:center">Mains (host seulement)</h2>${body}
      <div style="text-align:center"><button class="uno-btn" id="uno-hands-close">Fermer</button></div></div>`;
    ov.classList.add("show");
    document.getElementById("uno-hands-close").onclick = () => ov.classList.remove("show");
  }

  function bind(id, fn) { const el = document.getElementById(id); if (el) el.onclick = fn; }
})();
