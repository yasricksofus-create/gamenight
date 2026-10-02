// host.js -- Host (shared screen) for "Kietkoutsa Reborn".
// On THIS game the host is ALSO a player: it submits a song and votes, from this
// same screen (its private info arrives via kkt:you over toHost; its seat is the
// server's HOST_SEAT). Only reacts to kkt:* events.
(function () {
  const socket = window.socket;
  const root = document.getElementById("game-root");
  const me = "__host__"; // the host's seat id in this game
  let state = null, you = { subs: [], perPlayer: 1, vote: null, isOwner: false };
  let cheats = [], prevPhase = null, builtKey = null, search = null, playingKey = null;
  kktInjectStyles();

  const DIR = "/games/kietkoutsa/sounds/";
  if (window.Sound) {
    Sound.registerAuto("kkt-lobby", "lobby", { loop: true, dir: DIR });
    Sound.registerAuto("kkt-reveal", "reveal", { dir: DIR });
    Sound.registerAuto("kkt-victoire", "victoire", { dir: DIR });
  }
  function phaseSound(ph) {
    if (!window.Sound) return;
    if (ph === "settings" || ph === "submit") Sound.music("kkt-lobby");
    else if (ph === "playing") Sound.stop("kkt-lobby"); // the song itself plays
    else if (ph === "reveal") Sound.sfx("kkt-reveal", { duck: false });
    else if (ph === "ended") Sound.music("kkt-victoire");
  }

  fetch("/api/games/kietkoutsa").then((r) => r.json()).then((g) => { cheats = g.cheats || []; builtKey = null; render(); }).catch(() => {});

  socket.on("kkt:state", (s) => {
    const ph = s.phase;
    if (ph !== prevPhase) { phaseSound(ph); prevPhase = ph; if (ph !== "playing") kktAudio.stop(); }
    state = s; render();
  });
  socket.on("kkt:you", (d) => { you = d || you; if (search) search.update(you); });
  socket.on("kkt:cheatReveal", ({ name }) => kktToast("C'est " + name + " qui a mis ce son"));

  function send(type, payload) { socket.emit("game:action", { type, payload }); }

  setInterval(() => {
    const el = document.getElementById("kkt-count");
    if (el && state && state.phase === "playing" && state.endsAt) {
      const left = Math.max(0, Math.round((state.endsAt - Date.now()) / 1000));
      el.textContent = left + "s"; el.classList.toggle("low", left <= 5);
    }
  }, 300);

  function cheatBar() {
    if (!cheats.length) return "";
    return `<div class="kkt-cheatbar">` + cheats.map((c) =>
      `<button class="kkt-cheat" data-cheat="${c.id}">${c.emoji || "✨"} ${kktEsc(c.label)}</button>`).join("") + `</div>`;
  }
  function wireCheats() {
    root.querySelectorAll(".kkt-cheat").forEach((b) => (b.onclick = () => socket.emit("host:cheat", { cheatId: b.getAttribute("data-cheat") })));
  }

  function render() {
    if (!state) return;
    const s = state;
    const key = s.phase + "|" + (s.players ? s.players.map((p) => p.id).join(",") : "");
    if (s.phase === "settings") return renderSettings(s, key);
    if (s.phase === "submit") return renderSubmit(s, key);
    if (s.phase === "playing") return renderPlaying(s);
    if (s.phase === "reveal") return renderReveal(s);
    if (s.phase === "ended") return renderEnded(s);
  }

  function renderSettings(s, key) {
    if (builtKey === key && document.getElementById("kkt-begin")) {
      setText("kkt-pp", s.settings.perPlayer);
      root.querySelectorAll("[data-pb]").forEach((b) => b.classList.toggle("on", b.getAttribute("data-pb") === s.settings.playback));
      return;
    }
    builtKey = key; search = null;
    root.innerHTML = `<div class="kkt-stage"><div class="kkt-wrap">
      <p class="kkt-eyebrow">Mise en place</p><h1 class="kkt-title">Kietkoutsa Reborn</h1>
      <div class="kkt-card"><p class="kkt-sub">Morceaux par joueur</p>
        <div class="kkt-stepper"><button id="kkt-minus">-</button><span id="kkt-pp">${s.settings.perPlayer}</span><button id="kkt-plus">+</button></div></div>
      <div class="kkt-card"><p class="kkt-sub">Qui entend la musique ?</p>
        <div class="kkt-toggle">
          <button data-pb="all" class="${s.settings.playback === "all" ? "on" : ""}">Tout le monde</button>
          <button data-pb="host" class="${s.settings.playback === "host" ? "on" : ""}">Le host seulement</button></div></div>
      <button id="kkt-begin" class="kkt-btn">Commencer les propositions</button></div></div>`;
    bind("kkt-minus", () => send("setPerPlayer", { n: state.settings.perPlayer - 1 }));
    bind("kkt-plus", () => send("setPerPlayer", { n: state.settings.perPlayer + 1 }));
    bind("kkt-begin", () => send("beginSubmit"));
    root.querySelectorAll("[data-pb]").forEach((b) => (b.onclick = () => send("setPlayback", { mode: b.getAttribute("data-pb") })));
  }

  function renderSubmit(s, key) {
    if (builtKey !== key || !document.getElementById("kkt-ready")) {
      builtKey = key;
      root.innerHTML = `<div class="kkt-stage"><div class="kkt-wrap">
        <p class="kkt-eyebrow">Propositions</p><h1 class="kkt-title">Choisis ta musique (toi aussi)</h1>
        <div id="kkt-search"></div>
        <div class="kkt-you-panel"><h3 class="kkt-title" style="font-size:1.1rem;margin:0 0 6px">Les joueurs</h3>
        <div id="kkt-ready" class="kkt-players"></div>
        <button id="kkt-start" class="kkt-btn" disabled>Lancer les manches</button>${cheatBar()}</div>
      </div></div>`;
      search = KktSearch(document.getElementById("kkt-search"), send);
      search.update(you);
      bind("kkt-start", () => send("startRounds"));
      wireCheats();
    }
    // patch readiness + start button
    const ready = s.players.filter((p) => p.done >= s.perPlayer).length;
    document.getElementById("kkt-ready").innerHTML = s.players.map((p) => {
      const ok = p.done >= s.perPlayer;
      return `<div class="kkt-pl ${ok ? "ok" : ""} ${p.connected ? "" : "off"} ${p.id === me ? "me" : ""}">${kktAvatar(p.avatar, 36)}
        <div><div class="nm">${kktEsc(p.name)}${p.id === me ? " (toi)" : ""}</div><div class="mt">${p.done}/${s.perPlayer}${ok ? " ✓" : "…"}</div></div></div>`;
    }).join("");
    const sb = document.getElementById("kkt-start");
    if (sb) sb.disabled = !(ready >= s.players.length);
  }

  function renderPlaying(s) {
    builtKey = null;
    // the host screen always plays the 30s preview (shared speakers)
    const pk = s.round + ":" + (s.track && s.track.preview);
    if (playingKey !== pk) { playingKey = pk; kktAudio.play(s.track.preview).catch(() => {}); }
    const left = Math.max(0, Math.round((s.endsAt - Date.now()) / 1000));
    root.innerHTML = `<div class="kkt-stage"><div class="kkt-wrap" style="text-align:center">
      <p class="kkt-eyebrow">Manche ${s.round}/${s.total}</p>
      <div class="kkt-now">
        <img class="kkt-cover" src="${kktEsc(s.track.cover)}" onerror="this.style.visibility='hidden'"/>
        <div class="kkt-tname">${kktEsc(s.track.title)}</div><div class="kkt-tart">${kktEsc(s.track.artist)}</div>
        <div class="kkt-count" id="kkt-count">${left}s</div>
        <p class="kkt-sub">${s.votedCount}/${s.players.length} ont vote</p>
      </div>
      <p class="kkt-sub">${you.isOwner ? "🤫 C'est TON son. Vote pour de faux si tu veux." : "Toi aussi, vote : qui a mis ce son ?"}</p>
      ${kktVoteButtons(s.players, me, you.vote)}
      <div class="kkt-you-panel"><div class="kkt-players" style="justify-content:center">` + s.players.map((p) =>
        `<div class="kkt-pl ${p.connected ? "" : "off"} ${p.id === me ? "me" : ""}">${kktAvatar(p.avatar, 30)}
          <div><div class="nm">${kktEsc(p.name)}</div><div class="mt">${p.voted ? '<span class="kkt-voted">a vote ✓</span>' : "…"}</div></div></div>`).join("")
      + `</div>${cheatBar()}</div></div></div>`;
    root.querySelectorAll("[data-vote]").forEach((b) => (b.onclick = () => send("vote", { target: b.getAttribute("data-vote") })));
    wireCheats();
  }

  function renderReveal(s) {
    builtKey = null; kktAudio.stop();
    const r = s.result;
    root.innerHTML = `<div class="kkt-stage"><div class="kkt-wrap kkt-reveal">
      <p class="kkt-eyebrow">Manche ${s.round}/${s.total}</p>
      <img class="kkt-cover" src="${kktEsc(r.track.cover)}" onerror="this.style.visibility='hidden'"/>
      <div class="kkt-tname">${kktEsc(r.track.title)}</div><div class="kkt-tart">${kktEsc(r.track.artist)}</div>
      <div class="kkt-owner">${kktAvatar(r.ownerAvatar, 40)} C'etait ${kktEsc(r.ownerName)} ! (+${r.ownerPts})</div>
      <p class="kkt-sub">${r.found} joueur${r.found > 1 ? "s l'ont" : " l'a"} trouve${r.foundNames.length ? " : " + r.foundNames.map(kktEsc).join(", ") : ""}.</p>
      ${kktLeaderboard(s.leaderboard, me)}
      <div class="kkt-row" style="justify-content:center;margin-top:14px">
        <button id="kkt-next" class="kkt-btn">${s.last ? "Voir le classement final" : "Manche suivante"}</button></div>
      ${cheatBar()}</div></div>`;
    bind("kkt-next", () => send("next")); wireCheats();
  }

  function renderEnded(s) {
    builtKey = null; kktAudio.stop();
    root.innerHTML = `<div class="kkt-stage"><div class="kkt-wrap kkt-reveal">
      <p class="kkt-eyebrow">Fin de la partie</p><h1 class="kkt-title">Classement</h1>
      ${kktLeaderboard(s.leaderboard, me)}
      <h2 class="kkt-title" style="font-size:1.5rem;margin-top:22px">Les morceaux les plus malins</h2>
      <div class="kkt-trk">` + s.trackRanking.map((t, i) =>
      `<div class="kkt-res"><span class="kkt-le rk" style="background:none;border:none;padding:0 6px 0 0">${i + 1}</span>
        <img src="${kktEsc(t.cover)}" onerror="this.style.visibility='hidden'"/>
        <div class="info"><div class="t">${kktEsc(t.title)} — +${t.points}</div>
        <div class="a">${kktEsc(t.artist)} · mis par ${kktEsc(t.ownerName)}</div></div></div>`).join("")
      + `</div><div class="kkt-row" style="justify-content:center;margin-top:16px"><button id="kkt-replay" class="kkt-btn">Rejouer</button></div></div></div>`;
    bind("kkt-replay", () => send("replay"));
  }

  function bind(id, fn) { const el = document.getElementById(id); if (el) el.onclick = fn; }
  function setText(id, t) { const el = document.getElementById(id); if (el) el.textContent = t; }
})();
