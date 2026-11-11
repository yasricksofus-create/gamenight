// player.js -- Phone view of "Kietkoutsa Reborn" (neon).
// Uses the shared pieces of common.js (search, vote panel, leaderboard...).
// Blocks are patched (kktPatch) so typing in a text field is never lost.
(function () {
  const socket = window.socket;
  const root = document.getElementById("game-root");
  const me = () => window.mySeatId;
  let state = null, you = null, built = null, search = null, audioKey = null, prevPhase = null;
  let revealShownAt = {}, endTab = "score", lastPreload = "";
  kktInjectStyles();
  kktContrast.apply();
  let buzzed = {}, savedEvening = false;
  const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);

  function send(type, payload) { socket.emit("game:action", { type, payload }); }
  setInterval(kktTick, 250);

  // Static data (modes, avatar choices) arrives once; merged into every state.
  let STATIC = {};
  socket.on("kkt:static", (d) => { STATIC = d || {}; if (state) { state = Object.assign({}, STATIC, state); renderSoon(); } });
  // Full state at each new phase, then only the changes ("kkt:patch").
  socket.on("kkt:patch", (p) => { if (state && p.phase === state.phase) applyState(Object.assign({}, state, p)); });
  socket.on("kkt:state", (s) => applyState(Object.assign({}, STATIC, s)));
  function applyState(s) {
    const wasPaused = window.kktPausedAt;
    window.kktPausedAt = s.paused || 0; // frozen countdowns during a pause
    if (s.paused && !wasPaused) { kktAudio.stop(); audioKey = null; }
    if (s.phase !== prevPhase) {
      if (s.phase !== "playing") { kktAudio.stop(); audioKey = null; }
      if (s.phase === "playing") kktBuzz(80); // a new song starts: look at the screen
      prevPhase = s.phase;
    }
    if (s.phase === "ended" && s.final && !savedEvening) { savedEvening = true; kktEvenings.save(s); }
    if (s.phase !== "ended") savedEvening = false;
    state = s; renderSoon();
  }
  // gentle reminders by vibration: 30 s left to choose your songs, 5 s left to vote
  setInterval(() => {
    const s = state;
    if (!s || !you || s.paused) return;
    if (s.phase === "submit" && s.submitEndsAt && !you.late && you.subs.length < you.perPlayer) {
      const left = kktLeft(s.submitEndsAt), k = "sub" + s.submitEndsAt;
      if (left <= 30 && left > 0 && !buzzed[k]) { buzzed[k] = 1; kktBuzz([120, 80, 120]); kktToast("⏱ Plus que 30 secondes pour choisir !"); }
    }
    if (s.phase === "playing" && !(you.vote && s.parts.every((_, i) => you.vote.p[i]))) {
      const left = kktLeft(s.endsAt), k = "vote" + s.round;
      if (left <= 5 && left > 0 && !buzzed[k]) { buzzed[k] = 1; kktBuzz([60, 60, 60]); }
    }
  }, 1000);
  socket.on("kkt:you", (d) => { you = d; renderSoon(); });
  // state + private info often arrive together: draw the screen once per frame
  let renderQueued = false;
  function renderSoon() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(() => { renderQueued = false; render(); });
  }

  // Data saver: on mobile data, the phone can stay silent (the music still plays
  // on the shared screen). Remembered on this phone; on by default when the
  // phone itself asks to save data.
  function phoneMuted() {
    try { const v = localStorage.getItem("kkt_phone_mute"); if (v !== null) return v === "1"; } catch (e) {}
    return !!(navigator.connection && navigator.connection.saveData);
  }
  function setPhoneMuted(on) {
    try { localStorage.setItem("kkt_phone_mute", on ? "1" : "0"); } catch (e) {}
    if (on) kktAudio.stop(); else { audioKey = null; }
    built = null; render();
  }
  socket.on("kkt:toast", ({ msg }) => kktToast(msg));
  socket.on("kkt:spy", ({ name, vote, live }) => { kktBuzz(40); kktToast("🕵️ " + (live ? "Nouveau : " : "") + name + (vote ? " a voté pour " + vote : " n'a pas encore voté")); });
  socket.on("kkt:guessResult", (g) => kktShowGuess(g));

  // one delegated click handler (buttons are re-drawn often)
  root.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b || !root.contains(b)) return;
    if (b.id === "kkt-mute") return setPhoneMuted(!phoneMuted());
    if (b.hasAttribute("data-edit-avatar")) return window.editMyAvatar && window.editMyAvatar();
    if (b.hasAttribute("data-mode")) return send("voteMode", { mode: b.getAttribute("data-mode") });
    if (b.hasAttribute("data-rate")) return send("rate", { part: +b.getAttribute("data-part"), v: +b.getAttribute("data-rate") });
    if (b.hasAttribute("data-tab")) { endTab = b.getAttribute("data-tab"); built = null; return render(); }
    if (b.id === "kkt-listen") { b.hidden = true; return kktAudio.resume(); }
    if (b.id === "kkt-copy") return kktCopy(kktPlaylistText(state.final.tracks));
    if (b.id === "kkt-howto") return kktModal("Comment jouer ?", kktHowTo(state.mode));
    if (b.id === "kkt-contrast") { kktToast(kktContrast.toggle() ? "Contraste élevé activé" : "Contraste normal"); return; }
  });

  function skeleton(key, html) {
    if (built === key && root.firstElementChild) return false;
    built = key; kktPatchReset(); search = null;
    root.innerHTML = html;
    return true;
  }

  function render() {
    if (!state) return;
    const s = state;
    if (!you && s.phase !== "ended") { // not seated yet (just arrived)
      skeleton("wait", `<div class="kkt-stage"><div class="kkt-wrap"><h1 class="kkt-title">Kietkoutsa Reborn</h1><p class="kkt-sub">Connexion à la partie…</p></div></div>`);
      return;
    }
    if (s.phase === "settings") renderSettings(s);
    else if (s.phase === "submit") renderSubmit(s);
    else if (s.phase === "playing") renderPlaying(s);
    else if (s.phase === "reveal") renderReveal(s);
    else if (s.phase === "ended") renderEnded(s);
  }

  function lateBanner() {
    if (!you || !you.late) return "";
    return `<div class="kkt-banner">👋 Tu es arrivé en cours de partie : tu joues en <b>détective</b> (tu votes et tu marques, sans son à toi).
      ${state && state.mode ? `<br><span class="kkt-small">Mode ${kktEsc(state.mode.label)} : ${kktEsc(state.mode.rule)}</span>` : ""}
      <br><button class="kkt-btn sm ghost" id="kkt-howto" style="margin-top:6px">Comment jouer ?</button></div>`;
  }

  // ---------- SETTINGS: avatar + mode vote ----------
  function renderSettings(s) {
    skeleton("settings", `<div class="kkt-stage"><div class="kkt-wrap">
      <p class="kkt-eyebrow">Mise en place</p><h1 class="kkt-title">Kietkoutsa Reborn</h1>
      <div class="kkt-card"><h2 class="kkt-h2" style="margin-top:0">Ton avatar</h2><div id="kkt-me-av"></div></div>
      <div class="kkt-card"><h2 class="kkt-h2" style="margin-top:0">Vote pour le mode</h2><div id="kkt-modes"></div>
        <p class="kkt-small">Le host décide d'appliquer (ou non) le vote de la salle.</p></div>
      <div class="kkt-card"><h2 class="kkt-h2" style="margin-top:0">Réglages du host</h2><div id="kkt-sum"></div></div>
      <div class="kkt-row kkt-center"><button class="kkt-btn ghost" id="kkt-howto">Comment jouer ?</button>
        <button class="kkt-btn ghost sm" id="kkt-contrast">◐ Contraste</button></div>
      <div id="kkt-evenings"></div>
      <p class="kkt-sub">Prépare tes meilleurs sons ! 🎧</p></div></div>`);
    kktPatch("kkt-evenings", kktEvenings.html());
    kktPatch("kkt-me-av", `<p style="margin:0 0 8px"><b>${kktEsc(you.name)}</b></p>` + kktMyAvatar(you.avatar));
    kktPatch("kkt-modes", `<div class="kkt-modes">` + Object.keys(s.modes || {}).map((id) => {
      const m = s.modes[id], n = (s.modeTally || {})[id];
      return `<button class="kkt-mode ${you.modeVote === id ? "on" : ""}" data-mode="${id}">${n ? `<span class="tally">${n}</span>` : ""}
        <span class="e">${m.emoji}</span><span class="n">${kktEsc(m.label)}${s.settings.mode === id ? " (choisi)" : ""}</span><span class="r">${kktEsc(m.rule)}</span></button>`;
    }).join("") + `</div>`);
    kktPatch("kkt-sum", settingsSummary(s.settings));
  }
  function settingsSummary(st) {
    const on = [["blind", "🙈 Blind"], ["theme", "🎲 Thème"], ["bets", "🪙 Mises"], ["jokers", "🃏 Jokers"], ["hints", "💡 Indices"],
      ["speed", "⚡ Rapidité"], ["finalDouble", "🔥 Finale x2"], ["autoNext", "🔁 Auto"], ["noExplicit", "🚫 Explicite"]]
      .filter(([k]) => st[k]).map(([, l]) => `<span class="kkt-chip on">${l}</span>`).join("");
    return `<div class="kkt-chips"><span class="kkt-chip">${st.perPlayer} son(s) chacun</span><span class="kkt-chip">${st.roundSec}s / manche</span>${on}</div>`;
  }

  // ---------- SUBMIT ----------
  function renderSubmit(s) {
    if (skeleton("submit", `<div class="kkt-stage"><div class="kkt-wrap kkt-wrap-wide">
      <p class="kkt-eyebrow">Propositions · ${kktEsc(s.mode.emoji + " " + s.mode.label)}</p><h1 class="kkt-title">Choisis ta musique</h1>
      <div id="kkt-sub-info"></div>
      ${s.submitEndsAt ? `<p class="kkt-sub">Temps restant : <span class="kkt-count" data-countdown="${s.submitEndsAt}"></span></p>` : ""}
      <div id="kkt-search"></div>
      <div class="kkt-you-panel"><h3 class="kkt-h2" style="margin:0 0 6px">Les joueurs</h3><div id="kkt-ready" class="kkt-players"></div></div></div></div>`)) {
      if (!you.late) search = KktSearch(document.getElementById("kkt-search"), send);
    }
    kktPatch("kkt-sub-info", lateBanner() +
      (s.theme ? `<div class="kkt-banner gold">🎲 Thème : <b>${kktEsc(s.theme)}</b></div>` : "") +
      (you.target ? `<div class="kkt-banner">🎭 Tu imites <b>${kktEsc(you.target.name)}</b> : mets un son qu'il/elle aurait mis ! (+1 par vote qui tombe sur lui/elle)</div>` : "") +
      (s.settings.mode === "truebluff" ? `<div class="kkt-banner">🃏 Mets 2 sons : un vrai coup de cœur 💖 et un bluff 🃏 (indique lequel est lequel).</div>` : "") +
      (s.settings.blind ? `<p class="kkt-small">🙈 Mode Blind : pendant la manche, on n'entendra que l'audio.</p>` : ""));
    if (search) search.update(you, s);
    kktPatch("kkt-ready", s.players.map((p) => {
      const ok = p.owner && p.done >= s.perPlayer;
      return `<div class="kkt-pl ${ok ? "ok" : ""} ${p.connected ? "" : "off"} ${p.id === me() ? "me" : ""}">${kktAvatar(p.avatar, 34)}
        <div><div class="nm">${kktEsc(p.name)}${p.id === me() ? " (toi)" : ""}</div><div class="mt">${p.owner ? `${p.done}/${s.perPlayer}${ok ? " ✓" : "…"}` : "détective"}</div></div></div>`;
    }).join(""));
  }

  // ---------- PLAYING ----------
  function renderPlaying(s) {
    const n = s.parts.length;
    const key = "playing|" + s.round + "|" + s.parts.map((p) => p.hidden + p.title).join("|");
    if (skeleton(key, `<div class="kkt-stage"><div class="kkt-wrap" style="text-align:center">
      <p class="kkt-eyebrow">Manche ${s.round}/${s.total}${s.final ? " · 🔥 FINALE x2" : ""}</p>
      <div class="kkt-row kkt-center" data-seg-start="${s.startsAt}" data-seg-len="${Math.floor(s.roundMs / n)}">
      ${s.parts.map((p, i) => `<div class="kkt-now ${n > 1 ? "kkt-seg" : ""}" data-seg="${i}">${n > 1 ? `<p class="kkt-eyebrow">Extrait ${i + 1}</p>` : ""}
        ${p.hidden || !p.cover ? `<div class="kkt-vinyl" style="${n > 1 ? "width:34vw;height:34vw" : ""}"></div>` : `<img class="kkt-cover" style="${n > 1 ? "width:34vw;height:34vw" : ""}" src="${kktEsc(p.cover)}" alt="" onerror="this.style.visibility='hidden'"/>`}
        <div class="kkt-tname" style="${n > 1 ? "font-size:1.2rem" : ""}">${kktEsc(p.title)}</div><div class="kkt-tart">${kktEsc(p.artist)}</div></div>`).join("")}</div>
      <p class="kkt-sub" data-prestart="${s.startsAt}"></p>
      <div class="kkt-count" data-countdown="${s.endsAt}"></div>
      <div class="kkt-bar" data-bar-start="${s.startsAt}" data-bar-end="${s.endsAt}"><i></i></div>
      <button id="kkt-listen" class="kkt-btn ghost" hidden>▶ Écouter</button>
      ${s.settings.playback === "all" ? `<button id="kkt-mute" class="kkt-btn ghost sm" style="margin-top:6px">${phoneMuted() ? "🔇 Son coupé sur ce téléphone (réactiver)" : "📶 En 4G ? Couper le son sur ce téléphone"}</button>` : ""}
      ${isIOS && s.settings.playback === "all" && !phoneMuted() ? `<p class="kkt-small">🍎 Sur iPhone : le volume se règle avec les boutons du téléphone, et le mode silencieux peut couper le son.</p>` : ""}
      ${lateBanner()}
      <div id="kkt-pause-b"></div>
      <div id="kkt-vp"></div><div id="kkt-guess-wrap"></div></div></div>`)) {
      if (s.settings.blind && you.ownedParts.length < s.parts.length) { document.getElementById("kkt-guess-wrap").innerHTML = kktGuessBox(s.parts.length > 1, you.ownedParts); kktWireGuess(send); }
    }
    // (the pause screen on phones is the engine's now)
    root.querySelectorAll("[data-countdown]").forEach((el) => el.setAttribute("data-countdown", s.endsAt));
    root.querySelectorAll("[data-bar-end]").forEach((el) => el.setAttribute("data-bar-end", s.endsAt));
    if (s.settings.playback === "all" && !phoneMuted() && !s.paused) {
      const ak = s.round + "|" + s.parts.map((p) => p.preview).join("|") + "|" + s.startsAt;
      if (audioKey !== ak) {
        audioKey = ak;
        kktAudio.schedule(kktSegments(s), () => { const b = document.getElementById("kkt-listen"); if (b) b.hidden = false; });
      }
    }
    const el = kktPatch("kkt-vp", kktVotePanel(s, you, me()));
    if (el) kktWireVotePanel(el, s, you, me(), send);
    if (you.guess) kktShowGuess(you.guess);
  }

  // ---------- REVEAL (waits for the host's animation so phones don't spoil it) ----------
  function renderReveal(s) {
    const r = s.result;
    const key = "reveal|" + s.round;
    // wait until the host's animation is over, counted from when the reveal
    // started on the SERVER (a phone that reloads mid-reveal doesn't wait again)
    if (!revealShownAt[key]) revealShownAt[key] = s.revealAt ? Date.now() - Math.max(0, kktNow() - s.revealAt) : Date.now();
    // the server says how long the host screen's animation lasts
    const suspense = r.animMs || (KKT_TIMING.REVEAL_START_MS + r.votes.length * KKT_TIMING.REVEAL_STEP_MS + 200 + KKT_TIMING.DRUM_MS);
    const waitMs = revealShownAt[key] + suspense - Date.now();
    if (waitMs > 0) {
      const before = s.leaderboard.map((l) => Object.assign({}, l, { score: (l.score || 0) - ((r.gains || {})[l.id] || 0) }));
      skeleton(key + "|wait", `<div class="kkt-stage"><div class="kkt-wrap kkt-reveal"><p class="kkt-eyebrow">Manche ${s.round}/${s.total}</p>
        <div class="kkt-vinyl" style="margin:20px auto"></div><h1 class="kkt-title">Regarde l'écran 👀</h1><p class="kkt-sub">Révélation en cours…</p>
        <p class="kkt-eyebrow" style="margin-top:16px">Classement avant cette manche</p>${kktLeaderboard(before, me())}</div></div>`);
      clearTimeout(renderReveal._t);
      renderReveal._t = setTimeout(render, waitMs + 50);
      return;
    }
    skeleton(key, `<div class="kkt-stage"><div class="kkt-wrap kkt-reveal"><p class="kkt-eyebrow">Manche ${s.round}/${s.total}${r.mult > 1 ? " · points x2" : ""}</p>
      <div id="kkt-r-parts"></div><div id="kkt-r-me"></div><div id="kkt-r-rate"></div><div id="kkt-lb"></div><p class="kkt-sub" id="kkt-r-wait" style="margin-top:12px"></p></div></div>`);
    kktPatch("kkt-r-parts", r.parts.map((p, i) => `<div class="kkt-card">
      <div class="kkt-row kkt-center"><img class="kkt-cover" style="width:90px;height:90px" src="${kktEsc(p.track.cover)}" alt="" onerror="this.style.visibility='hidden'"/>
      <div style="text-align:left"><div class="kkt-tname" style="text-align:left;font-size:1.4rem">${kktEsc(p.track.title)}</div><div class="kkt-tart" style="text-align:left">${kktEsc(p.track.artist)}</div>
      <div class="kkt-row" style="margin-top:6px">${kktStreamLinks(p.track)}</div></div></div>
      <div class="kkt-owner">${kktAvatar(p.ownerAvatar, 36)} ${r.parts.length > 1 ? "#" + (i + 1) + " " : ""}C'était ${kktEsc(p.ownerName)} !</div>
      ${p.targetName ? `<p class="kkt-sub">🎭 imitait ${kktEsc(p.targetName)}</p>` : ""}
      ${p.nature ? `<p class="kkt-sub">${p.nature === "sincere" ? "💖 Vrai coup de cœur" : "🃏 Bluff"}</p>` : ""}
      ${p.note ? `<p class="kkt-note">💬 « ${kktEsc(p.note)} »</p>` : ""}
      <p class="kkt-small">${p.found} l'ont trouvé.</p></div>`).join(""));
    const g = r.gains[me()];
    const why = (r.why || {})[me()] || [];
    if (g > 0 && !buzzed["gain" + key]) { buzzed["gain" + key] = 1; kktBuzz([40, 40, 90]); }
    kktPatch("kkt-r-me", `<div class="kkt-banner ${g > 0 ? "gold" : ""}">${g > 0 ? "+" + g + " pour toi 🎉" : g < 0 ? g + " (mise perdue)" : "0 point cette manche"}` +
      (why.length ? `<div class="kkt-why">${why.map((w) => `<span>${kktEsc(w)}</span>`).join("")}</div>` : "") + `</div>` +
      (r.combos.length ? `<p class="kkt-sub">🔥 Combo : ${r.combos.map(kktEsc).join(", ")}</p>` : ""));
    kktPatch("kkt-r-rate", r.parts.map((p, i) => p.ownerId === me() ? "" : `<div class="kkt-row kkt-center"><span class="kkt-sub">${r.parts.length > 1 ? "#" + (i + 1) + " " : ""}Ce son ?</span>
      <button class="kkt-vb ${you.rated[i] === 1 ? "on" : ""}" data-rate="1" data-part="${i}">👍</button>
      <button class="kkt-vb ${you.rated[i] === -1 ? "on" : ""}" data-rate="-1" data-part="${i}">👎</button></div>`).join(""));
    kktPatch("kkt-lb", kktLeaderboard(s.leaderboard, me(), { gains: r.gains }));
    kktPatch("kkt-r-wait", s.nextAt ? `Manche suivante dans <span data-countdown="${s.nextAt}"></span>` : (s.last ? "Partie terminée ! Classement sur l'écran…" : "En attente du host…"));
    if (s.settings.playback === "all" && !phoneMuted() && s.nextPreviews && s.nextPreviews.join() !== lastPreload) { lastPreload = s.nextPreviews.join(); kktAudio.preload(s.nextPreviews); }
  }

  // ---------- ENDED ----------
  function renderEnded(s) {
    if (!s.final) {
      skeleton("ended-empty", `<div class="kkt-stage"><div class="kkt-wrap kkt-reveal"><h1 class="kkt-title">Partie terminée</h1><p class="kkt-sub">${kktEsc(s.endReason || "")}</p></div></div>`);
      return;
    }
    const myL = s.leaderboard.find((l) => l.id === me());
    const rank = myL ? s.leaderboard.filter((l) => l.score > myL.score).length : -1; // ties share a rank
    const mine = s.final.badges.filter((b) => b.playerId === me());
    const tabs = [["score", "Total"], ["det", "🕵️"], ["cam", "🦎"]].concat(s.tournament && s.tournament.games > 1 ? [["total", "🏆"]] : [], [["hist", "Manches"]]);
    skeleton("ended|" + endTab, `<div class="kkt-stage"><div class="kkt-wrap kkt-reveal">
      <p class="kkt-eyebrow">Fin de la partie</p>
      <h1 class="kkt-title">${rank === 0 ? "🏆 Tu gagnes !" : rank > 0 ? "Tu finis " + (rank + 1) + "e" : "Classement final"}</h1>
      ${mine.length ? `<div class="kkt-badges">${mine.map((x) => `<div class="kkt-badge"><span class="e">${x.emoji}</span><div><div class="t">${kktEsc(x.label)}</div><div class="d">${kktEsc(x.desc)}</div></div></div>`).join("")}</div>` : ""}
      <div class="kkt-tabs">${tabs.map(([k, l]) => `<button data-tab="${k}" class="${endTab === k ? "on" : ""}">${l}</button>`).join("")}</div>
      ${endTab === "hist" ? kktHistoryHtml(s.history) : kktLeaderboard(s.leaderboard, me(), { key: endTab })}
      <h2 class="kkt-h2">La playlist de la soirée</h2>
      <div class="kkt-trk">${s.final.tracks.map((t) => `<div class="kkt-res"><img src="${kktEsc(t.cover)}" alt="" onerror="this.style.visibility='hidden'"/>
        <div class="info"><div class="t">${kktEsc(t.title)}</div><div class="a">${kktEsc(t.artist)} · ${kktEsc(t.ownerName)}</div></div>
        ${kktStreamLinks(t)}</div>`).join("")}</div>
      <div class="kkt-row kkt-center" style="margin-top:12px"><button id="kkt-copy" class="kkt-btn ghost">📋 Copier la playlist</button></div>
      <p class="kkt-sub">Le host peut relancer une partie.</p></div></div>`);
  }
})();
