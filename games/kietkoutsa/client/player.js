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

  function send(type, payload) { socket.emit("game:action", { type, payload }); }
  setInterval(kktTick, 250);

  // Static data (modes, avatar choices) arrives once; merged into every state.
  let STATIC = {};
  socket.on("kkt:static", (d) => { STATIC = d || {}; if (state) { state = Object.assign({}, STATIC, state); render(); } });
  socket.on("kkt:state", (s) => {
    s = Object.assign({}, STATIC, s);
    if (s.phase !== prevPhase) { if (s.phase !== "playing") { kktAudio.stop(); audioKey = null; } prevPhase = s.phase; }
    state = s; render();
  });
  socket.on("kkt:you", (d) => { you = d; render(); });
  socket.on("kkt:toast", ({ msg }) => kktToast(msg));
  socket.on("kkt:spy", ({ name, vote }) => kktToast("🕵️ " + name + (vote ? " a vote pour " + vote : " n'a pas encore vote")));
  socket.on("kkt:guessResult", (g) => kktShowGuess(g));

  // one delegated click handler (buttons are re-drawn often)
  root.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b || !root.contains(b)) return;
    if (b.hasAttribute("data-av-e")) return send("setAvatar", { emoji: b.getAttribute("data-av-e"), color: you && you.avatar && you.avatar.color });
    if (b.hasAttribute("data-av-c")) return send("setAvatar", { emoji: you && you.avatar && you.avatar.emoji, color: b.getAttribute("data-av-c") });
    if (b.hasAttribute("data-mode")) return send("voteMode", { mode: b.getAttribute("data-mode") });
    if (b.hasAttribute("data-rate")) return send("rate", { part: +b.getAttribute("data-part"), v: +b.getAttribute("data-rate") });
    if (b.hasAttribute("data-tab")) { endTab = b.getAttribute("data-tab"); built = null; return render(); }
    if (b.id === "kkt-listen") { b.hidden = true; return kktAudio.resume(); }
    if (b.id === "kkt-copy") return kktCopy(kktPlaylistText(state.final.tracks));
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
      skeleton("wait", `<div class="kkt-stage"><div class="kkt-wrap"><h1 class="kkt-title">Kietkoutsa Reborn</h1><p class="kkt-sub">Connexion a la partie…</p></div></div>`);
      return;
    }
    if (s.phase === "settings") renderSettings(s);
    else if (s.phase === "submit") renderSubmit(s);
    else if (s.phase === "playing") renderPlaying(s);
    else if (s.phase === "reveal") renderReveal(s);
    else if (s.phase === "ended") renderEnded(s);
  }

  function lateBanner() {
    return you && you.late ? `<div class="kkt-banner">👋 Tu es arrive en cours de partie : tu joues en <b>detective</b> (tu votes et tu marques, sans son a toi).</div>` : "";
  }

  // ---------- SETTINGS: avatar + mode vote ----------
  function renderSettings(s) {
    skeleton("settings", `<div class="kkt-stage"><div class="kkt-wrap">
      <p class="kkt-eyebrow">Mise en place</p><h1 class="kkt-title">Kietkoutsa Reborn</h1>
      <div class="kkt-card"><h2 class="kkt-h2" style="margin-top:0">Ton avatar</h2><div id="kkt-me-av"></div><div id="kkt-av"></div></div>
      <div class="kkt-card"><h2 class="kkt-h2" style="margin-top:0">Vote pour le mode</h2><div id="kkt-modes"></div>
        <p class="kkt-small">Le host decide d'appliquer (ou non) le vote de la salle.</p></div>
      <div class="kkt-card"><h2 class="kkt-h2" style="margin-top:0">Reglages du host</h2><div id="kkt-sum"></div></div>
      <p class="kkt-sub">Prepare tes meilleurs sons ! 🎧</p></div></div>`);
    kktPatch("kkt-me-av", `<div class="kkt-row">${kktAvatar(you.avatar, 54)} <b>${kktEsc(you.name)}</b></div>`);
    kktPatch("kkt-av", kktAvatarPicker(you.avatar, s.emojis || [], s.colors || []));
    kktPatch("kkt-modes", `<div class="kkt-modes">` + Object.keys(s.modes || {}).map((id) => {
      const m = s.modes[id], n = (s.modeTally || {})[id];
      return `<button class="kkt-mode ${you.modeVote === id ? "on" : ""}" data-mode="${id}">${n ? `<span class="tally">${n}</span>` : ""}
        <span class="e">${m.emoji}</span><span class="n">${kktEsc(m.label)}${s.settings.mode === id ? " (choisi)" : ""}</span><span class="r">${kktEsc(m.rule)}</span></button>`;
    }).join("") + `</div>`);
    kktPatch("kkt-sum", settingsSummary(s.settings));
  }
  function settingsSummary(st) {
    const on = [["blind", "🙈 Blind"], ["theme", "🎲 Theme"], ["bets", "🪙 Mises"], ["jokers", "🃏 Jokers"], ["hints", "💡 Indices"],
      ["speed", "⚡ Rapidite"], ["finalDouble", "🔥 Finale x2"], ["autoNext", "🔁 Auto"], ["noExplicit", "🚫 Explicite"]]
      .filter(([k]) => st[k]).map(([, l]) => `<span class="kkt-chip on">${l}</span>`).join("");
    return `<div class="kkt-chips"><span class="kkt-chip">${st.perPlayer} son(s) chacun</span><span class="kkt-chip">${st.roundSec}s / manche</span>${on}</div>`;
  }

  // ---------- SUBMIT ----------
  function renderSubmit(s) {
    if (skeleton("submit", `<div class="kkt-stage"><div class="kkt-wrap">
      <p class="kkt-eyebrow">Propositions · ${kktEsc(s.mode.emoji + " " + s.mode.label)}</p><h1 class="kkt-title">Choisis ta musique</h1>
      <div id="kkt-sub-info"></div>
      ${s.submitEndsAt ? `<p class="kkt-sub">Temps restant : <span class="kkt-count" data-countdown="${s.submitEndsAt}"></span></p>` : ""}
      <div id="kkt-search"></div>
      <div class="kkt-you-panel"><h3 class="kkt-h2" style="margin:0 0 6px">Les joueurs</h3><div id="kkt-ready" class="kkt-players"></div></div></div></div>`)) {
      if (!you.late) search = KktSearch(document.getElementById("kkt-search"), send);
    }
    kktPatch("kkt-sub-info", lateBanner() +
      (s.theme ? `<div class="kkt-banner gold">🎲 Theme : <b>${kktEsc(s.theme)}</b></div>` : "") +
      (you.target ? `<div class="kkt-banner">🎭 Tu imites <b>${kktEsc(you.target.name)}</b> : mets un son qu'il/elle aurait mis ! (+1 par vote qui tombe sur lui/elle)</div>` : "") +
      (s.settings.mode === "truebluff" ? `<div class="kkt-banner">🃏 Mets 2 sons : un vrai coup de coeur 💖 et un bluff 🃏 (indique lequel est lequel).</div>` : "") +
      (s.settings.blind ? `<p class="kkt-small">🙈 Mode Blind : pendant la manche, on n'entendra que l'audio.</p>` : ""));
    if (search) search.update(you, s);
    kktPatch("kkt-ready", s.players.map((p) => {
      const ok = p.owner && p.done >= s.perPlayer;
      return `<div class="kkt-pl ${ok ? "ok" : ""} ${p.connected ? "" : "off"} ${p.id === me() ? "me" : ""}">${kktAvatar(p.avatar, 34)}
        <div><div class="nm">${kktEsc(p.name)}${p.id === me() ? " (toi)" : ""}</div><div class="mt">${p.owner ? `${p.done}/${s.perPlayer}${ok ? " ✓" : "…"}` : "detective"}</div></div></div>`;
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
      <button id="kkt-listen" class="kkt-btn ghost" hidden>▶ Ecouter</button>
      ${lateBanner()}
      <div id="kkt-vp"></div><div id="kkt-guess-wrap"></div></div></div>`)) {
      if (s.settings.blind && !you.ownedParts.includes(0)) { document.getElementById("kkt-guess-wrap").innerHTML = kktGuessBox(s.parts.length > 1); kktWireGuess(send); }
    }
    root.querySelectorAll("[data-countdown]").forEach((el) => el.setAttribute("data-countdown", s.endsAt));
    root.querySelectorAll("[data-bar-end]").forEach((el) => el.setAttribute("data-bar-end", s.endsAt));
    if (s.settings.playback === "all") {
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
    if (!revealShownAt[key]) revealShownAt[key] = Date.now();
    const suspense = 300 + r.votes.length * 450 + 200 + 1600; // = host animation length
    const waitMs = revealShownAt[key] + suspense - Date.now();
    if (waitMs > 0) {
      skeleton(key + "|wait", `<div class="kkt-stage"><div class="kkt-wrap kkt-reveal"><p class="kkt-eyebrow">Manche ${s.round}/${s.total}</p>
        <div class="kkt-vinyl" style="margin:20px auto"></div><h1 class="kkt-title">Regarde l'ecran 👀</h1><p class="kkt-sub">Revelation en cours…</p></div></div>`);
      clearTimeout(renderReveal._t);
      renderReveal._t = setTimeout(render, waitMs + 50);
      return;
    }
    skeleton(key, `<div class="kkt-stage"><div class="kkt-wrap kkt-reveal"><p class="kkt-eyebrow">Manche ${s.round}/${s.total}${r.mult > 1 ? " · points x2" : ""}</p>
      <div id="kkt-r-parts"></div><div id="kkt-r-me"></div><div id="kkt-r-rate"></div><div id="kkt-lb"></div><p class="kkt-sub" id="kkt-r-wait" style="margin-top:12px"></p></div></div>`);
    kktPatch("kkt-r-parts", r.parts.map((p, i) => `<div class="kkt-card">
      <div class="kkt-row kkt-center"><img class="kkt-cover" style="width:90px;height:90px" src="${kktEsc(p.track.cover)}" alt="" onerror="this.style.visibility='hidden'"/>
      <div style="text-align:left"><div class="kkt-tname" style="text-align:left;font-size:1.4rem">${kktEsc(p.track.title)}</div><div class="kkt-tart" style="text-align:left">${kktEsc(p.track.artist)}</div>
      ${p.track.link ? `<a href="${kktEsc(p.track.link)}" target="_blank" rel="noopener" class="kkt-btn sm ghost" style="display:inline-block;margin-top:6px;text-decoration:none">🎧 Ecouter en entier</a>` : ""}</div></div>
      <div class="kkt-owner">${kktAvatar(p.ownerAvatar, 36)} ${r.parts.length > 1 ? "#" + (i + 1) + " " : ""}C'etait ${kktEsc(p.ownerName)} !</div>
      ${p.targetName ? `<p class="kkt-sub">🎭 imitait ${kktEsc(p.targetName)}</p>` : ""}
      ${p.nature ? `<p class="kkt-sub">${p.nature === "sincere" ? "💖 Vrai coup de coeur" : "🃏 Bluff"}</p>` : ""}
      ${p.note ? `<p class="kkt-note">💬 « ${kktEsc(p.note)} »</p>` : ""}
      <p class="kkt-small">${p.found} l'ont trouve.</p></div>`).join(""));
    const g = r.gains[me()];
    kktPatch("kkt-r-me", `<div class="kkt-banner ${g > 0 ? "gold" : ""}">${g > 0 ? "+" + g + " pour toi 🎉" : g < 0 ? g + " (mise perdue)" : "0 point cette manche"}</div>` +
      (r.combos.length ? `<p class="kkt-sub">🔥 Combo : ${r.combos.map(kktEsc).join(", ")}</p>` : ""));
    kktPatch("kkt-r-rate", r.parts.map((p, i) => p.ownerId === me() ? "" : `<div class="kkt-row kkt-center"><span class="kkt-sub">${r.parts.length > 1 ? "#" + (i + 1) + " " : ""}Ce son ?</span>
      <button class="kkt-vb ${you.rated[i] === 1 ? "on" : ""}" data-rate="1" data-part="${i}">👍</button>
      <button class="kkt-vb ${you.rated[i] === -1 ? "on" : ""}" data-rate="-1" data-part="${i}">👎</button></div>`).join(""));
    kktPatch("kkt-lb", kktLeaderboard(s.leaderboard, me(), { gains: r.gains }));
    kktPatch("kkt-r-wait", s.nextAt ? `Manche suivante dans <span data-countdown="${s.nextAt}"></span>` : (s.last ? "Partie terminee ! Classement sur l'ecran…" : "En attente du host…"));
    if (s.settings.playback === "all" && s.nextPreviews && s.nextPreviews.join() !== lastPreload) { lastPreload = s.nextPreviews.join(); kktAudio.preload(s.nextPreviews); }
  }

  // ---------- ENDED ----------
  function renderEnded(s) {
    if (!s.final) {
      skeleton("ended-empty", `<div class="kkt-stage"><div class="kkt-wrap kkt-reveal"><h1 class="kkt-title">Partie terminee</h1><p class="kkt-sub">${kktEsc(s.endReason || "")}</p></div></div>`);
      return;
    }
    const rank = s.leaderboard.findIndex((l) => l.id === me());
    const mine = s.final.badges.filter((b) => b.playerId === me());
    const tabs = [["score", "Total"], ["det", "🕵️"], ["cam", "🦎"]].concat(s.tournament && s.tournament.games > 1 ? [["total", "🏆"]] : []);
    skeleton("ended|" + endTab, `<div class="kkt-stage"><div class="kkt-wrap kkt-reveal">
      <p class="kkt-eyebrow">Fin de la partie</p>
      <h1 class="kkt-title">${rank === 0 ? "🏆 Tu gagnes !" : rank > 0 ? "Tu finis " + (rank + 1) + "e" : "Classement final"}</h1>
      ${mine.length ? `<div class="kkt-badges">${mine.map((x) => `<div class="kkt-badge"><span class="e">${x.emoji}</span><div><div class="t">${kktEsc(x.label)}</div><div class="d">${kktEsc(x.desc)}</div></div></div>`).join("")}</div>` : ""}
      <div class="kkt-tabs">${tabs.map(([k, l]) => `<button data-tab="${k}" class="${endTab === k ? "on" : ""}">${l}</button>`).join("")}</div>
      ${kktLeaderboard(s.leaderboard, me(), { key: endTab })}
      <h2 class="kkt-h2">La playlist de la soiree</h2>
      <div class="kkt-trk">${s.final.tracks.map((t) => `<div class="kkt-res"><img src="${kktEsc(t.cover)}" alt="" onerror="this.style.visibility='hidden'"/>
        <div class="info"><div class="t">${kktEsc(t.title)}</div><div class="a">${kktEsc(t.artist)} · ${kktEsc(t.ownerName)}</div></div>
        ${t.link ? `<a class="kkt-mini" style="display:flex;align-items:center;justify-content:center;text-decoration:none" href="${kktEsc(t.link)}" target="_blank" rel="noopener" aria-label="Ecouter">↗</a>` : ""}</div>`).join("")}</div>
      <div class="kkt-row kkt-center" style="margin-top:12px"><button id="kkt-copy" class="kkt-btn ghost">📋 Copier la playlist</button></div>
      <p class="kkt-sub">Le host peut relancer une partie.</p></div></div>`);
  }
})();
