// player.js -- Player (phone) view of "Kietkoutsa Reborn" (neon). Uses the shared
// participant controls from common.js (same search + vote as the host).
(function () {
  const socket = window.socket;
  const root = document.getElementById("game-root");
  const me = () => window.mySeatId;
  let state = null, you = { subs: [], perPlayer: 1, vote: null, isOwner: false };
  let builtKey = null, search = null, playingKey = null;
  kktInjectStyles();

  function send(type, payload) { socket.emit("game:action", { type, payload }); }

  socket.on("kkt:state", (s) => { state = s; render(); });
  socket.on("kkt:you", (d) => { you = d || you; if (search) search.update(you); if (state && state.phase === "playing") refreshVote(); });

  function render() {
    if (!state) return;
    const s = state;
    if (s.phase === "settings") return renderSettings(s);
    if (s.phase === "submit") return renderSubmit(s);
    if (s.phase === "playing") return renderPlaying(s);
    if (s.phase === "reveal") return renderReveal(s);
    if (s.phase === "ended") return renderEnded(s);
  }

  function renderSettings(s) {
    builtKey = "settings"; search = null;
    root.innerHTML = `<div class="kkt-stage"><div class="kkt-wrap">
      <p class="kkt-eyebrow">Mise en place</p><h1 class="kkt-title">Kietkoutsa Reborn</h1>
      <p class="kkt-sub">Le host regle la partie… prepare tes meilleurs sons ! 🎧</p></div></div>`;
  }

  function renderSubmit(s) {
    if (builtKey !== "submit" || !document.getElementById("kkt-ready")) {
      builtKey = "submit";
      root.innerHTML = `<div class="kkt-stage"><div class="kkt-wrap">
        <p class="kkt-eyebrow">Propositions</p><h1 class="kkt-title">Choisis ta musique</h1>
        <div id="kkt-search"></div>
        <div class="kkt-you-panel"><h3 class="kkt-title" style="font-size:1.1rem;margin:0 0 6px">Les joueurs</h3>
        <div id="kkt-ready" class="kkt-players"></div></div></div></div>`;
      search = KktSearch(document.getElementById("kkt-search"), send);
      search.update(you);
    }
    document.getElementById("kkt-ready").innerHTML = s.players.map((p) => {
      const ok = p.done >= s.perPlayer;
      return `<div class="kkt-pl ${ok ? "ok" : ""} ${p.connected ? "" : "off"} ${p.id === me() ? "me" : ""}">${kktAvatar(p.avatar, 36)}
        <div><div class="nm">${kktEsc(p.name)}${p.id === me() ? " (toi)" : ""}</div><div class="mt">${p.done}/${s.perPlayer}${ok ? " ✓" : "…"}</div></div></div>`;
    }).join("");
  }

  function renderPlaying(s) {
    builtKey = "playing"; search = null;
    const pk = s.round + ":" + (s.track && s.track.preview);
    if (s.settings.playback === "all" && playingKey !== pk) {
      playingKey = pk;
      kktAudio.play(s.track.preview).catch(() => { const b = document.getElementById("kkt-listen"); if (b) b.hidden = false; });
    }
    const left = Math.max(0, Math.round((s.endsAt - Date.now()) / 1000));
    root.innerHTML = `<div class="kkt-stage"><div class="kkt-wrap" style="text-align:center">
      <p class="kkt-eyebrow">Manche ${s.round}/${s.total}</p>
      <img class="kkt-cover" src="${kktEsc(s.track.cover)}" onerror="this.style.visibility='hidden'"/>
      <div class="kkt-tname">${kktEsc(s.track.title)}</div><div class="kkt-tart">${kktEsc(s.track.artist)}</div>
      <div class="kkt-count" id="kkt-count">${left}s</div>
      <button id="kkt-listen" class="kkt-btn ghost" hidden>▶ Ecouter</button>
      <p class="kkt-sub">${you.isOwner ? "🤫 C'est TON son. Vote pour de faux si tu veux." : "Qui a mis ce son ?"}</p>
      <div id="kkt-votes">${kktVoteButtons(s.players, me(), you.vote)}</div></div></div>`;
    wireVotes();
    const lb = document.getElementById("kkt-listen");
    if (lb) lb.onclick = () => { lb.hidden = true; kktAudio.play(s.track.preview).catch(() => {}); };
  }
  function refreshVote() {
    const box = document.getElementById("kkt-votes");
    if (box && state) { box.innerHTML = kktVoteButtons(state.players, me(), you.vote); wireVotes(); }
  }
  function wireVotes() {
    root.querySelectorAll("[data-vote]").forEach((b) => (b.onclick = () => send("vote", { target: b.getAttribute("data-vote") })));
  }

  function renderReveal(s) {
    builtKey = "reveal"; search = null; kktAudio.stop();
    const r = s.result;
    root.innerHTML = `<div class="kkt-stage"><div class="kkt-wrap kkt-reveal">
      <p class="kkt-eyebrow">Manche ${s.round}/${s.total}</p>
      <img class="kkt-cover" src="${kktEsc(r.track.cover)}" onerror="this.style.visibility='hidden'"/>
      <div class="kkt-tname">${kktEsc(r.track.title)}</div>
      <div class="kkt-owner">${kktAvatar(r.ownerAvatar, 36)} C'etait ${kktEsc(r.ownerName)} !</div>
      <p class="kkt-sub">${r.found} l'ont trouve.${r.ownerId === me() ? " (+" + r.ownerPts + " pour toi)" : ""}</p>
      ${kktLeaderboard(s.leaderboard, me())}
      <p class="kkt-sub" style="margin-top:12px">${s.last ? "Partie terminee !" : "En attente du host…"}</p></div></div>`;
  }

  function renderEnded(s) {
    builtKey = "ended"; search = null; kktAudio.stop();
    const rank = s.leaderboard.findIndex((l) => l.id === me());
    root.innerHTML = `<div class="kkt-stage"><div class="kkt-wrap kkt-reveal">
      <p class="kkt-eyebrow">Fin de la partie</p>
      <h1 class="kkt-title">${rank === 0 ? "🏆 Tu gagnes !" : "Classement final"}</h1>
      ${kktLeaderboard(s.leaderboard, me())}</div></div>`;
  }

  setInterval(() => {
    const el = document.getElementById("kkt-count");
    if (el && state && state.phase === "playing" && state.endsAt) {
      const left = Math.max(0, Math.round((state.endsAt - Date.now()) / 1000));
      el.textContent = left + "s"; el.classList.toggle("low", left <= 5);
    }
  }, 300);
})();
