// host.js -- Host (SHARED SCREEN, "TV view") of "Kietkoutsa Reborn".
//
// This screen is seen by EVERYONE. So nothing private is ever drawn on it:
//   - if the host does not play (default with 3+ phones): pure TV view;
//   - if the host plays, their picks / votes live in a "secret panel" that
//     covers the screen only while they use it (closes by itself after a vote).
// Cheats are in a small drawer (🎛️, bottom-right), not on the main screen.
// Only reacts to kkt:* events. Blocks are PATCHED (kktPatch) instead of
// rebuilt, so covers do not reload and nothing flickers on every vote.
(function () {
  const socket = window.socket;
  const root = document.getElementById("game-root");
  const ME = "__host__"; // the host's seat id in this game (when it plays)
  let state = null, you = null, cheats = [], prevPhase = null;
  let built = null, audioKey = null, revealKey = null, search = null, secretSearch = false;
  let wrapped = { idx: 0, timer: null, done: false }, endTab = "score", lastPreload = "";
  kktInjectStyles();
  kktAudio.enableViz(true); // route previews through our server -> real visualiser

  // ----- sounds (optional files in games/kietkoutsa/sounds/) -----
  const DIR = "/games/kietkoutsa/sounds/";
  if (window.Sound) {
    Sound.registerAuto("kkt-lobby", "lobby", { loop: true, dir: DIR });
    Sound.registerAuto("kkt-reveal", "reveal", { dir: DIR });
    Sound.registerAuto("kkt-victoire", "victoire", { dir: DIR });
  }
  function phaseSound(ph) {
    if (!window.Sound) return;
    if (ph === "settings" || ph === "submit") Sound.music("kkt-lobby");
    else if (ph === "playing" || ph === "reveal") Sound.stop("kkt-lobby"); // the song itself plays
    else if (ph === "ended") Sound.music("kkt-victoire");
  }

  fetch("/api/games/kietkoutsa").then((r) => r.json()).then((g) => { cheats = g.cheats || []; buildChrome(); }).catch(() => {});

  // Static data (modes, avatar choices) arrives once; merged into every state.
  let STATIC = {};
  socket.on("kkt:static", (d) => { STATIC = d || {}; if (state) { state = Object.assign({}, STATIC, state); render(); } });
  // Full state ("kkt:state") at each new phase, then only the changes
  // ("kkt:patch"). Both are merged here; the screen is redrawn at most once per
  // frame even if several messages arrive together.
  socket.on("kkt:patch", (p) => { if (state && p.phase === state.phase) applyState(Object.assign({}, state, p)); });
  socket.on("kkt:state", (s) => applyState(Object.assign({}, STATIC, s)));
  let renderQueued = false;
  function renderSoon() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(() => { renderQueued = false; render(); });
  }
  function applyState(s) {
    if (s.phase !== prevPhase) {
      phaseSound(s.phase);
      if (s.phase !== "playing") { kktAudio.stop(); audioKey = null; }
      if (s.phase !== "ended") { wrapped = { idx: 0, timer: null, done: false }; }
      closeSecret();
      prevPhase = s.phase;
    }
    state = s;
    renderSoon();
  }
  socket.on("kkt:you", (d) => { you = d; renderSoon(); });
  socket.on("kkt:toast", ({ msg }) => kktToast(msg));
  socket.on("kkt:cheatReveal", ({ name }) => kktToast("👁️ C'est " + name + " qui a mis ce son"));
  socket.on("kkt:spy", ({ name, vote }) => kktToast("🕵️ " + name + (vote ? " a voté pour " + vote : " n'a pas encore voté")));
  socket.on("kkt:guessResult", (g) => kktShowGuess(g));

  function send(type, payload) { socket.emit("game:action", { type, payload }); }
  setInterval(kktTick, 250);

  const hostPlays = () => !!(state && state.settings && state.settings.hostPlays);
  const roomCode = () => (document.getElementById("room-code") || {}).textContent || "";

  // ---------- fixed chrome: cheat drawer, join QR, secret panel ----------
  function buildChrome() {
    if (document.getElementById("kkt-drawer-btn")) return;
    const btn = document.createElement("button");
    btn.id = "kkt-drawer-btn"; btn.className = "kkt-drawer-btn"; btn.title = "Console du host"; btn.textContent = "🎛️";
    const dr = document.createElement("div");
    dr.id = "kkt-drawer"; dr.className = "kkt-drawer";
    dr.innerHTML = cheats.map((c) => `<button class="kkt-cheat" data-cheat="${kktEsc(c.id)}">${c.emoji || "✨"} ${kktEsc(c.label)}</button>`).join("") +
      `<span class="kkt-small">Les cheats marchent pendant une manche.</span>` +
      // dev mode (?dev=1 or Ctrl+Shift+B): a bot can also join a running game
      (typeof devMode !== "undefined" && devMode ? `<button class="kkt-cheat" id="kkt-addbot">🤖 Ajouter un bot</button>` : "");
    btn.onclick = () => dr.classList.toggle("open");
    dr.querySelectorAll("[data-cheat]").forEach((b) => (b.onclick = () => { socket.emit("host:cheat", { cheatId: b.getAttribute("data-cheat") }); dr.classList.remove("open"); }));
    const ab = dr.querySelector("#kkt-addbot");
    if (ab) ab.onclick = () => { socket.emit("host:addBot"); kktToast("🤖 Un bot arrive"); };
    document.body.appendChild(btn); document.body.appendChild(dr);

    const qr = document.createElement("div");
    qr.id = "kkt-qr-corner"; qr.className = "kkt-qr-corner";
    qr.innerHTML = `<div id="kkt-qr"></div><div>Rejoindre : <b>${kktEsc(roomCode())}</b></div>`;
    document.body.appendChild(qr);
    if (window.JoinQR) JoinQR.draw(document.getElementById("kkt-qr"), roomCode(), 84);

    const sec = document.createElement("div");
    sec.id = "kkt-secret"; sec.className = "kkt-secret";
    sec.innerHTML = `<div class="kkt-wrap"><div class="kkt-row" style="justify-content:space-between">
        <p class="kkt-eyebrow">🔒 Panneau secret du host — les autres, regardez ailleurs 👀</p>
        <button class="kkt-btn ghost sm" id="kkt-secret-close">Fermer</button></div>
      <div id="kkt-secret-body"></div><div id="kkt-secret-guess"></div><div id="kkt-secret-search"></div></div>`;
    document.body.appendChild(sec);
    document.getElementById("kkt-secret-close").onclick = closeSecret;

    const sb = document.createElement("button");
    sb.id = "kkt-secret-btn"; sb.className = "kkt-btn kkt-secret-btn"; sb.hidden = true;
    sb.onclick = openSecret;
    document.body.appendChild(sb);
    // chrome only while the game screen is shown: react when #game-root's class
    // changes (no timer running every half second)
    const sync = () => {
      const inGame = !root.classList.contains("hidden");
      btn.hidden = !inGame; qr.hidden = !inGame || (state && state.phase === "ended");
      if (!inGame) dr.classList.remove("open");
    };
    new MutationObserver(sync).observe(root, { attributes: true, attributeFilter: ["class"] });
    sync();
    window.kktChromeSync = sync;
    render();
  }
  function openSecret() {
    const sec = document.getElementById("kkt-secret");
    if (!sec) return;
    sec.classList.add("open");
    renderSecret();
  }
  function closeSecret() {
    const sec = document.getElementById("kkt-secret");
    if (sec) sec.classList.remove("open");
  }
  // The host's private controls (only when the host plays).
  function renderSecret() {
    const sec = document.getElementById("kkt-secret");
    const sb = document.getElementById("kkt-secret-btn");
    if (!sec || !sb) return;
    const s = state;
    const can = s && hostPlays() && you && (s.phase === "submit" || s.phase === "playing") && !you.late;
    sb.hidden = !can;
    if (!can) { closeSecret(); return; }
    sb.textContent = s.phase === "submit" ? "🔒 Choisir mes sons (en secret)" : "🔒 Voter (en secret)";
    const body = document.getElementById("kkt-secret-body");
    const box = document.getElementById("kkt-secret-search");
    if (s.phase === "submit") {
      body.innerHTML = (s.theme ? `<div class="kkt-banner gold">Thème : ${kktEsc(s.theme)}</div>` : "") +
        (you.target ? `<div class="kkt-banner">🎭 Tu imites <b>${kktEsc(you.target.name)}</b> : mets un son qu'il/elle aurait mis !</div>` : "");
      if (!secretSearch) { search = KktSearch(box, (t, p) => { send(t, p); }); secretSearch = true; }
      box.hidden = false;
      search.update(you, s);
    } else {
      box.hidden = true;
      // vote panel: patched (rebuilt only if it changed)
      const el = kktPatch("kkt-secret-body", kktVotePanel(s, you, ME));
      if (el) kktWireVotePanel(el, s, you, ME, (t, p) => {
        send(t, p);
        if (t === "vote" || t === "lock") setTimeout(closeSecret, 900); // don't leave it on screen
      });
      // blind-test inputs: built once per round so typing is never lost
      const g = document.getElementById("kkt-secret-guess");
      const canGuess = s.settings.blind && !you.ownedParts.includes(0);
      const gk = s.round + "|" + canGuess;
      if (g.getAttribute("data-k") !== gk) {
        g.setAttribute("data-k", gk);
        g.innerHTML = canGuess ? kktGuessBox(s.parts.length > 1) : "";
        kktWireGuess(send);
      }
      if (you.guess) kktShowGuess(you.guess);
    }
  }

  // ---------- one delegated click handler for the main screen ----------
  root.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b || !root.contains(b)) return;
    if (b.hasAttribute("data-set")) {
      const key = b.getAttribute("data-set"), raw = b.getAttribute("data-val");
      const isSwitch = b.classList.contains("kkt-switch");
      return send("setSetting", { key, value: isSwitch ? raw === "1" : raw });
    }
    if (b.hasAttribute("data-mode")) return send("setSetting", { key: "mode", value: b.getAttribute("data-mode") });
    if (b.hasAttribute("data-av-px")) return send("setAvatar", { px: +b.getAttribute("data-av-px") });
    if (b.hasAttribute("data-av-e")) return send("setAvatar", { emoji: b.getAttribute("data-av-e"), color: you && you.avatar && you.avatar.color });
    if (b.hasAttribute("data-av-c")) return send("setAvatar", { emoji: you && you.avatar && you.avatar.emoji, color: b.getAttribute("data-av-c") });
    if (b.hasAttribute("data-tab")) { endTab = b.getAttribute("data-tab"); return renderEnded(state); }
    if (b.hasAttribute("data-rate")) return send("rate", { part: +b.getAttribute("data-part"), v: +b.getAttribute("data-rate") });
    switch (b.id) {
      case "kkt-pp-minus": return send("setSetting", { key: "perPlayer", value: state.settings.perPlayer - 1 });
      case "kkt-pp-plus": return send("setSetting", { key: "perPlayer", value: state.settings.perPlayer + 1 });
      case "kkt-apply-vote": return send("applyModeVote");
      case "kkt-begin": return send("beginSubmit");
      case "kkt-start": return send("startRounds");
      case "kkt-force": return send("startRounds", { force: true });
      case "kkt-next": return send("next");
      case "kkt-replay": return send("replay", { keep: false });
      case "kkt-tourney": return send("replay", { keep: true });
      case "kkt-copy": return kktCopy(kktPlaylistText(state.final.tracks));
      case "kkt-w-prev": return wrappedGo(wrapped.idx - 1);
      case "kkt-w-next": return wrappedGo(wrapped.idx + 1);
      case "kkt-w-skip": wrapped.done = true; clearTimeout(wrapped.timer); return renderEnded(state);
      case "kkt-listen": return kktAudio.resume();
    }
  });

  // Builds the static skeleton of a screen once per `key`.
  function skeleton(key, html) {
    if (built === key && root.firstElementChild) return false;
    built = key; kktPatchReset();
    root.innerHTML = html;
    return true;
  }

  function render() {
    if (!state) return;
    const s = state;
    if (s.phase === "settings") renderSettings(s);
    else if (s.phase === "submit") renderSubmit(s);
    else if (s.phase === "playing") renderPlaying(s);
    else if (s.phase === "reveal") renderReveal(s);
    else if (s.phase === "ended") renderEnded(s);
    renderSecret();
  }

  function playerChips(list, extra) {
    return list.map((p) => `<div class="kkt-pl ${p.connected === false ? "off" : ""} ${extra ? extra(p).cls || "" : ""}">${kktAvatar(p.avatar, 34)}
      <div><div class="nm">${kktEsc(p.name)}${p.host ? " 🖥️" : ""}</div><div class="mt">${extra ? extra(p).txt || "" : ""}</div></div></div>`).join("");
  }

  // ---------- SETTINGS ----------
  function renderSettings(s) {
    if (skeleton("settings", `<div class="kkt-stage"><div class="kkt-wrap kkt-wide">
      <p class="kkt-eyebrow">Mise en place${s.tournament ? " · tournoi, partie " + (s.tournament.games + 1) : ""}</p>
      <h1 class="kkt-title">Kietkoutsa Reborn</h1>
      <div class="kkt-card"><div class="kkt-row" style="justify-content:space-between"><h2 class="kkt-h2" style="margin:0">Mode de jeu</h2>
        <span id="kkt-vote-info" class="kkt-small"></span></div><div id="kkt-modes"></div></div>
      <div class="kkt-grid">
        <div class="kkt-card"><h2 class="kkt-h2" style="margin-top:0">Partie</h2><div id="kkt-set-game"></div></div>
        <div class="kkt-card"><h2 class="kkt-h2" style="margin-top:0">Options</h2><div id="kkt-set-opts"></div></div>
        <div class="kkt-card"><h2 class="kkt-h2" style="margin-top:0">Le host</h2>
          <div id="kkt-set-host"></div>
          <div class="kkt-row" style="margin-top:8px"><input class="kkt-input" id="kkt-hostname" maxlength="16" placeholder="Ton pseudo de host"/>
          <button class="kkt-btn sm ghost" id="kkt-hostname-ok">OK</button></div>
          <div id="kkt-host-av" style="margin-top:10px"></div></div>
      </div>
      <div class="kkt-card"><h2 class="kkt-h2" style="margin-top:0">Participants</h2><div id="kkt-plist" class="kkt-players"></div>
        <p class="kkt-small">Sur les téléphones : chacun choisit son avatar et vote pour un mode.</p></div>
      <div class="kkt-row kkt-center"><button id="kkt-begin" class="kkt-btn">Commencer les propositions</button></div>
      <p id="kkt-begin-hint" class="kkt-sub" style="text-align:center"></p></div></div>`)) {
      const inp = document.getElementById("kkt-hostname");
      inp.value = s.hostName || "";
      const go = () => send("setHostName", { name: inp.value });
      document.getElementById("kkt-hostname-ok").onclick = go;
      inp.onkeydown = (e) => { if (e.key === "Enter") go(); };
    }
    const st = s.settings;
    const tallyN = Object.values(s.modeTally || {}).reduce((a, b) => a + b, 0);
    kktPatch("kkt-modes", `<div class="kkt-modes">` + Object.keys(s.modes || {}).map((id) => {
      const m = s.modes[id], n = (s.modeTally || {})[id];
      return `<button class="kkt-mode ${st.mode === id ? "on" : ""}" data-mode="${id}">${n ? `<span class="tally">${n} 🗳️</span>` : ""}
        <span class="e">${m.emoji}</span><span class="n">${kktEsc(m.label)}</span><span class="r">${kktEsc(m.rule)}</span></button>`;
    }).join("") + `</div>`);
    kktPatch("kkt-vote-info", tallyN ? `${tallyN} vote(s) des téléphones · <button class="kkt-btn sm ghost" id="kkt-apply-vote">Appliquer le vote</button>` : "Les joueurs peuvent voter depuis leur téléphone");
    // The panels are built from the list the server sends (data.js SETTINGS_UI).
    const ui = s.settingsUI || [];
    const block = (group) => ui.filter((x) => x.group === group).map((x) => {
      if (x.kind === "switch") return kktSwitch(x.key, st[x.key], x.label, x.desc);
      const desc = x.key === "perPlayer" ? (st.mode === "truebluff" ? x.desc : "") : (x.desc || "");
      const head = `<div><div class="lb">${kktEsc(x.label)}</div>${desc ? `<div class="ds">${kktEsc(desc)}</div>` : ""}</div>`;
      if (x.kind === "stepper") {
        const lock = st.mode === "truebluff" ? "disabled" : "";
        return `<div class="kkt-sw">${head}<div class="kkt-stepper"><button id="kkt-pp-minus" ${lock}>-</button><span>${st[x.key]}</span><button id="kkt-pp-plus" ${lock}>+</button></div></div>`;
      }
      return `<div class="kkt-sw">${head}${kktChoice(x.key, st[x.key], x.options)}</div>`;
    }).join("");
    kktPatch("kkt-set-game", block("game"));
    kktPatch("kkt-set-opts", block("opts"));
    kktPatch("kkt-set-host", block("host"));
    const hostP = (s.players || []).find((p) => p.id === ME);
    kktPatch("kkt-host-av", st.hostPlays && hostP ? `<p class="kkt-small">Ton avatar :</p>` + kktAvatarPicker(hostP.avatar, s.emojis || [], s.colors || []) : "");
    if (hostP) you = Object.assign({}, you || {}, { avatar: hostP.avatar });
    kktPatch("kkt-plist", playerChips(s.players || [], () => ({ txt: "prêt(e)" })) || `<p class="kkt-sub">Aucun joueur…</p>`);
    const n = (s.players || []).length;
    const bb = document.getElementById("kkt-begin");
    if (bb) bb.disabled = n < 3;
    kktPatch("kkt-begin-hint", n < 3 ? `Il faut 3 participants (actuellement ${n}). ${st.hostPlays ? "" : "Active « Le host joue aussi » ou fais venir du monde."}` : `${n} participants · ${kktEsc(s.mode.label)}`);
  }

  // ---------- SUBMIT ----------
  function renderSubmit(s) {
    skeleton("submit", `<div class="kkt-stage"><div class="kkt-wrap kkt-wide" style="text-align:center">
      <p class="kkt-eyebrow">Propositions · ${kktEsc(s.mode.emoji + " " + s.mode.label)}${s.settings.blind ? " · 🙈 Blind" : ""}</p>
      <h1 class="kkt-title">Choisissez vos sons en secret</h1>
      ${s.theme ? `<p class="kkt-sub">Thème imposé</p><div class="kkt-theme">${kktEsc(s.theme)}</div>` : ""}
      ${s.settings.mode === "usurp" ? `<div class="kkt-banner">🎭 Chacun a reçu en secret un joueur à imiter sur son téléphone.</div>` : ""}
      ${s.submitEndsAt ? `<p class="kkt-sub">Temps restant : <span class="kkt-count" data-countdown="${s.submitEndsAt}"></span></p>` : ""}
      <div id="kkt-ready" class="kkt-players center"></div>
      <p id="kkt-sub-info" class="kkt-sub"></p>
      <div class="kkt-row kkt-center"><button id="kkt-start" class="kkt-btn">Lancer les manches</button>
        <button id="kkt-force" class="kkt-btn ghost">Forcer le lancement</button></div></div></div>`);
    kktPatch("kkt-ready", playerChips(s.players, (p) => {
      if (p.late || !p.owner) return { txt: "détective" };
      const ok = p.done >= s.perPlayer;
      return { cls: ok ? "ok" : "", txt: `${p.done}/${s.perPlayer}${ok ? " ✓" : "…"}` };
    }));
    kktPatch("kkt-sub-info", `${s.totalSubs} son(s) proposé(s)` + (s.ready ? " · tout le monde est prêt !" : ""));
    const sb = document.getElementById("kkt-start"); if (sb) sb.disabled = !s.ready;
    const fb = document.getElementById("kkt-force"); if (fb) fb.hidden = s.ready || !s.totalSubs;
  }

  // ---------- PLAYING ----------
  function coverHtml(p, big) {
    if (!p || p.hidden || !p.cover) return `<div class="kkt-vinyl ${big ? "big" : ""}"></div>`;
    return `<img class="kkt-cover ${big ? "big" : ""}" src="${kktEsc(p.cover)}" alt="" onerror="this.style.visibility='hidden'"/>`;
  }
  function renderPlaying(s) {
    const n = s.parts.length;
    const visKey = "playing|" + s.round + "|" + s.parts.map((p) => p.hidden + p.title).join("|");
    skeleton(visKey, `<div class="kkt-stage"><div class="kkt-wrap kkt-wide" style="text-align:center">
      <p class="kkt-eyebrow">Manche ${s.round}/${s.total}${s.final ? " · 🔥 FINALE x2" : ""}${s.theme ? " · " + kktEsc(s.theme) : ""}</p>
      <div class="kkt-row kkt-center" style="gap:28px" data-seg-start="${s.startsAt}" data-seg-len="${Math.floor(s.roundMs / n)}">
        ${s.parts.map((p, i) => `<div class="kkt-now ${n > 1 ? "kkt-seg" : ""}" data-seg="${i}">${n > 1 ? `<p class="kkt-eyebrow">Extrait ${i + 1}</p>` : ""}
          ${coverHtml(p, n === 1)}<div class="kkt-tname">${kktEsc(p.title)}</div><div class="kkt-tart">${kktEsc(p.artist)}</div></div>`).join("")}
      </div>
      <p class="kkt-sub" data-prestart="${s.startsAt}"></p>
      <div class="kkt-count big" data-countdown="${s.endsAt}"></div>
      <div class="kkt-bar" data-bar-start="${s.startsAt}" data-bar-end="${s.endsAt}"><i></i></div>
      <p id="kkt-p-status" class="kkt-sub"></p>
      <div id="kkt-p-hint"></div><div id="kkt-p-trend"></div>
      <div id="kkt-p-players" class="kkt-players center"></div>
      <button id="kkt-listen" class="kkt-btn ghost" hidden>▶ Lancer le son</button></div></div>`);
    // countdown attributes may change (+15s cheat / early end) without a rebuild
    root.querySelectorAll("[data-countdown]").forEach((el) => el.setAttribute("data-countdown", s.endsAt));
    root.querySelectorAll("[data-bar-end]").forEach((el) => el.setAttribute("data-bar-end", s.endsAt));

    // audio: the shared screen ALWAYS plays (it is the speakers of the room)
    const ak = s.round + "|" + s.parts.map((p) => p.preview).join("|") + "|" + s.startsAt;
    if (audioKey !== ak) {
      audioKey = ak;
      const round = s.round;
      kktAudio.schedule(kktSegments(s),
        () => { const b = document.getElementById("kkt-listen"); if (b) b.hidden = false; },
        () => send("audioError", { round })); // dead link: the server skips this song
    }
    const byId = {}; s.players.forEach((p) => (byId[p.id] = p));
    kktPatch("kkt-p-status", `${s.votedCount}/${s.voterCount} ont voté` + (s.duo ? " · vote à 2 suspects" : "") + (s.scrambled ? " · 🌀 brouille" : ""));
    const elim = (s.eliminated || []).map((l, i) => l.map((id) => `❌ ${s.parts.length > 1 ? "Extrait " + (i + 1) + " : " : ""}ce n'est PAS ${kktEsc((byId[id] || {}).name || "?")}`).join("<br>")).filter(Boolean).join("<br>");
    kktPatch("kkt-p-hint", elim ? `<div class="kkt-banner gold">💡 ${elim}</div>` : "");
    let trend = "";
    if (s.trend) {
      trend = s.trend.map((t, i) => {
        const max = Math.max(1, ...Object.values(t));
        const cols = (s.suspects[i] || []).map((id) => byId[id] ? `<div class="c"><div class="col"><div class="b" style="height:${Math.round(((t[id] || 0) / max) * 90)}px"></div></div>
          ${kktAvatar(byId[id].avatar, 30)}<span class="kkt-small">${t[id] || 0}</span></div>` : "").join("");
        return `<p class="kkt-eyebrow">Tendance des votes${s.parts.length > 1 ? " — extrait " + (i + 1) : ""}</p><div class="kkt-trend">${cols}</div>`;
      }).join("");
    }
    kktPatch("kkt-p-trend", trend);
    kktPatch("kkt-p-players", s.players.filter((p) => !p.ghost).map((p) =>
      `<div class="kkt-pl ${p.connected ? "" : "off"} ${p.voted ? "voted" : ""}">${kktAvatar(p.avatar, 30)}
        <div><div class="nm">${kktEsc(p.name)}</div><div class="mt">${p.voted ? `<span class="kkt-voted">a voté ✓${p.locked ? " 🔒" : ""}</span>` : "…"}</div></div></div>`).join(""));
  }

  // ---------- REVEAL ----------
  function renderReveal(s) {
    const r = s.result;
    const key = "reveal|" + s.round;
    const fresh = skeleton(key, `<div class="kkt-stage"><div class="kkt-wrap kkt-wide kkt-reveal">
      <p class="kkt-eyebrow">Manche ${s.round}/${s.total}${r.mult > 1 ? " · 🔥 points x2" : ""}</p>
      <div class="kkt-row kkt-center" style="gap:28px">${r.parts.map((p) => `<div class="kkt-now">
        <img class="kkt-cover" src="${kktEsc(p.track.cover)}" alt="" onerror="this.style.visibility='hidden'"/>
        <div class="kkt-tname">${kktEsc(p.track.title)}</div><div class="kkt-tart">${kktEsc(p.track.artist)}</div></div>`).join("")}</div>
      <div id="kkt-arrows" class="kkt-arrows"></div>
      <div id="kkt-owner-box" class="kkt-hidden-till">${r.parts.map((p, i) => `
        <div class="kkt-owner big">${kktAvatar(p.ownerAvatar, 52)} ${r.parts.length > 1 ? "#" + (i + 1) + " : " : ""}C'était ${kktEsc(p.ownerName)} ! <span class="kkt-small">(+${p.ownerPts})</span></div>
        ${p.targetName ? `<p class="kkt-sub">🎭 Il/elle imitait <b>${kktEsc(p.targetName)}</b> (${p.onTarget} vote(s) tombé(s) dessus)</p>` : ""}
        ${p.nature ? `<p class="kkt-sub">${p.nature === "sincere" ? "💖 C'était un vrai coup de cœur" : "🃏 C'était un BLUFF"}</p>` : ""}
        ${p.note ? `<p class="kkt-note">💬 « ${kktEsc(p.note)} »</p>` : ""}
        <p class="kkt-sub">${p.found} l'ont trouvé${p.foundNames.length ? " : " + p.foundNames.map(kktEsc).join(", ") : ""}.</p>`).join("")}
        ${r.combos.length ? `<div class="kkt-banner gold">🔥 Combo x3 : ${r.combos.map(kktEsc).join(", ")} (+2)</div>` : ""}
        ${r.doubles.length ? `<p class="kkt-sub">✖️2 Joker double : ${r.doubles.map(kktEsc).join(", ")}</p>` : ""}
        <div id="kkt-rate"></div>
        <div id="kkt-lb"></div>
        <div class="kkt-row kkt-center" style="margin-top:14px" id="kkt-next-box"></div>
      </div></div></div>`);
    if (fresh && revealKey !== key) {
      revealKey = key;
      kktAudio.stop();
      const names = {}; s.leaderboard.forEach((l) => (names[l.id] = l.name));
      const arrowsEnd = kktRevealArrows(document.getElementById("kkt-arrows"), r, KKT_TIMING.REVEAL_START_MS, names);
      const drumAt = arrowsEnd + 200;
      setTimeout(() => { if (built === key) kktDrum(KKT_TIMING.DRUM_MS - 100); }, drumAt);
      setTimeout(() => {
        if (built !== key) return;
        const box = document.getElementById("kkt-owner-box"); if (box) box.classList.add("show");
        if (window.Sound) Sound.sfx("kkt-reveal", { duck: false });
      }, drumAt + KKT_TIMING.DRUM_MS);
    }
    if (s.nextPreviews && s.nextPreviews.join() !== lastPreload) { lastPreload = s.nextPreviews.join(); kktAudio.preload(s.nextPreviews); }
    kktPatch("kkt-rate", `<div class="kkt-row kkt-center">` + r.parts.map((p, i) => {
      const listen = p.track.link ? ` · <a href="${kktEsc(p.track.link)}" target="_blank" rel="noopener" style="color:var(--kkt-cyan)">écouter en entier ↗</a>` : "";
      return `<span class="kkt-sub">${r.parts.length > 1 ? "#" + (i + 1) + " " : ""}Note du son : <b>${s.ratings[i] > 0 ? "+" : ""}${s.ratings[i] || 0}</b> 👍/👎 (sur les téléphones)${listen}</span>`;
    }).join("") + `</div>`);
    kktPatch("kkt-lb", kktLeaderboard(s.leaderboard, null, { gains: r.gains }));
    kktPatch("kkt-next-box", s.nextAt
      ? `<p class="kkt-sub">Manche suivante dans <span data-countdown="${s.nextAt}"></span> · <button id="kkt-next" class="kkt-btn sm ghost">Passer</button></p>`
      : `<button id="kkt-next" class="kkt-btn">${s.last ? "Voir le classement final" : "Manche suivante"}</button>`);
  }

  // ---------- ENDED: wrapped slideshow, then the final screen ----------
  function slides(s) {
    const w = s.final.wrapped, out = [];
    out.push(`<p class="kkt-eyebrow">Le récap de la soirée</p><div class="big">KIETKOUTSA WRAPPED</div><p class="kkt-sub">${w.tracksPlayed} sons écoutés${w.theme ? " · theme « " + kktEsc(w.theme) + " »" : ""}</p>`);
    if (w.mostDeceptive) out.push(trackSlide("Le son le plus trompeur", w.mostDeceptive, `+${w.mostDeceptive.points} pour ${kktEsc(w.mostDeceptive.ownerName)}`));
    if (w.mostObvious) out.push(trackSlide("Le son le plus prévisible", w.mostObvious, `${w.mostObvious.found}/${w.mostObvious.voters} l'ont trouvé`));
    if (w.bestRated) out.push(trackSlide("Le son préféré de la salle", w.bestRated, `${w.bestRated.rating > 0 ? "+" : ""}${w.bestRated.rating} 👍`));
    if (w.topArtist) out.push(`<p class="kkt-eyebrow">L'artiste de la soirée</p><div class="big">${kktEsc(w.topArtist.name)}</div><p class="kkt-sub">${w.topArtist.n} sons</p>`);
    if (s.final.pairs.length) out.push(`<p class="kkt-eyebrow">Mêmes goûts ?</p>` + s.final.pairs.map((p) =>
      `<div class="kkt-owner">${kktEsc(p.a)} ↔ ${kktEsc(p.b)}</div><p class="kkt-small">${kktEsc(p.a)} a été pris(e) ${p.n} fois pour ${kktEsc(p.b)}</p>`).join(""));
    if (w.topDetective) out.push(`<p class="kkt-eyebrow">Meilleur détective</p>${kktAvatar(w.topDetective.avatar, 90)}<div class="big">${kktEsc(w.topDetective.name)}</div><p class="kkt-sub">${w.topDetective.pts} pts de flair</p>`);
    if (w.topChameleon) out.push(`<p class="kkt-eyebrow">Meilleur caméléon</p>${kktAvatar(w.topChameleon.avatar, 90)}<div class="big">${kktEsc(w.topChameleon.name)}</div><p class="kkt-sub">${w.topChameleon.pts} pts de discrétion</p>`);
    if (s.final.badges.length) out.push(`<p class="kkt-eyebrow">Les badges</p>` + badgesHtml(s.final.badges));
    return out;
  }
  function trackSlide(title, t, line) {
    return `<p class="kkt-eyebrow">${title}</p><img class="kkt-cover big" src="${kktEsc(t.cover)}" alt="" onerror="this.style.visibility='hidden'"/>
      <div class="big">${kktEsc(t.title)}</div><p class="kkt-sub">${kktEsc(t.artist)} · mis par ${kktEsc(t.ownerName)}</p><p class="kkt-sub"><b>${line}</b></p>`;
  }
  function badgesHtml(b) {
    return `<div class="kkt-badges">` + b.map((x) => `<div class="kkt-badge"><span class="e">${x.emoji}</span>
      <div><div class="t">${kktEsc(x.label)} : ${kktEsc(x.name)}</div><div class="d">${kktEsc(x.desc)}</div></div></div>`).join("") + `</div>`;
  }
  function wrappedGo(i) {
    const list = slides(state);
    clearTimeout(wrapped.timer);
    if (i >= list.length) { wrapped.done = true; return renderEnded(state); }
    wrapped.idx = Math.max(0, i);
    built = null;
    renderEnded(state);
  }
  function renderEnded(s) {
    if (!s || !s.final) {
      skeleton("ended-empty", `<div class="kkt-stage"><div class="kkt-wrap kkt-reveal"><h1 class="kkt-title">Partie terminée</h1>
        <p class="kkt-sub">${kktEsc((s && s.endReason) || "")}</p><button id="kkt-replay" class="kkt-btn">Rejouer</button></div></div>`);
      return;
    }
    const list = slides(s);
    if (!wrapped.done && list.length > 1) {
      const key = "wrapped|" + wrapped.idx;
      if (skeleton(key, `<div class="kkt-stage"><div class="kkt-wrap kkt-reveal"><div class="kkt-slide">${list[wrapped.idx]}</div>
        <div class="kkt-dots">${list.map((_, i) => `<i class="${i === wrapped.idx ? "on" : ""}"></i>`).join("")}</div>
        <div class="kkt-row kkt-center" style="margin-top:12px"><button id="kkt-w-prev" class="kkt-btn sm ghost">◀</button>
        <button id="kkt-w-next" class="kkt-btn sm">▶</button><button id="kkt-w-skip" class="kkt-btn sm ghost">Passer le récap</button></div></div></div>`)) {
        clearTimeout(wrapped.timer);
        wrapped.timer = setTimeout(() => wrappedGo(wrapped.idx + 1), 5500);
      }
      return;
    }
    const tabs = [["score", "Total"], ["det", "🕵️ Détective"], ["cam", "🦎 Caméléon"]].concat(s.tournament && s.tournament.games > 1 ? [["total", "🏆 Tournoi"]] : []);
    skeleton("ended|" + endTab, `<div class="kkt-stage"><div class="kkt-wrap kkt-wide kkt-reveal">
      <p class="kkt-eyebrow">Fin de la partie${s.tournament ? " · tournoi : " + s.tournament.games + " partie(s)" : ""}</p><h1 class="kkt-title">Classement</h1>
      ${s.endReason ? `<p class="kkt-sub">${kktEsc(s.endReason)}</p>` : ""}
      <div class="kkt-tabs">${tabs.map(([k, l]) => `<button data-tab="${k}" class="${endTab === k ? "on" : ""}">${l}</button>`).join("")}</div>
      ${kktLeaderboard(s.leaderboard, null, { key: endTab })}
      ${s.final.badges.length ? `<h2 class="kkt-h2">Badges</h2>${badgesHtml(s.final.badges)}` : ""}
      <h2 class="kkt-h2">Les sons de la soirée</h2>
      <div class="kkt-trk">${s.final.trackRanking.map((t, i) => `<div class="kkt-res"><span class="kkt-le rk" style="background:none;border:none;padding:0 6px 0 0">${i + 1}</span>
        <img src="${kktEsc(t.cover)}" alt="" onerror="this.style.visibility='hidden'"/>
        <div class="info"><div class="t">${kktEsc(t.title)} — +${t.points}${t.rating ? " · " + (t.rating > 0 ? "+" : "") + t.rating + "👍" : ""}</div>
        <div class="a">${kktEsc(t.artist)} · mis par ${kktEsc(t.ownerName)}</div></div>
        ${t.link ? `<a class="kkt-mini" style="display:flex;align-items:center;justify-content:center;text-decoration:none" href="${kktEsc(t.link)}" target="_blank" rel="noopener" aria-label="Écouter">↗</a>` : ""}</div>`).join("")}</div>
      <div class="kkt-row kkt-center" style="margin-top:16px">
        <button id="kkt-copy" class="kkt-btn ghost">📋 Copier la playlist</button>
        <button id="kkt-replay" class="kkt-btn">Rejouer (mêmes réglages)</button>
        <button id="kkt-tourney" class="kkt-btn ghost">🏆 Partie suivante du tournoi</button></div></div></div>`);
  }
})();
