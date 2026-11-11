// undercover-host.js -- Host-side board for the Undercover game (all phases).
(function () {
  // Player names and typed text are put in the page as TEXT, never as HTML
  // (otherwise a name like "<img onerror=...>" would run code on other screens).
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const socket = window.socket;
  const root = document.getElementById("game-root");
  let state = null;
  let cheats = [];

  // Register the sounds (played on the host screen). Missing files stay silent.
  if (window.Sound) {
    // registerAuto uses <base>.mp3 and auto-discovers <base>2.mp3 .. <base>8.mp3,
    // so just dropping new files in public/sounds/ adds variants (no code change).
    Sound.registerAuto("reglages", "reglages");
    Sound.registerAuto("distribution", "distribution");
    Sound.registerAuto("ambiance", "ambiance", { loop: true });
    Sound.registerAuto("vote", "vote");
    // Elimination sound depends on the eliminated player's role.
    Sound.registerAuto("elim-civil", "elimination-Civil");
    Sound.registerAuto("elim-undercover", "elimination-Undercover");
    Sound.registerAuto("mrwhite", "mrwhite");
    Sound.registerAuto("victoire", "victoire");
  }
  // MUSIC (reglages / ambiance / vote / victoire) = one at a time, CROSS-FADED.
  // SFX (distribution / elimination / mrwhite) = played OVER the music, which
  // ducks 50% -> 10% (2s down, effect, 2s back up).
  function phaseSound(next, s) {
    if (!window.Sound) return;
    if (next === "settings") Sound.music("reglages");
    else if (next === "distribution") { Sound.music("ambiance"); Sound.sfx("distribution"); }
    else if (next === "clues") Sound.music("ambiance"); // back to ambiance between rounds
    else if (next === "vote") Sound.music("vote");
    else if (next === "reveal") {
      const role = s.lastEliminated && s.lastEliminated.role;
      if (role === "civil") Sound.sfx("elim-civil");
      else if (role === "undercover") Sound.sfx("elim-undercover");
      // Mr. White reveal: his sting already played when he was exposed.
    } else if (next === "mrwhite") Sound.music("mrwhite"); // treated as a music: cuts the rest
    else if (next === "ended") Sound.music("victoire");
  }

  // Load this game's cheats so we can show the host cheat bar during the game.
  fetch("/api/games/undercover").then((r) => r.json())
    .then((g) => { cheats = g.cheats || []; render(); })
    .catch(() => {});

  socket.on("uc:state", (s) => {
    const prevPhase = state ? state.phase : null;
    state = s;
    if (s.themeKey) applyUcTheme(s.themeKey);
    if (s.phase !== prevPhase) phaseSound(s.phase, s);
    render();
  });
  socket.on("uc:cheatReveal", ({ roles }) => showRolesOverlay(roles));

  function send(type, payload) { socket.emit("game:action", { type, payload }); }

  // Live countdown for the settings phase.
  setInterval(() => {
    const el = document.getElementById("uc-countdown");
    if (el && state && state.endsAt) {
      const s = Math.max(0, Math.round((state.endsAt - Date.now()) / 1000));
      el.textContent = s + "s";
    }
  }, 500);

  function orderList(s, numbered) {
    return `<ul class="uc-order">` + s.order.map((p, i) => {
      const num = numbered ? `<span class="uc-turn">${i + 1}</span>` : "";
      const av = window.PixelAvatar && p.avatar ? `<img class="px-av" src="${PixelAvatar.url(p.avatar)}" width="30" height="30" alt=""> ` : "";
      return `<li class="uc-player${p.alive ? "" : " out"}">${num}${av}${esc(p.name)}</li>`;
    }).join("") + `</ul>`;
  }

  function cheatBar() {
    if (!cheats.length) return "";
    const btns = cheats.map((c) =>
      `<button class="uc-cheat" data-cheat="${c.id}">${c.emoji || "✨"} ${c.label}</button>`).join("");
    return `<div class="uc-cheatbar"><span class="uc-cheatbar-title">Console host</span>${btns}</div>`;
  }

  function render() {
    if (!state) return;
    const s = state;
    let html = "";

    if (s.phase === "settings") {
      const modeRows = s.modes.map((m) =>
        `<li class="uc-player"><span>${m.label}</span><span class="uc-count">${s.modeCounts[m.key] || 0}</span></li>`).join("");
      const mrRow = s.mrWhiteAllowed
        ? `<div class="uc-pair"><span>Mr. White — Oui : <strong>${s.mrYes}</strong> / Non : <strong>${s.mrNo}</strong></span></div>`
        : `<div class="uc-pair"><span>Mr. White indisponible (4 joueurs minimum)</span></div>`;
      html = `<p class="uc-eyebrow">Mise en place</p>
        <h1 class="uc-title">Réglages</h1>
        <p class="subtitle">Les joueurs votent sur leur téléphone — <strong id="uc-countdown">…</strong></p>
        ${mrRow}
        <p class="subtitle">Mode :</p>
        <ul class="uc-order">${modeRows}</ul>
        <p class="subtitle">Nombre d'undercovers (choix du host) :</p>
        <div class="uc-under">${["auto"].concat(Array.from({ length: Math.min(3, s.maxUnder) }, (_, i) => i + 1)).map((v) =>
          `<button class="uc-set-btn${String(s.nbUnder) === String(v) ? " on" : ""}" data-under="${v}">${v === "auto" ? "Auto" : v}</button>`).join("")}</div>
        <p class="uc-wait">${s.voted}/${s.total} ont voté</p>
        <button id="btn-finalize" class="uc-btn">Lancer maintenant</button>`;
    } else if (s.phase === "distribution") {
      html = `<p class="uc-eyebrow">Dossier confidentiel${s.universe ? " — " + s.universe : ""}</p>
        <h1 class="uc-title">Distribution</h1>
        <p class="subtitle">Chaque joueur découvre sa carte sur son téléphone.</p>
        ${orderList(s, false)}
        <button id="btn-begin" class="uc-btn">Commencer les indices</button>${cheatBar()}`;
    } else if (s.phase === "clues") {
      html = `<p class="uc-eyebrow">Manche ${s.round}${s.universe ? " — " + s.universe : ""}</p>
        <h1 class="uc-title">Tour d'indices</h1>
        <p class="subtitle">Chacun donne UN indice à l'oral, dans l'ordre.</p>
        ${orderList(s, true)}
        <button id="btn-vote" class="uc-btn">Passer au vote</button>${cheatBar()}`;
    } else if (s.phase === "vote") {
      html = `<p class="uc-eyebrow">Manche ${s.round}</p>
        <h1 class="uc-title">${s.tie ? "Égalité !" : "Vote"}</h1>
        ${s.tie ? `<p class="subtitle">Revote entre ${s.tie.map((t) => esc(t.name)).join(" et ")}</p>` : ""}
        <p class="subtitle">${s.votesCount}/${s.votesNeeded} ont voté</p>
        ${orderList(s, false)}
        <button id="btn-resolve" class="uc-btn ghost">Forcer la révélation</button>${cheatBar()}`;
    } else if (s.phase === "mrwhite") {
      html = `<p class="uc-eyebrow">Démasqué !</p>
        <h1 class="uc-title uc-expose">${esc(s.mrwhite.name)} était MR. WHITE</h1>
        <p class="subtitle">Dernière chance : il tente de deviner le mot des civils, devant tout le monde…</p>${cheatBar()}`;
    } else if (s.phase === "reveal") {
      let txt;
      if (s.mrwhiteGuessResult && s.mrwhiteGuessResult.left) {
        txt = `Mr. White a quitté la partie sans deviner : il est éliminé.`;
      } else if (s.mrwhiteGuessResult) {
        txt = s.mrwhiteGuessResult.correct
          ? `Mr. White a deviné « <strong>${esc(s.mrwhiteGuessResult.guess)}</strong> » — CORRECT ! Il vole la victoire.`
          : `Mr. White a proposé « <strong>${esc(s.mrwhiteGuessResult.guess)}</strong> » — raté. Il est éliminé.`;
      } else if (s.lastEliminated) {
        txt = `<strong>${esc(s.lastEliminated.name)}</strong> est éliminé — c'était un <strong>${ucRoleLabel(s.lastEliminated.role)}</strong>.`;
      } else {
        txt = "Égalité : personne n'est éliminé cette manche.";
      }
      html = `<h1 class="uc-title">Élimination</h1><p class="uc-elim">${txt}</p>
        <button id="btn-next" class="uc-btn">${s.winner ? "Voir le résultat" : "Manche suivante"}</button>${cheatBar()}`;
    } else if (s.phase === "ended") {
      html = endScreen(s);
    }

    // someone left the game: say it (20 s), instead of a silent change
    if (s.lastLeft && s.phase !== "settings" && Date.now() - s.lastLeft.at < 20000) {
      html = `<p class="uc-notice">${esc(s.lastLeft.name)} a quitté la partie.</p>` + html;
    }
    root.innerHTML = html;
    root.querySelectorAll("[data-under]").forEach((b) => (b.onclick = () => send("setUndercovers", { value: b.dataset.under })));
    bind("btn-finalize", () => send("finalizeSettings"));
    bind("btn-begin", () => send("beginClues"));
    bind("btn-vote", () => send("toVote"));
    bind("btn-resolve", () => send("resolveVote"));
    bind("btn-next", () => send("next"));
    bind("btn-replay", () => send("replay"));
    root.querySelectorAll(".uc-cheat").forEach((b) => {
      b.onclick = () => socket.emit("host:cheat", { cheatId: b.getAttribute("data-cheat") });
    });
  }

  function endScreen(s) {
    const winTxt = s.winner === "civils" ? "Les Civils l'emportent !" : "Les Imposteurs l'emportent !";
    const leftTxt = s.lastLeft ? `<p class="uc-notice">${esc(s.lastLeft.name)} a quitté la partie.</p>` : "";
    let secret;
    if (s.pair.kind === "word") {
      secret = `<div class="uc-pair"><span>Mot des civils : <strong>${esc(s.pair.civil)}</strong></span>
        <span>Mot de l'undercover : <strong>${esc(s.pair.undercover)}</strong></span></div>`;
    } else {
      secret = `<div class="uc-pair"><span>Civils : <strong>${esc(s.pair.civil.name)}</strong></span>
        <span>Undercover : <strong>${esc(s.pair.undercover.name)}</strong></span></div>`;
    }
    // why this pair was chosen + what the players thought of it
    if (s.pair.why) secret += `<p class="uc-wait">Le point commun : ${esc(s.pair.why)}</p>`;
    const r = s.rating || { up: 0, down: 0 };
    secret += `<p class="uc-wait uc-rate-count">Notez la paire sur vos téléphones : 👍 ${r.up} · 👎 ${r.down}</p>`;
    const rolesList = (s.finalRoles || []).map((r) =>
      `<li class="uc-player">${esc(r.name)} — ${ucRoleLabel(r.role)}</li>`).join("");
    return `<p class="uc-eyebrow">Fin de partie</p>
      <h1 class="uc-title">${winTxt}</h1>${leftTxt}${secret}
      <ul class="uc-order">${rolesList}</ul>
      <button id="btn-replay" class="uc-btn">Rejouer (nouveau vote de mode)</button>`;
  }

  function showRolesOverlay(roles) {
    let ov = document.getElementById("uc-roles-overlay");
    if (!ov) {
      ov = document.createElement("div");
      ov.id = "uc-roles-overlay";
      ov.className = "uc-overlay";
      document.body.appendChild(ov);
    }
    ov.innerHTML = `<div class="uc-sheet">
      <h2>Rôles (host seulement)</h2>
      <ul class="uc-order">${roles.map((r) => `<li class="uc-player">${esc(r.name)} — ${esc(r.role)}</li>`).join("")}</ul>
      <button class="uc-btn" id="uc-roles-close">Fermer</button></div>`;
    ov.classList.add("show");
    document.getElementById("uc-roles-close").onclick = () => ov.classList.remove("show");
  }

  function bind(id, fn) { const el = document.getElementById(id); if (el) el.onclick = fn; }
})();
