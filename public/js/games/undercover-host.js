// undercover-host.js -- Host-side board for the Undercover game (all phases).
(function () {
  const socket = window.socket;
  const root = document.getElementById("game-root");
  let state = null;
  let cheats = [];

  // Register the sounds (played on the host screen). Missing files stay silent.
  if (window.Sound) {
    Sound.register("reglages", "/sounds/reglages.mp3");
    Sound.register("distribution", "/sounds/distribution.mp3");
    // Several variants -> played at random so they don't get repetitive.
    Sound.register("ambiance", ["/sounds/ambiance.mp3", "/sounds/ambiance2.mp3"], { loop: true, volume: 0.35 });
    Sound.register("vote", ["/sounds/vote.mp3", "/sounds/vote2.mp3"]);
    // Elimination sound depends on the eliminated player's role.
    Sound.register("elim-civil", "/sounds/elimination-Civil.mp3");
    Sound.register("elim-undercover", "/sounds/elimination-Undercover.mp3");
    Sound.register("mrwhite", "/sounds/mrwhite.mp3");
    Sound.register("victoire", "/sounds/victoire.mp3");
  }
  // Play the right sound when the game changes phase.
  function phaseSound(next, s) {
    if (!window.Sound) return;
    if (next === "settings") { Sound.fadeOut("ambiance", 500); Sound.play("reglages"); }
    else if (next === "distribution") { Sound.play("distribution"); Sound.play("ambiance"); }
    else if (next === "vote") Sound.play("vote");
    else if (next === "reveal") {
      const role = s.lastEliminated && s.lastEliminated.role;
      if (role === "civil") Sound.play("elim-civil");
      else if (role === "undercover") Sound.play("elim-undercover");
      // Mr. White reveal: his sting already played when he was exposed.
    } else if (next === "mrwhite") Sound.play("mrwhite");
    else if (next === "ended") { Sound.fadeOut("ambiance", 700); Sound.play("victoire"); }
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
      return `<li class="uc-player${p.alive ? "" : " out"}">${num}${p.name}</li>`;
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
        <h1 class="uc-title">Reglages</h1>
        <p class="subtitle">Les joueurs votent sur leur telephone — <strong id="uc-countdown">…</strong></p>
        ${mrRow}
        <p class="subtitle">Mode :</p>
        <ul class="uc-order">${modeRows}</ul>
        <p class="uc-wait">${s.voted}/${s.total} ont vote</p>
        <button id="btn-finalize" class="uc-btn">Lancer maintenant</button>`;
    } else if (s.phase === "distribution") {
      html = `<p class="uc-eyebrow">Dossier confidentiel${s.universe ? " — " + s.universe : ""}</p>
        <h1 class="uc-title">Distribution</h1>
        <p class="subtitle">Chaque joueur decouvre sa carte sur son telephone.</p>
        ${orderList(s, false)}
        <button id="btn-begin" class="uc-btn">Commencer les indices</button>${cheatBar()}`;
    } else if (s.phase === "clues") {
      html = `<p class="uc-eyebrow">Manche ${s.round}${s.universe ? " — " + s.universe : ""}</p>
        <h1 class="uc-title">Tour d'indices</h1>
        <p class="subtitle">Chacun donne UN indice a l'oral, dans l'ordre.</p>
        ${orderList(s, true)}
        <button id="btn-vote" class="uc-btn">Passer au vote</button>${cheatBar()}`;
    } else if (s.phase === "vote") {
      html = `<p class="uc-eyebrow">Manche ${s.round}</p>
        <h1 class="uc-title">Vote</h1>
        <p class="subtitle">${s.votesCount}/${s.votesNeeded} ont vote</p>
        ${orderList(s, false)}
        <button id="btn-resolve" class="uc-btn ghost">Forcer la revelation</button>${cheatBar()}`;
    } else if (s.phase === "mrwhite") {
      html = `<p class="uc-eyebrow">Demasque !</p>
        <h1 class="uc-title uc-expose">${s.mrwhite.name} etait MR. WHITE</h1>
        <p class="subtitle">Derniere chance : il tente de deviner le mot des civils, devant tout le monde…</p>${cheatBar()}`;
    } else if (s.phase === "reveal") {
      let txt;
      if (s.mrwhiteGuessResult) {
        txt = s.mrwhiteGuessResult.correct
          ? `Mr. White a devine « <strong>${s.mrwhiteGuessResult.guess}</strong> » — CORRECT ! Il vole la victoire.`
          : `Mr. White a propose « <strong>${s.mrwhiteGuessResult.guess}</strong> » — rate. Il est elimine.`;
      } else if (s.lastEliminated) {
        txt = `<strong>${s.lastEliminated.name}</strong> est elimine — c'etait un <strong>${ucRoleLabel(s.lastEliminated.role)}</strong>.`;
      } else {
        txt = "Egalite : personne n'est elimine cette manche.";
      }
      html = `<h1 class="uc-title">Elimination</h1><p class="uc-elim">${txt}</p>
        <button id="btn-next" class="uc-btn">${s.winner ? "Voir le resultat" : "Manche suivante"}</button>${cheatBar()}`;
    } else if (s.phase === "ended") {
      html = endScreen(s);
    }

    root.innerHTML = html;
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
    let secret;
    if (s.pair.kind === "word") {
      secret = `<div class="uc-pair"><span>Mot des civils : <strong>${s.pair.civil}</strong></span>
        <span>Mot de l'undercover : <strong>${s.pair.undercover}</strong></span></div>`;
    } else {
      secret = `<div class="uc-pair"><span>Civils : <strong>${s.pair.civil.name}</strong></span>
        <span>Undercover : <strong>${s.pair.undercover.name}</strong></span></div>`;
    }
    const rolesList = (s.finalRoles || []).map((r) =>
      `<li class="uc-player">${r.name} — ${ucRoleLabel(r.role)}</li>`).join("");
    return `<p class="uc-eyebrow">Fin de partie</p>
      <h1 class="uc-title">${winTxt}</h1>${secret}
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
      <h2>Roles (host seulement)</h2>
      <ul class="uc-order">${roles.map((r) => `<li class="uc-player">${r.name} — ${r.role}</li>`).join("")}</ul>
      <button class="uc-btn" id="uc-roles-close">Fermer</button></div>`;
    ov.classList.add("show");
    document.getElementById("uc-roles-close").onclick = () => ov.classList.remove("show");
  }

  function bind(id, fn) { const el = document.getElementById(id); if (el) el.onclick = fn; }
})();
