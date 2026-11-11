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
    // Music per mode: drop public/sounds/ambiance-anime.mp3 to give the anime
    // modes their own ambiance (until then they keep the usual one).
    fetch("/sounds/ambiance-anime.mp3", { method: "HEAD" }).then((r) => {
      if (r.ok) { Sound.registerAuto("ambiance-anime", "ambiance-anime", { loop: true }); hasAnimeMusic = true; }
    }).catch(() => {});
  }
  let hasAnimeMusic = false;
  const ambianceFor = (s) => (hasAnimeMusic && s && s.mode && s.mode !== "classique" ? "ambiance-anime" : "ambiance");
  // MUSIC (reglages / ambiance / vote / victoire) = one at a time, CROSS-FADED.
  // SFX (distribution / elimination / mrwhite) = played OVER the music, which
  // ducks 50% -> 10% (2s down, effect, 2s back up).
  function phaseSound(next, s) {
    if (!window.Sound) return;
    if (next === "settings") Sound.music("reglages");
    else if (next === "distribution") { Sound.music(ambianceFor(s)); Sound.sfx("distribution"); }
    else if (next === "clues") Sound.music(ambianceFor(s)); // back to ambiance between rounds
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
  let proposals = [];
  socket.on("uc:proposals", (list) => { proposals = list || []; if (state && (state.phase === "settings" || state.phase === "ended")) render(); });

  function send(type, payload) { socket.emit("game:action", { type, payload }); }

  // Live countdowns: settings vote, debate, last word ([data-ends] = end time).
  setInterval(() => {
    const el = document.getElementById("uc-countdown");
    if (el && state && state.endsAt) {
      const s = Math.max(0, Math.round((state.endsAt - Date.now()) / 1000));
      el.textContent = s + "s";
    }
    document.querySelectorAll("[data-ends]").forEach((x) => {
      x.textContent = Math.max(0, Math.ceil((+x.dataset.ends - Date.now()) / 1000)) + " s";
    });
  }, 250);

  // numbered = clue turn order; marks: the current speaker, their written clue
  // (bots), and a ✓ for those who have voted (never for whom, unless public).
  function orderList(s, numbered) {
    const voted = s.phase === "vote" ? new Set(s.votedIds || []) : null;
    let n = 0;
    return `<ul class="uc-order">` + s.order.map((p) => {
      const num = numbered && p.alive ? `<span class="uc-turn">${++n}</span>` : "";
      const av = window.PixelAvatar && p.avatar ? `<img class="px-av" src="${PixelAvatar.url(p.avatar)}" width="30" height="30" alt=""> ` : "";
      const speaking = s.speaker === p.id;
      const clue = s.clues && s.clues[p.id] ? `<span class="uc-clue">« ${esc(s.clues[p.id])} »</span>` : "";
      const tick = voted && p.alive ? (voted.has(p.id) ? `<span class="uc-tick">✓ a voté</span>` : `<span class="uc-tick wait">…</span>`) : "";
      return `<li class="uc-player${p.alive ? "" : " out"}${speaking ? " speaking" : ""}">${num}${av}${esc(p.name)}${speaking ? ` <span class="uc-now">parle</span>` : ""}${clue}${tick}</li>`;
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
        ${optionsPanel(s)}
        <p class="subtitle">Nombre d'undercovers (choix du host) :</p>
        <div class="uc-under">${["auto"].concat(Array.from({ length: Math.min(3, s.maxUnder) }, (_, i) => i + 1)).map((v) =>
          `<button class="uc-set-btn${String(s.nbUnder) === String(v) ? " on" : ""}" data-under="${v}">${v === "auto" ? "Auto" : v}</button>`).join("")}</div>
        <p class="uc-wait">${s.voted}/${s.total} ont voté</p>
        <div class="uc-row"><button id="btn-howto" class="uc-btn ghost">Comment jouer ?</button>
        <button id="btn-finalize" class="uc-btn">Lancer maintenant</button></div>
        ${proposalsPanel()}${ratingsPanel(s.ratings)}`;
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
        <div class="uc-row">
          ${s.speaker ? `<button id="btn-next-speaker" class="uc-btn ghost">Joueur suivant →</button>` : `<span class="uc-wait">Tout le monde a parlé.</span>`}
          ${s.opts && s.opts.debateSec && !s.debateEndsAt ? `<button id="btn-debate" class="uc-btn ghost">Débat (${s.opts.debateSec} s)</button>` : ""}
          ${s.debateEndsAt ? `<span class="uc-timer">Débat : <b data-ends="${s.debateEndsAt}">…</b> puis vote</span>` : ""}
          <button id="btn-vote" class="uc-btn">Passer au vote</button></div>${cheatBar()}`;
    } else if (s.phase === "vote") {
      html = `<p class="uc-eyebrow">Manche ${s.round}</p>
        <h1 class="uc-title">${s.tie ? "Égalité !" : "Vote"}</h1>
        ${s.tie ? `<p class="subtitle">Revote entre ${s.tie.map((t) => esc(t.name)).join(" et ")}</p>` : ""}
        <p class="subtitle">${s.votesCount}/${s.votesNeeded} ont voté</p>
        ${orderList(s, false)}
        ${s.publicVotes && s.publicVotes.length ? `<ul class="uc-public">${s.publicVotes.map(([a, b]) => `<li>${esc(a)} → <b>${esc(b)}</b></li>`).join("")}</ul>` : ""}
        <button id="btn-resolve" class="uc-btn ghost">Forcer la révélation</button>${cheatBar()}`;
    } else if (s.phase === "defense" && s.defense) {
      html = `<p class="uc-eyebrow">Manche ${s.round}</p>
        <h1 class="uc-title">Dernière parole</h1>
        <p class="uc-elim"><strong>${esc(s.defense.name)}</strong> a <b data-ends="${s.defense.endsAt}">10 s</b> pour se défendre.</p>
        <div class="uc-row"><button id="btn-confirm" class="uc-btn">Éliminer ${esc(s.defense.name)}</button>
        <button id="btn-revote" class="uc-btn ghost">Revoter</button></div>${cheatBar()}`;
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
    bind("btn-next-speaker", () => send("nextSpeaker"));
    bind("btn-debate", () => send("startDebate"));
    bind("btn-confirm", () => send("confirmElim"));
    bind("btn-revote", () => send("revoteDefense"));
    bind("btn-howto", () => ucHowTo());
    root.querySelectorAll("[data-opt]").forEach((el) => {
      el.onchange = el.onclick = (e) => {
        if (el.tagName === "BUTTON") { send("setOption", { key: el.dataset.opt, value: JSON.parse(el.dataset.val) }); return; }
        if (e.type === "change") send("setOption", { key: el.dataset.opt, value: el.value });
      };
    });
    root.querySelectorAll("[data-pair]").forEach((b) => (b.onclick = () => send("answerPair", { id: b.dataset.pair, ok: b.dataset.ok === "1" })));
    if (s.phase === "ended") loadEndImages(s);
    root.querySelectorAll(".uc-cheat").forEach((b) => {
      b.onclick = () => socket.emit("host:cheat", { cheatId: b.getAttribute("data-cheat") });
    });
  }

  let flippedFor = null; // the game whose roles were already turned over
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
    // the two characters' pictures (anime modes)
    const imgs = s.pair.kind === "character" ? `<div class="uc-end-imgs">
        <figure><img id="uc-img-civ" alt="" hidden><figcaption>Civils</figcaption></figure>
        <figure><img id="uc-img-und" alt="" hidden><figcaption>Undercover</figcaption></figure></div>` : "";
    // roles turn over one by one (CSS animation, delay per card)
    // (only the FIRST time this end screen is drawn: later updates, like a 👍,
    // must not restart the animation)
    const animate = flippedFor !== s.pair.key;
    flippedFor = s.pair.key;
    const rolesList = (s.finalRoles || []).map((r, i) =>
      `<li class="uc-player${animate ? " uc-flip" : ""} role-${r.role}"${animate ? ` style="animation-delay:${0.35 * i}s"` : ""}>${esc(r.name)} — ${ucRoleLabel(r.role)}</li>`).join("");
    return `<p class="uc-eyebrow">Fin de partie</p>
      <h1 class="uc-title">${winTxt}</h1>${leftTxt}${imgs}${secret}
      <ul class="uc-order">${rolesList}</ul>
      ${recapHtml(s.voteLog)}${eveningHtml(s.evening)}
      <button id="btn-replay" class="uc-btn">Rejouer (nouveau vote de mode)</button>
      ${proposalsPanel()}${ratingsPanel(s.ratings)}`;
  }

  // ---- pieces of the screens ----
  // Host options (before dealing). Each button sends setOption; values are
  // JSON so true/false/numbers keep their type.
  function optionsPanel(s) {
    const o = s.opts || {}, V = s.optValues || {};
    const chip = (key, val, label) => `<button class="uc-set-btn${o[key] === val ? " on" : ""}" data-opt="${key}" data-val='${JSON.stringify(val)}'>${label}</button>`;
    return `<details class="uc-opts" open><summary>Options du host</summary>
      <div class="uc-opt"><span>Dernière parole (10 s avant l'élimination)</span>${chip("lastWord", true, "Oui")}${chip("lastWord", false, "Non")}</div>
      <div class="uc-opt"><span>Minuteur de débat avant le vote</span>${(V.debateSec || [0]).map((v) => chip("debateSec", v, v ? v + " s" : "Non")).join("")}</div>
      <div class="uc-opt"><span>Vote public (on voit qui vote pour qui)</span>${chip("votePublic", false, "Non")}${chip("votePublic", true, "Oui")}</div>
      <div class="uc-opt"><span>Classique : catégorie</span><select data-opt="category" aria-label="Catégorie de mots">${(V.category || ["all"]).map((c) =>
        `<option value="${esc(c)}"${o.category === c ? " selected" : ""}>${c === "all" ? "Toutes" : c === "Perso" ? "Paires proposées" : esc(c)}</option>`).join("")}</select></div>
      <div class="uc-opt"><span>Classique : difficulté</span>${(V.difficulty || ["all"]).map((d) => chip("difficulty", d, { all: "Toutes", facile: "Facile", normal: "Normale", expert: "Expert" }[d])).join("")}</div>
    </details>`;
  }
  function proposalsPanel() {
    if (!proposals.length) return "";
    return `<div class="uc-props"><h2>Paires proposées par les joueurs</h2><ul class="uc-order">${proposals.map((p) =>
      `<li class="uc-player"><span>${esc(p.a)} / ${esc(p.b)} <small>(${p.kind === "character" ? "persos" : "mots"}, par ${esc(p.by)})</small></span>
        <button class="uc-set-btn" data-pair="${p.id}" data-ok="1">✓ Ajouter</button><button class="uc-set-btn" data-pair="${p.id}" data-ok="0">✕</button></li>`).join("")}</ul></div>`;
  }
  function ratingsPanel(list) {
    if (!list || !list.length) return "";
    return `<details class="uc-opts"><summary>Notes des paires ce soir (${list.length})</summary><ul class="uc-order">${list.map((r) =>
      `<li class="uc-player"><span>${esc(r.pair)}</span><span>👍 ${r.up} · 👎 ${r.down}</span></li>`).join("")}</ul></details>`;
  }
  function recapHtml(log) {
    if (!log || !log.length) return "";
    return `<details class="uc-opts"><summary>Qui a voté qui</summary>${log.map((r) => `<p class="uc-wait"><b>Manche ${r.round}</b> — ${r.out ? esc(r.out) + " éliminé" : "personne"}<br>${
      r.votes.map(([a, b, imp]) => `${esc(a)} → ${esc(b)}${imp ? " ✔" : ""}`).join(" · ")}</p>`).join("")}</details>`;
  }
  function eveningHtml(e) {
    if (!e || !e.scores || !e.scores.length) return "";
    const line = (lbl, x, one, many) => (x ? `<li class="uc-player"><span>${lbl}</span><span><b>${esc(x.name)}</b> (${x.n} ${x.n > 1 ? many : one})</span></li>` : "");
    return `<div class="uc-evening"><h2>Score de la soirée</h2><ol class="uc-order">${e.scores.map((x, i) =>
      `<li class="uc-player"><span>${i + 1}. ${esc(x.name)}</span><b>${x.pts} pts</b></li>`).join("")}</ol>
      <ul class="uc-order">${line("Meilleur imposteur", e.impostor, "victoire", "victoires")}${line("Meilleur détective", e.detective, "bon vote", "bons votes")}${line("Mr. White le plus chanceux", e.mrwhite, "mot trouvé", "mots trouvés")}</ul></div>`;
  }
  function loadEndImages(s) {
    if (s.pair.kind !== "character" || !window.ucAnimeImage) return;
    [["uc-img-civ", s.pair.civil], ["uc-img-und", s.pair.undercover]].forEach(([id, c]) => {
      ucAnimeImage(c.name, c.series).then((url) => { const im = document.getElementById(id); if (im && url) { im.src = url; im.hidden = false; } });
    });
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
