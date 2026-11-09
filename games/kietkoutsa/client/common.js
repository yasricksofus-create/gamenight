// common.js -- Shared helpers, NEON/club styles and reusable UI for
// "Kietkoutsa Reborn". Loaded for BOTH the host screen and the phones.
//
// What lives here:
//   kktEsc / kktAvatar / kktToast      small helpers
//   kktPatch                           update a block only if its HTML changed
//                                      (no flicker, inputs keep their focus)
//   kktAudio                           synced playback of the 30s previews
//   kktViz                             real audio visualiser (host screen)
//   kktDrum                            synthesised drum roll (reveal)
//   KktSearch                          search + suggestions + my picks
//   kktVoteBlock / kktLeaderboard ...  reusable pieces of UI
(function () {
  window.kktEsc = function (s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  };

  // An avatar is the player's pixel-art face (made with the site's avatar
  // creator, managed by the engine). Drawn by PixelAvatar (public/js).
  window.kktAvatar = function (av, size) {
    size = size || 48;
    const url = window.PixelAvatar ? PixelAvatar.url(av || PixelAvatar.presets[0].parts) : "";
    return `<span class="kkt-av px" style="width:${size}px;height:${size}px"><img src="${url}" alt="" width="${size}" height="${size}"></span>`;
  };

  // Replace the content of #id only when it really changed.
  const patchCache = {};
  window.kktPatch = function (id, html) {
    const el = document.getElementById(id);
    if (!el) return null;
    if (patchCache[id] === html && el.innerHTML !== "") return null; // unchanged
    patchCache[id] = html;
    el.innerHTML = html;
    window.kktTickDirty = true; // the live counters must look for their elements again
    return el;
  };
  window.kktPatchReset = function () { Object.keys(patchCache).forEach((k) => delete patchCache[k]); window.kktTickDirty = true; };

  // Every animation duration of the game screens in one place. The reveal length
  // must match the server's (config.js): the server sends it as result.animMs.
  window.KKT_TIMING = {
    REVEAL_START_MS: 300,  // first vote arrow
    REVEAL_STEP_MS: 450,   // one more arrow every...
    DRUM_MS: 1600,         // drum roll, then the owner appears
    TOAST_MS: 2600,
  };

  window.kktNow = function () { return window.ServerClock ? ServerClock.now() : Date.now(); };

  // ---------- one shared Web Audio engine (visualiser + drum roll) ----------
  window.kktAudioCtx = function () {
    if (window._kktCtx) return window._kktCtx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    window._kktCtx = new AC();
    return window._kktCtx;
  };

  // ---------- synced audio ----------
  // A round is a list of "segments" {url, at, dur}: play `url` starting at server
  // time `at`. If we arrive late (reload, slow phone), we SEEK to the right
  // second so everybody hears the same thing at the same time.
  // On the host screen, the "viz" mode routes the preview through our own server
  // (/api/music/preview) so the visualiser can analyse it; if that fails we fall
  // back to the direct link automatically. If the direct link fails too, the
  // `failed` callback tells the game (the host then asks to skip the song).
  // The search "preview" button uses its OWN player, so it never cuts a round.
  window.kktAudio = (function () {
    const els = {};
    let timers = [], segs = [], useViz = false, current = null, onBlocked = null, onFailed = null, cache = [];
    function musicFlag() { document.body.classList.toggle("kkt-music", !!(current && !current.paused)); }
    function el(kind) {
      if (!els[kind]) {
        const a = new Audio();
        a.preload = "auto";
        if (kind === "viz") a.crossOrigin = "anonymous";
        if (window.Sound && Sound.attachExternal) Sound.attachExternal(a); else a.volume = 0.8;
        ["play", "pause", "ended"].forEach((ev) => a.addEventListener(ev, musicFlag));
        if (kind === "viz") a.addEventListener("error", () => { // proxy failed -> direct link
          if (!useViz || !a._src) return;
          useViz = false;
          const s = segs.find((x) => kktNow() < x.at + x.dur);
          if (s) play(s);
        });
        if (kind === "direct") a.addEventListener("error", () => { // the link itself is dead
          if (!a._src || !segs.length) return;
          if (onFailed) onFailed();
        });
        els[kind] = a;
      }
      return els[kind];
    }
    const srcOf = (url, viz) => (viz ? "/api/music/preview?u=" + encodeURIComponent(url) : url);
    function seekTo(a, seg) {
      const off = Math.max(0, (kktNow() - seg.at) / 1000);
      if (off < 0.25) return;
      try { a.currentTime = off; } catch (e) {}
    }
    function play(seg) {
      if (!seg || !seg.url) return;
      const viz = useViz;
      const a = el(viz ? "viz" : "direct");
      if (current && current !== a) { try { current.pause(); } catch (e) {} }
      if (els.search) { try { els.search.pause(); } catch (e) {} }
      current = a;
      const src = srcOf(seg.url, viz);
      if (a._src !== src) { a.src = src; a._src = src; }
      if (a.readyState >= 1) seekTo(a, seg);
      else a.addEventListener("loadedmetadata", () => seekTo(a, seg), { once: true });
      if (viz && window.kktViz) kktViz.attach(a);
      const p = a.play();
      if (p && p.catch) p.catch((err) => {
        if (err && err.name === "NotAllowedError") { if (onBlocked) onBlocked(); }
      });
    }
    function clear() { timers.forEach(clearTimeout); timers = []; }
    return {
      enableViz(on) { useViz = !!on; },
      // segs: [{url, at, dur}] ; blocked: browser refused autoplay ; failed: dead link
      schedule(list, blocked, failed) {
        clear(); segs = list || []; onBlocked = blocked || null; onFailed = failed || null;
        const now = kktNow();
        segs.forEach((seg, i) => {
          if (now >= seg.at + seg.dur) return;
          if (i === 0 || now >= seg.at) { // warm up the first one right away
            const a = el(useViz ? "viz" : "direct");
            const src = srcOf(seg.url, useViz);
            if (a._src !== src) { a.src = src; a._src = src; try { a.load(); } catch (e) {} }
          }
          if (now >= seg.at) play(seg);
          else timers.push(setTimeout(() => play(seg), seg.at - now));
        });
      },
      resume() { const s = segs.find((x) => kktNow() < x.at + x.dur) || segs[segs.length - 1]; if (s) play(s); },
      // simple preview (search results): its own player, plays from the start
      preview(url) {
        const a = el("search");
        if (a._src !== url) { a.src = url; a._src = url; }
        try { a.currentTime = 0; } catch (e) {}
        return a.play() || Promise.resolve();
      },
      stopPreview() { if (els.search) { try { els.search.pause(); } catch (e) {} } },
      // warm the browser cache with the next round's audio during the reveal
      preload(urls) {
        (urls || []).forEach((u) => {
          if (!u || cache.some((x) => x._u === u)) return;
          const x = new Audio(); x.preload = "auto"; x._u = u;
          x.src = srcOf(u, useViz);
          cache.push(x);
          if (cache.length > 4) { const old = cache.shift(); old.removeAttribute("src"); try { old.load(); } catch (e) {} }
        });
      },
      stop() { clear(); segs = []; onFailed = null; Object.values(els).forEach((a) => { try { a.pause(); } catch (e) {} }); musicFlag(); if (window.kktViz) kktViz.idle(); },
      get playing() { return !!(current && !current.paused); },
      get time() { return current ? current.currentTime : 0; }, // seconds into the excerpt
    };
  })();

  // ---------- real visualiser (host screen only) ----------
  // Web Audio "AnalyserNode" = reads the frequencies of what is playing; we use
  // them to drive the height of the neon equaliser bars in the background.
  // 30 updates per second is plenty for the eye; nothing runs while the tab is
  // hidden or when no music plays.
  window.kktViz = (function () {
    let analyser = null, data = null, attached = new WeakSet(), raf = 0, on = false, last = 0, bars = null;
    function loop(t) {
      raf = requestAnimationFrame(loop);
      if (!analyser || document.hidden || t - last < 33) return;
      last = t;
      analyser.getByteFrequencyData(data);
      if (!bars || !bars.length || !bars[0].isConnected) bars = document.querySelectorAll("#kkt-bg .kkt-eq span");
      if (!bars.length) return;
      const step = Math.max(1, Math.floor((data.length * 0.7) / bars.length));
      let sum = 0;
      bars.forEach((b, i) => {
        const v = data[Math.min(data.length - 1, i * step)] / 255;
        sum += v;
        b.style.transform = "scaleY(" + (0.08 + v * 0.95).toFixed(3) + ")";
      });
      document.getElementById("kkt-bg").classList.toggle("live", sum > 0.5);
    }
    return {
      attach(a) {
        try {
          const ctx = kktAudioCtx();
          if (!ctx) return;
          if (!analyser) {
            analyser = ctx.createAnalyser();
            analyser.fftSize = 128;
            data = new Uint8Array(analyser.frequencyBinCount);
            analyser.connect(ctx.destination);
          }
          if (ctx.state === "suspended") ctx.resume();
          if (!attached.has(a)) { ctx.createMediaElementSource(a).connect(analyser); attached.add(a); }
          if (!on) { on = true; raf = requestAnimationFrame(loop); }
        } catch (e) { /* no visualiser: the CSS animation keeps running */ }
      },
      idle() {
        on = false; cancelAnimationFrame(raf);
        const bg = document.getElementById("kkt-bg");
        if (bg) bg.classList.remove("live");
        document.querySelectorAll("#kkt-bg .kkt-eq span").forEach((b) => (b.style.transform = ""));
      },
    };
  })();

  // ---------- synthesised drum roll (no sound file needed) ----------
  window.kktDrum = function (ms) {
    try {
      const ctx = kktAudioCtx();
      if (!ctx) return;
      if (ctx.state === "suspended") ctx.resume();
      const master = (window.Sound && Sound.getMaster) ? Sound.getMaster() : 0.5;
      const noise = ctx.createBuffer(1, ctx.sampleRate * 0.12, ctx.sampleRate);
      const d = noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 3);
      const t0 = ctx.currentTime, dur = (ms || 1600) / 1000;
      const hit = (t, vol, rate) => {
        const src = ctx.createBufferSource(); src.buffer = noise; src.playbackRate.value = rate || 1;
        const g = ctx.createGain(); g.gain.value = vol * master;
        const f = ctx.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = 1800;
        src.connect(f); f.connect(g); g.connect(ctx.destination); src.start(t);
      };
      for (let t = 0; t < dur; t += 0.055) hit(t0 + t, 0.15 + 0.5 * (t / dur), 1);
      hit(t0 + dur, 0.9, 0.55); hit(t0 + dur + 0.02, 0.7, 0.35); // final crash
    } catch (e) {}
  };

  window.kktToast = function (msg) {
    let t = document.getElementById("kkt-toast");
    if (!t) { t = document.createElement("div"); t.id = "kkt-toast"; t.className = "kkt-toast"; document.body.appendChild(t); }
    t.textContent = msg; t.classList.add("show");
    clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove("show"), KKT_TIMING.TOAST_MS);
  };

  // Seconds left until `at` (server time), never negative.
  window.kktLeft = function (at) { return Math.max(0, Math.ceil((at - kktNow()) / 1000)); };

  // Animated neon background (an equalizer of bars behind everything). Built once.
  function ensureBg() {
    if (document.getElementById("kkt-bg")) return;
    const bg = document.createElement("div");
    bg.id = "kkt-bg";
    let bars = "";
    for (let i = 0; i < 28; i++) bars += `<span style="animation-delay:${(i % 7) * 0.13}s;--h:${30 + (i * 37) % 55}%"></span>`;
    bg.innerHTML = `<div class="kkt-bg-glow"></div><div class="kkt-eq">${bars}</div>`;
    document.body.appendChild(bg);
  }

  window.kktInjectStyles = function () {
    ensureBg();
    if (document.getElementById("kkt-styles")) return;
    // the styles live in their own file (cached by the browser between visits)
    const l = document.createElement("link");
    l.id = "kkt-styles"; l.rel = "stylesheet"; l.href = "/games/kietkoutsa/client/style.css";
    document.head.appendChild(l);
  };

  // ---------- small UI builders ----------
  // On/off switch row for the settings.
  window.kktSwitch = function (key, on, label, desc, disabled) {
    return `<div class="kkt-sw"><div><div class="lb">${label}</div>${desc ? `<div class="ds">${desc}</div>` : ""}</div>
      <button class="kkt-switch ${on ? "on" : ""}" data-set="${key}" data-val="${on ? "0" : "1"}" ${disabled ? "disabled" : ""} aria-pressed="${on}" aria-label="${kktEsc(label)}"></button></div>`;
  };
  // Choice among values for the settings.
  window.kktChoice = function (key, cur, options) { // options: [[value,label],...]
    return `<div class="kkt-toggle">` + options.map(([v, l]) =>
      `<button data-set="${key}" data-val="${kktEsc(v)}" class="${String(cur) === String(v) ? "on" : ""}">${l}</button>`).join("") + `</div>`;
  };

  // "My avatar" block: preview + a button that opens the site's avatar creator
  // (window.editMyAvatar is provided by the host / player page of the engine).
  window.kktMyAvatar = function (av) {
    return `<div class="kkt-row">${kktAvatar(av, 64)}<button type="button" class="kkt-btn sm ghost" data-edit-avatar>Modifier mon avatar</button></div>`;
  };

  // Vote buttons for ONE part of the round.
  //   o = { part, suspects:[ids], players:[{id,name,avatar}], me, choice, second,
  //         eliminated:[ids], trend:{id:n}, locked, slot }
  window.kktVoteButtons = function (o) {
    const byId = {};
    (o.players || []).forEach((p) => (byId[p.id] = p));
    return `<div class="kkt-votebtns">` + (o.suspects || []).filter((id) => id !== o.me && byId[id]).map((id) => {
      const p = byId[id];
      const out = (o.eliminated || []).includes(id);
      const cls = [o.choice === id ? "on" : "", o.second === id ? "second" : "", out ? "out" : ""].join(" ");
      const tr = o.trend && o.trend[id] ? `<span class="tr">${o.trend[id]}</span>` : "";
      return `<button class="kkt-vb ${cls}" data-vote="${kktEsc(id)}" data-part="${o.part || 0}" data-slot="${o.slot || "first"}"
        ${out || o.locked ? "disabled" : ""}>${kktAvatar(p.avatar, 28)} ${kktEsc(p.name)}${p.ghost ? " 👻" : ""}${tr}</button>`;
    }).join("") + `</div>`;
  };

  // The full voting panel used by phones AND by the host's secret panel.
  window.kktVotePanel = function (s, you, me) {
    const v = you.vote || { p: [], second: null, bet: 1, locked: false };
    const locked = !!v.locked;
    let h = "";
    if (you.isOwner) {
      const which = s.parts.length > 1 ? " (extrait " + you.ownedParts.map((i) => i + 1).join(" + ") + ")" : "";
      h += `<div class="kkt-banner">🤫 C'est TON son${which}. Vote pour de faux pour ne pas te trahir !</div>`;
    }
    if (you.doubleOn) h += `<div class="kkt-banner gold">✖️2 Joker double actif sur cette manche</div>`;
    s.parts.forEach((_, i) => {
      h += `<div class="kkt-block">${s.parts.length > 1 ? `<h4>Extrait ${i + 1} : qui l'a mis ?</h4>` : `<h4>Qui a mis ce son ?</h4>`}` +
        kktVoteButtons({ part: i, suspects: s.suspects[i], players: s.players, me, choice: v.p[i], second: i === 0 ? v.second : null,
          eliminated: (s.eliminated || [])[i], trend: s.trend ? s.trend[i] : null, locked }) + `</div>`;
    });
    if (s.duo) {
      h += `<div class="kkt-block"><h4>2e choix (1 point si c'est lui)</h4>` +
        kktVoteButtons({ part: 0, slot: "second", suspects: s.suspects[0].filter((x) => x !== v.p[0]), players: s.players, me,
          choice: null, second: v.second, eliminated: (s.eliminated || [])[0], locked }) + `</div>`;
    }
    if (s.settings.mode === "truebluff") {
      h += `<div class="kkt-block"><h4>Ce son, c'est…</h4><div class="kkt-toggle">
        <button data-nature="sincere" class="${v.nature === "sincere" ? "on" : ""}" ${locked ? "disabled" : ""}>💖 Un vrai coup de cœur</button>
        <button data-nature="bluff" class="${v.nature === "bluff" ? "on" : ""}" ${locked ? "disabled" : ""}>🃏 Un bluff</button></div></div>`;
    }
    if (s.settings.bets) {
      h += `<div class="kkt-block"><h4>Ta mise</h4><div class="kkt-bets">` + [1, 2, 3].map((b) =>
        `<button data-bet="${b}" class="${(v.bet || 1) === b ? "on" : ""}" ${locked ? "disabled" : ""}>${b}🪙</button>`).join("") +
        `</div><div class="kkt-small">Juste = points × mise. Faux = tu perds mise − 1.</div></div>`;
    }
    const complete = s.parts.every((_, i) => v.p[i]);
    h += `<div class="kkt-row kkt-center" style="margin-top:8px">` + (locked
      ? `<span class="kkt-voted">🔒 Vote verrouillé (+1 si juste)</span>`
      : `<button class="kkt-btn ghost sm" data-lock ${complete ? "" : "disabled"}>🔒 Je suis sûr (+1)</button>`) + `</div>`;
    if (you.jokers && s.settings.jokers) {
      const has = (j) => you.jokers.includes(j);
      h += `<div class="kkt-block"><h4>Jokers (1 fois par partie)</h4><div class="kkt-jokers">
        <button class="kkt-joker" data-joker="double" ${has("double") && !you.doubleOn ? "" : "disabled"}>✖️2 Double</button>
        <button class="kkt-joker" data-joker="spy" ${has("spy") ? "" : "disabled"}>🕵️ Espion</button>
        <button class="kkt-joker" data-joker="scramble" ${has("scramble") && !s.scrambled && !s.settings.blind ? "" : "disabled"}>🌀 Brouiller</button></div>
        <div id="kkt-spy-pick"></div></div>`;
    }
    return h;
  };
  // Hooks the buttons of kktVotePanel to actions.
  window.kktWireVotePanel = function (root, s, you, me, send) {
    root.querySelectorAll("[data-vote]").forEach((b) => (b.onclick = () =>
      send("vote", { target: b.getAttribute("data-vote"), part: +b.getAttribute("data-part"), slot: b.getAttribute("data-slot") })));
    root.querySelectorAll("[data-nature]").forEach((b) => (b.onclick = () => send("setNature", { nature: b.getAttribute("data-nature") })));
    root.querySelectorAll("[data-bet]").forEach((b) => (b.onclick = () => send("setBet", { bet: +b.getAttribute("data-bet") })));
    const lk = root.querySelector("[data-lock]"); if (lk) lk.onclick = () => send("lock");
    root.querySelectorAll("[data-joker]").forEach((b) => (b.onclick = () => {
      const kind = b.getAttribute("data-joker");
      if (kind !== "spy") return send("joker", { kind });
      const box = root.querySelector("#kkt-spy-pick");
      if (!box) return;
      box.innerHTML = `<p class="kkt-small">Espionner le vote de qui ?</p><div class="kkt-votebtns">` +
        s.players.filter((p) => p.id !== me && !p.ghost).map((p) => `<button class="kkt-vb" data-spy="${kktEsc(p.id)}">${kktAvatar(p.avatar, 24)} ${kktEsc(p.name)}</button>`).join("") + `</div>`;
      box.querySelectorAll("[data-spy]").forEach((x) => (x.onclick = () => { send("joker", { kind: "spy", target: x.getAttribute("data-spy") }); box.innerHTML = ""; }));
    }));
  };

  // Blind-test guess inputs (kept OUT of patched blocks so typing is never lost).
  window.kktGuessBox = function (multi) {
    return `<div class="kkt-block" id="kkt-guess"><h4>Blind test${multi ? " (extrait 1)" : ""} : trouve le titre / l'artiste (+1 chacun)</h4>
      <div class="kkt-row kkt-center"><input class="kkt-input" id="kkt-g-title" placeholder="Titre" autocomplete="off"/>
      <input class="kkt-input" id="kkt-g-artist" placeholder="Artiste" autocomplete="off"/>
      <button class="kkt-btn sm" id="kkt-g-send">Valider</button></div><p class="kkt-small" id="kkt-g-res"></p></div>`;
  };
  window.kktWireGuess = function (send) {
    const b = document.getElementById("kkt-g-send");
    if (!b) return;
    const go = () => send("guess", { title: document.getElementById("kkt-g-title").value, artist: document.getElementById("kkt-g-artist").value });
    b.onclick = go;
    ["kkt-g-title", "kkt-g-artist"].forEach((id) => { const i = document.getElementById(id); if (i) i.onkeydown = (e) => { if (e.key === "Enter") go(); }; });
  };
  window.kktShowGuess = function (g) {
    const el = document.getElementById("kkt-g-res");
    if (!el || !g) return;
    el.textContent = (g.title ? "✅ Titre trouvé " : "Titre : pas encore ") + " · " + (g.artist ? "✅ Artiste trouvé" : "Artiste : pas encore");
    ["title", "artist"].forEach((k) => { const i = document.getElementById("kkt-g-" + k); if (i && g[k]) i.disabled = true; });
  };

  // Leaderboard. opts: { me, key:"score"|"det"|"cam"|"total", gains:{id:n} }
  window.kktLeaderboard = function (lead, me, opts) {
    opts = opts || {};
    const key = opts.key || "score";
    const list = lead.slice().sort((a, b) => (b[key] || 0) - (a[key] || 0));
    return `<div class="kkt-lead">` + list.map((l, i) => {
      const g = opts.gains && opts.gains[l.id];
      const gain = g ? `<span class="gain ${g < 0 ? "neg" : ""}">${g > 0 ? "+" : ""}${g}</span>` : "";
      return `<div class="kkt-le ${l.id === me ? "top" : ""}"><span class="rk">${i + 1}</span>${kktAvatar(l.avatar, 28)}
        <span class="nm">${kktEsc(l.name)}${l.id === me ? " (toi)" : ""}${l.left ? " <span class='ex'>(parti)</span>" : ""}${l.late ? " <span class='ex'>(arrivé en cours)</span>" : ""}</span>
        ${gain}<span class="sc">${l[key] || 0}</span></div>`;
    }).join("") + `</div>`;
  };

  // Reveal animation: votes appear one by one as "voter -> suspect", then the owner.
  // Calls done() at the end. Returns the total duration in ms.
  window.kktRevealArrows = function (el, result, startDelay, names) {
    names = names || {};
    if (!el) return 0;
    const parts = result.parts;
    el.innerHTML = result.votes.map((v) => {
      const picks = v.picks.map((pid, i) => {
        if (!pid) return "";
        const owner = parts[i] && parts[i].ownerId;
        const name = names[pid] || (parts.find((p) => p.ownerId === pid) || {}).ownerName || "?";
        return `<span>${parts.length > 1 ? "#" + (i + 1) + " " : ""}→ ${kktEsc(name)} ${pid === owner ? "✅" : "❌"}</span>`;
      }).join(" ");
      const good = v.picks.some((pid, i) => pid && parts[i] && pid === parts[i].ownerId);
      const extra = [v.bet > 1 ? v.bet + "🪙" : "", v.locked ? "🔒" : "", v.second ? "2e : " + kktEsc(names[v.second] || "?") : ""].filter(Boolean).join(" ");
      return `<div class="kkt-arrow ${good ? "good" : "bad"}">${kktAvatar(v.avatar, 26)} ${kktEsc(v.name)} ${picks} <span class="g">${extra}</span></div>`;
    }).join("") || `<p class="kkt-sub">Personne n'a voté…</p>`;
    const rows = el.querySelectorAll(".kkt-arrow");
    const step = KKT_TIMING.REVEAL_STEP_MS;
    rows.forEach((r, i) => setTimeout(() => r.classList.add("show"), (startDelay || 0) + i * step));
    return (startDelay || 0) + rows.length * step;
  };

  // ---------- search + suggestions + my picks (phones and host secret panel) ----------
  // ctx = { send, getState: () => state }   ; .update(you, state) patches it.
  const HISTORY_KEY = "gn_kkt_history";
  function history() { try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]"); } catch (e) { return []; } }
  function remember(t) {
    try {
      const h = history().filter((x) => x.id !== t.id);
      h.unshift({ id: t.id, title: t.title, artist: t.artist, cover: t.cover, preview: t.preview, link: t.link, explicit: t.explicit, source: t.source });
      localStorage.setItem(HISTORY_KEY, JSON.stringify(h.slice(0, 12)));
    } catch (e) {}
  }
  const GENRES = [["🔥 Tendances", "@charts"], ["🕘 Mes derniers", "@history"], ["Rap FR", "rap francais"], ["Pop", "pop hits"],
    ["Zouk", "zouk"], ["Maloya / Séga", "maloya"], ["Anime", "anime opening"], ["Années 2000", "hits 2000"], ["Rock", "rock classics"], ["Electro", "electro"]];

  window.KktSearch = function (el, send) {
    let timer = null, seq = 0, list = [], you = { subs: [], perPlayer: 1 }, st = null, mineSig = "";
    el.innerHTML = `<input class="kkt-search" placeholder="Rechercher un titre, un artiste…" autocomplete="off"/>
      <div class="kkt-chips">${GENRES.map(([l, q]) => `<button class="kkt-chip" data-q="${kktEsc(q)}">${l}</button>`).join("")}</div>
      <div class="kkt-results"></div>
      <h3 class="kkt-h2">Mes morceaux <span class="kkt-pickc"></span></h3>
      <div class="kkt-mine"></div>`;
    const q = el.querySelector(".kkt-search");
    const results = el.querySelector(".kkt-results");
    const mine = el.querySelector(".kkt-mine");
    const pickc = el.querySelector(".kkt-pickc");
    const full = () => you.subs.length >= (you.perPlayer || 1);
    const noExplicit = () => !!(st && st.settings && st.settings.noExplicit);

    q.addEventListener("input", () => {
      const v = q.value.trim();
      clearTimeout(timer);
      if (!v) { results.innerHTML = ""; return; }
      timer = setTimeout(() => doSearch(v), 350);
    });
    el.querySelectorAll("[data-q]").forEach((b) => (b.onclick = () => {
      el.querySelectorAll("[data-q]").forEach((x) => x.classList.toggle("on", x === b));
      const v = b.getAttribute("data-q");
      if (v === "@history") return show(history(), "Pas encore d'historique sur cet appareil.");
      if (v === "@charts") return load("/api/music/charts");
      q.value = ""; doSearch(v);
    }));

    let ctl = null;
    const memo = new Map(); // searches already done on this phone (5 min)
    function load(url) {
      const s = ++seq;
      if (ctl) ctl.abort(); // cancel the previous request for real
      const hit = memo.get(url);
      if (hit && Date.now() - hit.t < 300000) return show(hit.d.results || [], hit.d.error || "Aucun résultat.");
      ctl = new AbortController();
      results.innerHTML = `<p class="kkt-sub">Chargement…</p>`;
      fetch(url, { signal: ctl.signal }).then((r) => r.json()).then((d) => {
        if (!d.error) memo.set(url, { d, t: Date.now() });
        if (s === seq) show(d.results || [], d.error || "Aucun résultat.");
      }).catch((e) => { if (e.name !== "AbortError" && s === seq) results.innerHTML = `<p class="kkt-sub">Recherche indisponible.</p>`; });
    }
    function doSearch(query) { load("/api/music/search?q=" + encodeURIComponent(query)); }
    function show(l, emptyMsg) {
      list = l.filter((t) => !(noExplicit() && t.explicit));
      results.innerHTML = list.map((t, i) =>
        `<div class="kkt-res"><img src="${kktEsc(t.coverSmall || t.cover)}" loading="lazy" alt="" onerror="this.style.visibility='hidden'"/>
          <div class="info"><div class="t">${kktEsc(t.title)}${t.explicit ? '<span class="kkt-e">E</span>' : ""}</div><div class="a">${kktEsc(t.artist)}</div></div>
          <button class="kkt-mini" data-prev="${i}" aria-label="Écouter">▶</button>
          <button class="kkt-mini kkt-pick" data-pick="${i}" ${full() ? "disabled" : ""} aria-label="Choisir">+</button></div>`).join("")
        || `<p class="kkt-sub">${kktEsc(emptyMsg || "Aucun résultat.")}</p>`;
      results.querySelectorAll("[data-prev]").forEach((b) => (b.onclick = () => kktAudio.preview(list[+b.getAttribute("data-prev")].preview).catch(() => {})));
      results.querySelectorAll("[data-pick]").forEach((b) => (b.onclick = () => {
        const t = list[+b.getAttribute("data-pick")];
        kktAudio.stopPreview(); remember(t); send("submitTrack", { track: t });
      }));
    }

    function update(y, state) {
      you = y || you; st = state || st;
      const max = you.perPlayer || 1, n = you.subs.length;
      pickc.textContent = n >= max ? `(${max}/${max} ✓)` : `(${n}/${max})`;
      const tb = st && st.settings && st.settings.mode === "truebluff";
      // rebuild "my picks" ONLY when the list itself changed (keeps typing in notes)
      const sig = JSON.stringify(you.subs.map((t) => [t.id, t.nature, t.note])) + tb;
      if (sig !== mineSig) {
        const focused = document.activeElement && document.activeElement.getAttribute("data-note");
        mineSig = sig;
        mine.innerHTML = you.subs.length ? you.subs.map((t) =>
          `<div class="kkt-res"><img src="${kktEsc(t.cover)}" alt="" onerror="this.style.visibility='hidden'"/>
            <div class="info"><div class="t">${kktEsc(t.title)}</div><div class="a">${kktEsc(t.artist)}</div></div>
            <button class="kkt-mini" data-prevm="${kktEsc(t.preview)}" aria-label="Écouter">▶</button>
            <button class="kkt-mini" data-rm="${kktEsc(t.id)}" aria-label="Retirer">✕</button>
            ${tb ? `<div class="kkt-toggle" style="flex:1 1 100%"><button data-nat="sincere" data-id="${kktEsc(t.id)}" class="${t.nature === "sincere" ? "on" : ""}">💖 Sincère</button>
              <button data-nat="bluff" data-id="${kktEsc(t.id)}" class="${t.nature === "bluff" ? "on" : ""}">🃏 Bluff</button></div>` : ""}
            <div class="note"><input class="kkt-input" data-note="${kktEsc(t.id)}" maxlength="120" placeholder="Message caché (révélé à la fin de la manche)" value="${kktEsc(t.note || "")}"/></div></div>`).join("")
          : `<p class="kkt-sub">Rien encore.</p>`;
        mine.querySelectorAll("[data-prevm]").forEach((b) => (b.onclick = () => kktAudio.preview(b.getAttribute("data-prevm")).catch(() => {})));
        mine.querySelectorAll("[data-rm]").forEach((b) => (b.onclick = () => send("removeTrack", { trackId: b.getAttribute("data-rm") })));
        mine.querySelectorAll("[data-nat]").forEach((b) => (b.onclick = () => send("setNature", { trackId: b.getAttribute("data-id"), nature: b.getAttribute("data-nat") })));
        mine.querySelectorAll("[data-note]").forEach((inp) => {
          let h = null;
          const push = () => send("setNote", { trackId: inp.getAttribute("data-note"), note: inp.value });
          inp.oninput = () => { clearTimeout(h); h = setTimeout(push, 600); };
          inp.onblur = () => { clearTimeout(h); push(); };
          if (focused && focused === inp.getAttribute("data-note")) { inp.focus(); const L = inp.value.length; try { inp.setSelectionRange(L, L); } catch (e) {} }
        });
      }
      results.querySelectorAll("[data-pick]").forEach((b) => (b.disabled = full()));
    }
    return { update };
  };

  // Text version of the evening's playlist (to copy / share).
  window.kktPlaylistText = function (tracks) {
    return tracks.map((t, i) => `${i + 1}. ${t.title} — ${t.artist} (mis par ${t.ownerName})${t.link ? " " + t.link : ""}`).join("\n");
  };
  window.kktCopy = function (text) {
    const done = () => kktToast("Copié dans le presse-papier ✅");
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done).catch(fallback);
    else fallback();
    function fallback() {
      const ta = document.createElement("textarea"); ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); done(); } catch (e) { kktToast("Copie impossible"); }
      ta.remove();
    }
  };

  // Live counters, driven by data-attributes (server times), refreshed 4x/second:
  //   data-countdown="<ts>"           -> "12s" (and .low under 5s)
  //   data-bar-start / data-bar-end   -> fills an <i> progress bar
  //   data-prestart="<ts>"            -> "Ça commence dans 2s" (hidden after)
  //   data-seg-start / data-seg-len / data-seg="i" -> highlights the playing excerpt
  let tickEls = null;
  window.kktTick = function () {
    // elements are looked up only when the screen changed, not 4 times a second
    if (!tickEls || window.kktTickDirty) {
      window.kktTickDirty = false;
      tickEls = {
        count: document.querySelectorAll("[data-countdown]"), bars: document.querySelectorAll("[data-bar-end]"),
        pre: document.querySelectorAll("[data-prestart]"), segs: document.querySelectorAll("[data-seg-start]"),
      };
    }
    if (!tickEls.count.length && !tickEls.bars.length && !tickEls.pre.length && !tickEls.segs.length) return;
    const now = kktNow();
    tickEls.count.forEach((el) => {
      const left = kktLeft(+el.getAttribute("data-countdown"));
      const txt = left + "s";
      if (el.textContent !== txt) el.textContent = txt;
      el.classList.toggle("low", left <= 5);
    });
    tickEls.bars.forEach((el) => {
      const a = +el.getAttribute("data-bar-start"), b = +el.getAttribute("data-bar-end");
      const pct = b > a ? Math.max(0, Math.min(1, (b - now) / (b - a))) : 0;
      const i = el.querySelector("i"); if (i) i.style.width = (pct * 100).toFixed(1) + "%";
    });
    tickEls.pre.forEach((el) => {
      const left = kktLeft(+el.getAttribute("data-prestart"));
      el.hidden = left <= 0;
      if (left > 0) el.textContent = "Ça commence dans " + left + " s…";
    });
    tickEls.segs.forEach((box) => {
      const st = +box.getAttribute("data-seg-start"), len = +box.getAttribute("data-seg-len");
      const cur = now < st ? 0 : Math.floor((now - st) / len);
      box.querySelectorAll("[data-seg]").forEach((x) => x.classList.toggle("on", +x.getAttribute("data-seg") === cur));
    });
  };
  // Builds the audio segments of a round from its public state.
  // Classic: one segment. Mashup: two halves, one after the other.
  window.kktSegments = function (s) {
    const n = s.parts.length;
    const seg = n > 1 ? Math.floor(s.roundMs / n) : s.roundMs + 15000;
    return s.parts.map((p, i) => ({ url: p.preview, at: s.startsAt + i * Math.floor(s.roundMs / n), dur: seg }));
  };
})();
