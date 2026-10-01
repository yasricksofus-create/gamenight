// host.js -- Host (shared screen) for "Kietkoutsa Reborn". Only reacts to kkt:*.
(function () {
  const socket = window.socket;
  const root = document.getElementById("game-root");
  let state = null, cheats = [], lastSig = null, prevPhase = null;
  kktInjectStyles();

  // Optional sounds (silent until you drop files in games/kietkoutsa/sounds/):
  //   lobby.mp3 (reglages/propositions, loops), reveal.mp3, victoire.mp3
  const DIR = "/games/kietkoutsa/sounds/";
  if (window.Sound) {
    Sound.registerAuto("kkt-lobby", "lobby", { loop: true, dir: DIR });
    Sound.registerAuto("kkt-reveal", "reveal", { dir: DIR });
    Sound.registerAuto("kkt-victoire", "victoire", { dir: DIR });
  }
  function phaseSound(ph, s) {
    if (!window.Sound) return;
    if (ph === "settings" || ph === "submit") Sound.music("kkt-lobby");
    else if (ph === "playing") { Sound.stop("kkt-lobby"); } // the song itself is the audio
    else if (ph === "reveal") Sound.sfx("kkt-reveal", { duck: false });
    else if (ph === "ended") Sound.music("kkt-victoire");
  }

  fetch("/api/games/kietkoutsa").then((r) => r.json())
    .then((g) => { cheats = g.cheats || []; lastSig = null; render(); }).catch(() => {});

  socket.on("kkt:state", (s) => {
    const phChange = !prevPhase || prevPhase !== s.phase;
    state = s;
    if (phChange) { phaseSound(s.phase, s); prevPhase = s.phase; handlePlayback(s); }
    render();
  });
  socket.on("kkt:cheatReveal", ({ name }) => kktToast("C'est " + name + " qui a mis ce son"));

  function send(type, payload) { socket.emit("game:action", { type, payload }); }

  function handlePlayback(s) {
    // In "host only" mode, the host screen plays the 30s preview.
    if (s.phase === "playing" && s.settings.playback === "host" && s.track) {
      kktAudio.play(s.track.preview).catch(() => {});
    } else if (s.phase !== "playing") kktAudio.stop();
  }

  // live countdown during a round
  setInterval(() => {
    const el = document.getElementById("kkt-count");
    if (el && state && state.phase === "playing" && state.endsAt) {
      const left = Math.max(0, Math.round((state.endsAt - Date.now()) / 1000));
      el.textContent = left + "s";
      el.classList.toggle("low", left <= 5);
    }
  }, 300);

  function cheatBar() {
    if (!cheats.length) return "";
    return `<div class="kkt-cheatbar">` + cheats.map((c) =>
      `<button class="kkt-cheat" data-cheat="${c.id}">${c.emoji || "✨"} ${kktEsc(c.label)}</button>`).join("") + `</div>`;
  }

  function sig(s) {
    if (!s) return "";
    if (s.phase === "settings") return "set|" + s.settings.perPlayer + "|" + s.settings.playback + "|" + s.players.map((p) => p.id).join(",") + "|" + cheats.length;
    if (s.phase === "submit") return "sub|" + s.perPlayer + "|" + s.players.map((p) => p.id + ":" + p.done + ":" + (p.connected ? 1 : 0)).join(",") + "|" + cheats.length;
    if (s.phase === "playing") return "play|" + s.round + "|" + (s.track && s.track.title) + "|" + s.votedCount + "|" + s.players.map((p) => p.voted ? 1 : 0).join("") + "|" + cheats.length;
    if (s.phase === "reveal") return "rev|" + s.round + "|" + (s.result && s.result.ownerId) + "|" + s.leaderboard.map((l) => l.id + l.score).join(",") + "|" + cheats.length;
    if (s.phase === "ended") return "end|" + s.leaderboard.map((l) => l.id + l.score).join(",");
    return "";
  }

  function render() {
    if (!state) return;
    const sg = sig(state);
    if (sg === lastSig) return;
    lastSig = sg;
    const s = state;
    let html = `<div class="kkt-stage"><div class="kkt-wrap">`;

    if (s.phase === "settings") {
      html += `<p class="kkt-eyebrow">Mise en place</p><h1 class="kkt-title">Kietkoutsa Reborn</h1>
        <div class="kkt-card"><p class="kkt-sub">Morceaux par joueur</p>
          <div class="kkt-stepper"><button id="kkt-minus">-</button><span>${s.settings.perPlayer}</span><button id="kkt-plus">+</button></div></div>
        <div class="kkt-card"><p class="kkt-sub">Qui entend la musique ?</p>
          <div class="kkt-toggle">
            <button data-pb="all" class="${s.settings.playback === "all" ? "on" : ""}">Tout le monde</button>
            <button data-pb="host" class="${s.settings.playback === "host" ? "on" : ""}">Le host seulement</button>
          </div></div>
        <button id="kkt-begin" class="kkt-btn">Commencer les propositions</button>`;
    } else if (s.phase === "submit") {
      const ready = s.players.filter((p) => p.done >= s.perPlayer).length;
      html += `<p class="kkt-eyebrow">Propositions</p><h1 class="kkt-title">Chacun choisit ${s.perPlayer} morceau${s.perPlayer > 1 ? "x" : ""}</h1>
        <p class="kkt-sub">Les joueurs cherchent leurs sons sur leur telephone. ${ready}/${s.players.length} ont fini.</p>
        <div class="kkt-players">` + s.players.map((p) => {
        const ok = p.done >= s.perPlayer;
        return `<div class="kkt-pl ${ok ? "ok" : ""} ${p.connected ? "" : "off"}">${kktAvatar(p.avatar, 40)}
          <div><div class="nm">${kktEsc(p.name)}</div><div class="mt">${p.done}/${s.perPlayer}${ok ? " ✓" : "…"}</div></div></div>`;
      }).join("") + `</div>
        <button id="kkt-start" class="kkt-btn" ${ready >= s.players.length ? "" : "disabled"}>Lancer les manches</button>
        ${cheatBar()}`;
    } else if (s.phase === "playing") {
      const left = Math.max(0, Math.round((s.endsAt - Date.now()) / 1000));
      html += `<p class="kkt-eyebrow">Manche ${s.round}/${s.total}</p>
        <div class="kkt-now">
          <img class="kkt-cover" src="${kktEsc(s.track.cover)}" alt="" onerror="this.style.visibility='hidden'"/>
          <div class="kkt-tname">${kktEsc(s.track.title)}</div>
          <div class="kkt-tart">${kktEsc(s.track.artist)}</div>
          <div class="kkt-count" id="kkt-count">${left}s</div>
          <p class="kkt-sub">Qui a mis ce son ? ${s.votedCount}/${s.players.length} ont vote.</p>
        </div>
        <div class="kkt-players">` + s.players.map((p) =>
        `<div class="kkt-pl ${p.connected ? "" : "off"}">${kktAvatar(p.avatar, 36)}
          <div><div class="nm">${kktEsc(p.name)}</div><div class="mt">${p.voted ? '<span class="kkt-voted">a vote ✓</span>' : "…"}</div></div></div>`).join("")
        + `</div>${cheatBar()}`;
    } else if (s.phase === "reveal") {
      const r = s.result;
      html += `<div class="kkt-reveal"><p class="kkt-eyebrow">Manche ${s.round}/${s.total}</p>
        <img class="kkt-cover" src="${kktEsc(r.track.cover)}" alt="" onerror="this.style.visibility='hidden'"/>
        <div class="kkt-tname">${kktEsc(r.track.title)}</div><div class="kkt-tart">${kktEsc(r.track.artist)}</div>
        <div class="kkt-owner">${kktAvatar(r.ownerAvatar, 40)} C'etait ${kktEsc(r.ownerName)} ! (+${r.ownerPts})</div>
        <p class="kkt-sub">${r.found} joueur${r.found > 1 ? "s l'ont" : " l'a"} trouve${r.foundNames.length ? " : " + r.foundNames.map(kktEsc).join(", ") : ""}.</p>
        ${leadHtml(s.leaderboard)}
        <div class="kkt-row" style="justify-content:center;margin-top:14px">
          <button id="kkt-next" class="kkt-btn">${s.last ? "Voir le classement final" : "Manche suivante"}</button></div>
        ${cheatBar()}</div>`;
    } else if (s.phase === "ended") {
      html += `<div class="kkt-reveal"><p class="kkt-eyebrow">Fin de la partie</p><h1 class="kkt-title">Classement</h1>
        ${leadHtml(s.leaderboard)}
        <h2 class="kkt-title" style="font-size:1.5rem;margin-top:22px">Les morceaux les plus malins</h2>
        <div class="kkt-trk">` + s.trackRanking.map((t, i) =>
        `<div class="kkt-res"><span class="kkt-le rk" style="background:none;padding:0">${i + 1}</span>
          <img src="${kktEsc(t.cover)}" onerror="this.style.visibility='hidden'"/>
          <div class="info"><div class="t">${kktEsc(t.title)} — +${t.points}</div>
          <div class="a">${kktEsc(t.artist)} · mis par ${kktEsc(t.ownerName)}</div></div></div>`).join("")
        + `</div>
        <div class="kkt-row" style="justify-content:center;margin-top:16px"><button id="kkt-replay" class="kkt-btn">Rejouer</button></div></div>`;
    }

    html += `</div></div>`;
    root.innerHTML = html;
    bind("kkt-minus", () => send("setPerPlayer", { n: state.settings.perPlayer - 1 }));
    bind("kkt-plus", () => send("setPerPlayer", { n: state.settings.perPlayer + 1 }));
    bind("kkt-begin", () => send("beginSubmit"));
    bind("kkt-start", () => send("startRounds"));
    bind("kkt-next", () => send("next"));
    bind("kkt-replay", () => send("replay"));
    root.querySelectorAll("[data-pb]").forEach((b) => (b.onclick = () => send("setPlayback", { mode: b.getAttribute("data-pb") })));
    root.querySelectorAll(".kkt-cheat").forEach((b) => (b.onclick = () => socket.emit("host:cheat", { cheatId: b.getAttribute("data-cheat") })));
  }

  function leadHtml(lead) {
    return `<div class="kkt-lead">` + lead.map((l, i) =>
      `<div class="kkt-le ${i === 0 ? "top" : ""}"><span class="rk">${i + 1}</span>${kktAvatar(l.avatar, 30)}
        <span class="nm">${kktEsc(l.name)}</span><span class="sc">${l.score} pt${l.score > 1 ? "s" : ""}</span></div>`).join("") + `</div>`;
  }
  function bind(id, fn) { const el = document.getElementById(id); if (el) el.onclick = fn; }
})();
