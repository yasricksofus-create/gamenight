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
  // Cascade has its OWN sounds folder so it never shares Undercover's music.
  // Files are in games/cascade/sounds/ ; missing ones simply stay silent.
  const DIR = "/games/cascade/sounds/";
  if (window.Sound) {
    // In-game music: the user's 4 variants (one picked at random each game).
    // Big files (~14 MB total) -> preload "none" so the page doesn't fetch them
    // up front; the chosen track loads only when it actually starts playing.
    Sound.register("ambiance", [
      DIR + "ambiance.cascade.mp3",
      DIR + "ambiance.cascade2.mp3",
      DIR + "ambiance.cascade3.mp3",
      DIR + "cascade.ambiance4.mp3",
    ], { loop: true, preload: "none" });
    // Same short "card drop" sound for playing a card AND for drawing.
    Sound.register("carte", [DIR + "Card-Pioche-Droppingcard-.mp3"]);
    Sound.register("pioche", [DIR + "Card-Pioche-Droppingcard-.mp3"]);
    // Not provided yet -> stay silent until you drop the file (auto-discovered,
    // so just add reglages.mp3 / victoire.mp3 / attaque.mp3 / uno.mp3 later).
    Sound.registerAuto("reglages", "reglages", { dir: DIR });
    Sound.registerAuto("victoire", "victoire", { dir: DIR });
    Sound.registerAuto("attaque", "attaque", { dir: DIR });
    Sound.registerAuto("uno", "uno", { dir: DIR });
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
    // Every posed card gets the "card drop" sound (you have no separate attack
    // sound yet; when you add attaque.mp3 I can give +2/+4 their own sting).
    if (topChanged) Sound.sfx("carte");
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

  // View state: the static phases (settings / ended) are (re)built from a
  // signature; the PLAYING "table" is built ONCE then updated incrementally
  // (targeted DOM writes only) so it never fully rebuilds -> stable FPS.
  let lastStatic = null;   // signature of the static screen currently shown
  let builtRoster = null;  // the roster the table skeleton was built for

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
    const s = state;
    if (s.phase === "settings") return renderSettings(s);
    if (s.phase === "ended") return renderEnded(s);
    if (s.phase === "playing") return renderPlaying(s);
  }

  // ----- static screens (rebuilt only when their signature changes) -----
  function renderSettings(s) {
    builtRoster = null; // force a fresh table build when the game starts
    const sig = "set|" + s.voted + "|" + s.total + "|" + JSON.stringify(s.counts) + "|" + cheats.length;
    if (sig === lastStatic) return;
    lastStatic = sig;
    const rows = RULES.map((r) => {
      const c = (s.counts && s.counts[r.key]) || [0, 0];
      return `<div class="uno-rule"><h3>${r.name}</h3><p>${r.desc}</p>
        <div class="uno-tally">Pour : <strong>${c[0]}</strong> &nbsp;·&nbsp; Contre : <strong>${c[1]}</strong></div></div>`;
    }).join("");
    root.innerHTML = `<div class="uno-wrap"><p class="uno-eyebrow">Mise en place</p>
      <h1 class="uno-title">Reglages de la partie</h1>
      <p class="uno-sub">Les joueurs votent les regles sur leur telephone — <strong id="uno-countdown">…</strong></p>
      <div class="uno-rules">${rows}</div>
      <p class="uno-sub">${s.voted || 0}/${s.total || 0} ont vote</p>
      <button id="uno-finalize" class="uno-btn">Lancer maintenant</button></div>`;
    bind("uno-finalize", () => send("finalizeSettings"));
  }
  function renderEnded(s) {
    builtRoster = null;
    const sig = "end|" + s.winner + "|" + cheats.length;
    if (sig === lastStatic) return;
    lastStatic = sig;
    root.innerHTML = `<div class="uno-wrap" style="text-align:center">
      <p class="uno-eyebrow">Fin de la manche</p>
      <h1 class="uno-win">🎉 ${winnerName(s)} a vide sa main !</h1>
      <p class="uno-sub">Vous pouvez relancer une manche (nouveau vote des regles).</p>
      <button id="uno-replay" class="uno-btn">Rejouer</button>${cheatBar()}</div>`;
    bind("uno-replay", () => send("replay"));
    wireCheats();
  }

  // ----- the TABLE (built once per roster, then updated incrementally) -----
  function renderPlaying(s) {
    lastStatic = null; // leaving a static screen next time forces a rebuild
    const roster = s.players.map((p) => p.id).join(",");
    if (builtRoster !== roster) { buildTable(s); builtRoster = roster; }
    updateTable(s);
  }

  // Even placement around the felt ellipse (full circle, starts at the bottom).
  function podPositions(n) {
    const pos = [];
    for (let i = 0; i < n; i++) {
      const a = Math.PI / 2 + (i * 2 * Math.PI) / n; // bottom -> clockwise
      // Radius kept < 50% so pods sit ON the felt (never clipped at the edges).
      pos.push({ x: 50 + 46 * Math.cos(a), y: 50 + 46 * Math.sin(a) });
    }
    return pos;
  }
  function buildTable(s) {
    const n = s.players.length;
    const scale = Math.max(0.6, Math.min(1, 1 - (n - 4) * 0.075));
    const pod = Math.round(154 * scale);
    const code = (document.getElementById("room-code") || {}).textContent || "";
    const pos = podPositions(n);
    const pods = s.players.map((p, i) => `
      <div class="cscd-pod" data-seat="${p.id}" style="left:${pos[i].x}%;top:${pos[i].y}%">
        <div class="cscd-av" data-av></div>
        <div class="nm" data-nm></div>
        <div class="cscd-fan" data-fan></div>
        <span class="cscd-cnt" data-cnt></span>
        <div class="act" data-act></div>
      </div>`).join("");
    root.innerHTML = `<div class="cscd-stage" style="--pod:${pod}px">
      <div class="cscd-top">
        ${code ? `<span class="cscd-chip">Salle ${code}</span>` : ""}
        <span class="cscd-title" data-title>Cascade</span>
      </div>
      <div class="cscd-table">
        <div class="cscd-center">
          <div class="cscd-piles">
            <div class="cscd-pile"><span class="lbl">Pioche</span>${unoBackHtml(0, true)}<span class="cscd-chip" data-draw>0</span></div>
            <div class="cscd-pile"><span class="lbl">Defausse</span><span data-disc></span></div>
          </div>
          <div class="cscd-info">
            <span class="cscd-chip" data-color></span>
            <span class="cscd-chip" data-dir></span>
            <span class="cscd-pending" data-pending hidden></span>
          </div>
        </div>
        ${pods}
      </div>
      <div class="cscd-cheatwrap">${cheatBar()}</div>
    </div>`;
    wireCheats();
  }

  function updateTable(s) {
    const stage = root.querySelector(".cscd-stage");
    if (!stage) return;
    const set = (sel, txt) => { const el = stage.querySelector(sel); if (el && el.textContent !== txt) el.textContent = txt; };

    set("[data-title]", "Au tour de " + turnName(s));
    set("[data-draw]", "🂠 " + s.drawCount);
    // discard: rebuild only when the top card actually changes
    const disc = stage.querySelector("[data-disc]");
    if (disc && disc.dataset.top !== (s.top && s.top.id)) {
      disc.innerHTML = unoCardHtml(s.top);
      disc.dataset.top = s.top && s.top.id;
    }
    const color = stage.querySelector("[data-color]");
    if (color) color.innerHTML = unoDot(s.activeColor) + " " + (UNO_COLOR_NAMES[s.activeColor] || "—");
    set("[data-dir]", "Sens " + (s.dir === 1 ? "↻" : "↺"));
    const pend = stage.querySelector("[data-pending]");
    if (pend) { pend.hidden = !(s.pendingDraw > 0); pend.textContent = "+" + s.pendingDraw; }

    s.players.forEach((p) => {
      const pod = stage.querySelector('[data-seat="' + p.id + '"]');
      if (!pod) return;
      const av = pod.querySelector("[data-av]");
      if (p.avatar) { av.style.background = p.avatar.color; if (av.textContent !== p.avatar.emoji) av.textContent = p.avatar.emoji; }
      else { av.style.background = "#4C46F0"; av.textContent = (p.name || "?")[0].toUpperCase(); }
      const nm = pod.querySelector("[data-nm]"); if (nm.textContent !== p.name) nm.textContent = p.name;
      pod.classList.toggle("turn", p.id === s.turn);
      pod.classList.toggle("off", p.connected === false);
      // fan of backs: rebuild only when the count changes
      const fan = pod.querySelector("[data-fan]");
      if (fan.dataset.n !== String(p.count)) { fan.innerHTML = fanHtml(p.count); fan.dataset.n = String(p.count); }
      const cnt = pod.querySelector("[data-cnt]");
      const ct = p.count + (p.count > 1 ? " cartes" : " carte");
      if (cnt.textContent !== ct) cnt.textContent = ct;
      // action line: UNO shout, else the card this player just played
      const act = pod.querySelector("[data-act]");
      let a = "";
      if (p.said && p.count === 1) a = '<span class="cscd-uno">UNO !</span>';
      else if (s.lastAction && s.lastAction.name === p.name) a = lastActionLabel(s.lastAction);
      if (act.dataset.v !== a) { act.innerHTML = a; act.dataset.v = a; }
    });
  }

  function fanHtml(count) {
    const k = Math.max(0, Math.min(count, 5));
    let h = "";
    for (let i = 0; i < k; i++) {
      const t = k > 1 ? i - (k - 1) / 2 : 0;
      const img = UNO_BACKS[i % UNO_BACKS.length];
      h += `<span class="b" style="background-image:url('${img}');transform:translate(calc(-50% + ${t * 11}px),0) rotate(${t * 8}deg)"></span>`;
    }
    return h;
  }
  function wireCheats() {
    root.querySelectorAll(".uno-cheat").forEach((b) => {
      b.onclick = () => socket.emit("host:cheat", { cheatId: b.getAttribute("data-cheat") });
    });
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
