// player.js -- Player (phone) view of "Kietkoutsa Reborn".
(function () {
  const socket = window.socket;
  const root = document.getElementById("game-root");
  let state = null, you = { subs: [], perPlayer: 1, vote: null, isOwner: false };
  let phaseBuilt = null;     // which phase's shell is currently in the DOM
  let lastSig = null;
  let searchTimer = null, searchSeq = 0, lastQuery = "";
  let playingTrackKey = null; // avoid restarting the song on every state tick
  kktInjectStyles();

  const me = () => window.mySeatId;
  function send(type, payload) { socket.emit("game:action", { type, payload }); }

  socket.on("kkt:state", (s) => { state = s; render(); });
  socket.on("kkt:you", (d) => { you = d || you; render(); });

  function render() {
    if (!state) return;
    const s = state;
    if (s.phase === "submit") return renderSubmit(s);      // special: preserve the search box
    phaseBuilt = null;                                      // leaving submit -> rebuild next time
    const sg = s.phase + "|" + JSON.stringify(you) + "|" + quickSig(s);
    if (sg === lastSig) return;
    lastSig = sg;
    if (s.phase === "settings") renderSettings(s);
    else if (s.phase === "playing") renderPlaying(s);
    else if (s.phase === "reveal") renderReveal(s);
    else if (s.phase === "ended") renderEnded(s);
  }
  function quickSig(s) {
    if (s.phase === "playing") return s.round + "|" + (s.track && s.track.title) + "|" + (s.settings.playback);
    if (s.phase === "reveal") return (s.result && s.result.ownerId) + "|" + s.leaderboard.map((l) => l.id + l.score).join(",");
    if (s.phase === "ended") return s.leaderboard.map((l) => l.id + l.score).join(",");
    return s.players ? s.players.length : 0;
  }

  // ---------- settings (wait) ----------
  function renderSettings(s) {
    root.innerHTML = `<div class="kkt-wrap"><p class="kkt-eyebrow">Mise en place</p>
      <h1 class="kkt-title">Kietkoutsa Reborn</h1>
      <p class="kkt-sub">Le host regle la partie… prepare tes meilleurs sons ! 🎧</p></div>`;
  }

  // ---------- submit (search + picks) : built once, then patched ----------
  function renderSubmit(s) {
    if (phaseBuilt !== "submit") {
      phaseBuilt = "submit"; lastSig = null;
      root.innerHTML = `<div class="kkt-wrap">
        <p class="kkt-eyebrow">Propositions</p>
        <h1 class="kkt-title">Choisis ta musique</h1>
        <p class="kkt-sub" id="kkt-pick-count"></p>
        <input id="kkt-q" class="kkt-search" placeholder="Rechercher un titre, un artiste…" autocomplete="off"/>
        <div id="kkt-results" class="kkt-results"></div>
        <h2 class="kkt-title" style="font-size:1.2rem;margin-top:16px">Mes morceaux</h2>
        <div id="kkt-mine" class="kkt-mine"></div>
        <h2 class="kkt-title" style="font-size:1.2rem;margin-top:16px">Les joueurs</h2>
        <div id="kkt-ready" class="kkt-players"></div>
      </div>`;
      const q = document.getElementById("kkt-q");
      q.addEventListener("input", () => {
        const val = q.value.trim();
        clearTimeout(searchTimer);
        if (!val) { document.getElementById("kkt-results").innerHTML = ""; return; }
        searchTimer = setTimeout(() => doSearch(val), 350);
      });
    }
    patchPickCount(s); patchMine(); patchReady(s);
  }
  function patchPickCount(s) {
    const el = document.getElementById("kkt-pick-count"); if (!el) return;
    const n = you.subs.length, max = you.perPlayer || s.perPlayer || 1;
    el.innerHTML = n >= max ? `✅ Tu as choisi tes ${max} morceau${max > 1 ? "x" : ""}. Tu peux encore les changer.`
      : `Choisis-en <strong>${max - n}</strong> de plus (${n}/${max}).`;
  }
  function doSearch(q) {
    const seq = ++searchSeq; lastQuery = q;
    const box = document.getElementById("kkt-results");
    if (box) box.innerHTML = `<p class="kkt-sub">Recherche…</p>`;
    fetch("/api/music/search?q=" + encodeURIComponent(q)).then((r) => r.json()).then((d) => {
      if (seq !== searchSeq) return; // a newer search started
      const box2 = document.getElementById("kkt-results"); if (!box2) return;
      const full = you.subs.length >= (you.perPlayer || 1);
      box2.innerHTML = (d.results || []).map((t, i) =>
        `<div class="kkt-res" data-i="${i}">
          <img src="${kktEsc(t.cover)}" onerror="this.style.visibility='hidden'"/>
          <div class="info"><div class="t">${kktEsc(t.title)}</div><div class="a">${kktEsc(t.artist)}</div></div>
          <button class="kkt-mini" data-prev="${i}">▶</button>
          <button class="kkt-mini kkt-pick" data-pick="${i}" ${full ? "disabled" : ""}>+</button>
        </div>`).join("") || `<p class="kkt-sub">Aucun resultat.</p>`;
      const results = d.results || [];
      box2.querySelectorAll("[data-prev]").forEach((b) =>
        (b.onclick = () => kktAudio.play(results[+b.getAttribute("data-prev")].preview).catch(() => {})));
      box2.querySelectorAll("[data-pick]").forEach((b) =>
        (b.onclick = () => { kktAudio.stop(); send("submitTrack", { track: results[+b.getAttribute("data-pick")] }); }));
    }).catch(() => { const b = document.getElementById("kkt-results"); if (b) b.innerHTML = `<p class="kkt-sub">Recherche indisponible.</p>`; });
  }
  function patchMine() {
    const el = document.getElementById("kkt-mine"); if (!el) return;
    el.innerHTML = you.subs.length ? you.subs.map((t) =>
      `<div class="kkt-res"><img src="${kktEsc(t.cover)}" onerror="this.style.visibility='hidden'"/>
        <div class="info"><div class="t">${kktEsc(t.title)}</div><div class="a">${kktEsc(t.artist)}</div></div>
        <button class="kkt-mini" data-prev="${kktEsc(t.preview)}">▶</button>
        <button class="kkt-mini" data-rm="${kktEsc(t.id)}">✕</button></div>`).join("")
      : `<p class="kkt-sub">Rien encore.</p>`;
    el.querySelectorAll("[data-prev]").forEach((b) => (b.onclick = () => kktAudio.play(b.getAttribute("data-prev")).catch(() => {})));
    el.querySelectorAll("[data-rm]").forEach((b) => (b.onclick = () => send("removeTrack", { trackId: b.getAttribute("data-rm") })));
  }
  function patchReady(s) {
    const el = document.getElementById("kkt-ready"); if (!el) return;
    el.innerHTML = s.players.map((p) => {
      const ok = p.done >= s.perPlayer;
      return `<div class="kkt-pl ${ok ? "ok" : ""} ${p.connected ? "" : "off"}">${kktAvatar(p.avatar, 36)}
        <div><div class="nm">${kktEsc(p.name)}</div><div class="mt">${p.done}/${s.perPlayer}${ok ? " ✓" : "…"}</div></div></div>`;
    }).join("");
  }

  // ---------- playing (vote) ----------
  function renderPlaying(s) {
    // play the preview on this device if the host chose "everyone hears"
    const key = s.round + ":" + (s.track && s.track.preview);
    if (s.settings.playback === "all" && playingTrackKey !== key) {
      playingTrackKey = key;
      kktAudio.play(s.track.preview).catch(() => { const b = document.getElementById("kkt-listen"); if (b) b.hidden = false; });
    }
    const mine = s.players.find((p) => p.id === me());
    const others = s.players.filter((p) => p.id !== me());
    const left = Math.max(0, Math.round((s.endsAt - Date.now()) / 1000));
    root.innerHTML = `<div class="kkt-wrap" style="text-align:center">
      <p class="kkt-eyebrow">Manche ${s.round}/${s.total}</p>
      <img class="kkt-cover" src="${kktEsc(s.track.cover)}" onerror="this.style.visibility='hidden'"/>
      <div class="kkt-tname">${kktEsc(s.track.title)}</div><div class="kkt-tart">${kktEsc(s.track.artist)}</div>
      <div class="kkt-count" id="kkt-count">${left}s</div>
      <button id="kkt-listen" class="kkt-btn ghost" hidden>▶ Ecouter</button>
      <p class="kkt-sub">${you.isOwner ? "🤫 C'est TON son. Vote pour de faux si tu veux (ca ne compte pas)." : "Qui a mis ce son ?"}</p>
      <div class="kkt-votebtns">` + others.map((p) =>
        `<button class="kkt-vb ${you.vote === p.id ? "on" : ""}" data-vote="${p.id}">${kktAvatar(p.avatar, 28)} ${kktEsc(p.name)}</button>`).join("")
      + `</div></div>`;
    root.querySelectorAll("[data-vote]").forEach((b) => (b.onclick = () => send("vote", { target: b.getAttribute("data-vote") })));
    const lb = document.getElementById("kkt-listen");
    if (lb) lb.onclick = () => { lb.hidden = true; kktAudio.play(s.track.preview).catch(() => {}); };
  }

  // ---------- reveal ----------
  function renderReveal(s) {
    kktAudio.stop();
    const r = s.result;
    const mine = r.foundNames && r.ownerId === me();
    root.innerHTML = `<div class="kkt-wrap" style="text-align:center">
      <p class="kkt-eyebrow">Manche ${s.round}/${s.total}</p>
      <img class="kkt-cover" src="${kktEsc(r.track.cover)}" onerror="this.style.visibility='hidden'"/>
      <div class="kkt-tname">${kktEsc(r.track.title)}</div>
      <div class="kkt-owner">${kktAvatar(r.ownerAvatar, 36)} C'etait ${kktEsc(r.ownerName)} !</div>
      <p class="kkt-sub">${r.found} l'ont trouve.${r.ownerId === me() ? " (+" + r.ownerPts + " pour toi)" : ""}</p>
      ${leadHtml(s.leaderboard)}
      <p class="kkt-sub" style="margin-top:12px">${s.last ? "Partie terminee !" : "En attente du host…"}</p></div>`;
  }

  // ---------- ended ----------
  function renderEnded(s) {
    kktAudio.stop();
    const meRank = s.leaderboard.findIndex((l) => l.id === me());
    root.innerHTML = `<div class="kkt-wrap" style="text-align:center">
      <p class="kkt-eyebrow">Fin de la partie</p>
      <h1 class="kkt-title">${meRank === 0 ? "🏆 Tu gagnes !" : "Classement final"}</h1>
      ${leadHtml(s.leaderboard)}</div>`;
  }

  function leadHtml(lead) {
    return `<div class="kkt-lead">` + lead.map((l, i) =>
      `<div class="kkt-le ${l.id === me() ? "top" : ""}"><span class="rk">${i + 1}</span>${kktAvatar(l.avatar, 28)}
        <span class="nm">${kktEsc(l.name)}${l.id === me() ? " (toi)" : ""}</span><span class="sc">${l.score}</span></div>`).join("") + `</div>`;
  }

  // live countdown
  setInterval(() => {
    const el = document.getElementById("kkt-count");
    if (el && state && state.phase === "playing" && state.endsAt) {
      const left = Math.max(0, Math.round((state.endsAt - Date.now()) / 1000));
      el.textContent = left + "s"; el.classList.toggle("low", left <= 5);
    }
  }, 300);
})();
