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

  window.kktAvatar = function (av, size) {
    const bg = (av && av.color) || "#9b5cff";
    const em = (av && av.emoji) || "🎵";
    size = size || 48;
    return `<span class="kkt-av" style="width:${size}px;height:${size}px;background:${kktEsc(bg)};font-size:${Math.round(size * 0.52)}px">${kktEsc(em)}</span>`;
  };

  // Replace the content of #id only when it really changed.
  const patchCache = {};
  window.kktPatch = function (id, html) {
    const el = document.getElementById(id);
    if (!el) return null;
    if (patchCache[id] === html && el.innerHTML !== "") return null; // unchanged
    patchCache[id] = html;
    el.innerHTML = html;
    return el;
  };
  window.kktPatchReset = function () { Object.keys(patchCache).forEach((k) => delete patchCache[k]); };

  window.kktNow = function () { return window.ServerClock ? ServerClock.now() : Date.now(); };

  // ---------- synced audio ----------
  // A round is a list of "segments" {url, at, dur}: play `url` starting at server
  // time `at`. If we arrive late (reload, slow phone), we SEEK to the right
  // second so everybody hears the same thing at the same time.
  // On the host screen, the "viz" mode routes the preview through our own server
  // (/api/music/preview) so the visualiser can analyse it; if that fails we fall
  // back to the direct link automatically.
  window.kktAudio = (function () {
    const els = {};
    let timers = [], segs = [], useViz = false, current = null, onBlocked = null, cache = [];
    function el(kind) {
      if (!els[kind]) {
        const a = new Audio();
        a.preload = "auto";
        if (kind === "viz") a.crossOrigin = "anonymous";
        if (window.Sound && Sound.attachExternal) Sound.attachExternal(a); else a.volume = 0.8;
        if (kind === "viz") a.addEventListener("error", () => { // proxy failed -> direct link
          if (!useViz) return;
          useViz = false;
          const s = segs.find((x) => kktNow() < x.at + x.dur);
          if (s) play(s);
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
      // segs: [{url, at, dur}] ; blocked: called if the browser refuses autoplay
      schedule(list, blocked) {
        clear(); segs = list || []; onBlocked = blocked || null;
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
      // simple preview (search results): plays from the start, no sync
      preview(url) {
        clear(); segs = [];
        const a = el("direct");
        if (current && current !== a) { try { current.pause(); } catch (e) {} }
        current = a;
        if (a._src !== url) { a.src = url; a._src = url; }
        try { a.currentTime = 0; } catch (e) {}
        return a.play() || Promise.resolve();
      },
      // warm the browser cache with the next round's audio during the reveal
      preload(urls) {
        (urls || []).forEach((u) => {
          if (!u || cache.some((x) => x._u === u)) return;
          const x = new Audio(); x.preload = "auto"; x._u = u;
          x.src = srcOf(u, useViz);
          cache.push(x);
          if (cache.length > 4) cache.shift();
        });
      },
      stop() { clear(); segs = []; Object.values(els).forEach((a) => { try { a.pause(); } catch (e) {} }); if (window.kktViz) kktViz.idle(); },
      get playing() { return !!(current && !current.paused); },
    };
  })();

  // ---------- real visualiser (host screen only) ----------
  // Web Audio "AnalyserNode" = reads the frequencies of what is playing; we use
  // them to drive the height of the neon equaliser bars in the background.
  window.kktViz = (function () {
    let ctx = null, analyser = null, data = null, attached = new WeakSet(), raf = 0, on = false;
    function loop() {
      raf = requestAnimationFrame(loop);
      if (!analyser) return;
      analyser.getByteFrequencyData(data);
      const bars = document.querySelectorAll("#kkt-bg .kkt-eq span");
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
          if (!ctx) {
            const AC = window.AudioContext || window.webkitAudioContext;
            if (!AC) return;
            ctx = new AC();
            analyser = ctx.createAnalyser();
            analyser.fftSize = 128;
            data = new Uint8Array(analyser.frequencyBinCount);
            analyser.connect(ctx.destination);
          }
          if (ctx.state === "suspended") ctx.resume();
          if (!attached.has(a)) { ctx.createMediaElementSource(a).connect(analyser); attached.add(a); }
          if (!on) { on = true; loop(); }
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
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const ctx = window._kktDrumCtx = window._kktDrumCtx || new AC();
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
    clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove("show"), 2600);
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
    const st = document.createElement("style");
    st.id = "kkt-styles";
    st.textContent = `
    :root{--kkt-mag:#ff2fb0;--kkt-cyan:#22e0ff;--kkt-pur:#9b5cff;--kkt-ink:#07060f;--kkt-gold:#ffd54a;}
    body.room{background:transparent;}
    #kkt-bg{position:fixed;inset:0;z-index:-1;pointer-events:none;overflow:hidden;background:
      radial-gradient(circle at 20% 10%, #2a0b45 0%, rgba(42,11,69,0) 45%),
      radial-gradient(circle at 85% 20%, #06303f 0%, rgba(6,48,63,0) 40%),
      linear-gradient(160deg,#0a0618 0%,#07060f 60%,#0b0520 100%);}
    .kkt-bg-glow{position:absolute;inset:-20%;background:
      radial-gradient(circle at 50% 120%, rgba(255,47,176,.22), rgba(255,47,176,0) 55%),
      radial-gradient(circle at 20% 120%, rgba(34,224,255,.18), rgba(34,224,255,0) 50%);
      animation:kkt-hue 14s linear infinite;}
    @keyframes kkt-hue{0%{filter:hue-rotate(0)}100%{filter:hue-rotate(360deg)}}
    .kkt-eq{position:absolute;left:0;right:0;bottom:0;height:34vh;display:flex;gap:6px;
      align-items:flex-end;justify-content:center;opacity:.5;padding:0 2vw;}
    .kkt-eq span{flex:1;max-width:3.2%;height:var(--h);border-radius:6px 6px 0 0;
      background:linear-gradient(180deg,var(--kkt-cyan),var(--kkt-mag));
      transform-origin:bottom;animation:kkt-eq 1.1s ease-in-out infinite alternate;
      box-shadow:0 0 12px rgba(255,47,176,.5);}
    #kkt-bg.live .kkt-eq span{animation:none;height:100%;transition:transform .08s linear;}
    #kkt-bg.live .kkt-eq{opacity:.62;}
    @keyframes kkt-eq{0%{transform:scaleY(.25)}100%{transform:scaleY(1)}}
    @media (prefers-reduced-motion: reduce){.kkt-eq span,.kkt-bg-glow{animation:none}}

    /* The game takes the WHOLE screen as its own scrolling layer. (The old
       "width:100vw" trick made phones scroll sideways.) Fixed buttons of the page
       (Quitter, Feedback, volume) stay above it. */
    .kkt-stage{position:fixed;inset:0;z-index:1;overflow-y:auto;overflow-x:hidden;-webkit-overflow-scrolling:touch;
      padding:56px 16px 90px;color:#f3e9ff;box-sizing:border-box;}
    .kkt-wrap{max-width:900px;margin:0 auto;}
    .kkt-wide{max-width:1180px;}
    .kkt-eyebrow{letter-spacing:.22em;text-transform:uppercase;font-size:.72rem;color:var(--kkt-cyan);margin:0 0 4px;}
    .kkt-title{font-family:"Bebas Neue","Arial Narrow",sans-serif;font-size:2.6rem;letter-spacing:.03em;margin:.05em 0 .3em;
      text-shadow:0 0 18px rgba(255,47,176,.55),0 0 4px rgba(34,224,255,.4);}
    .kkt-h2{font-family:"Bebas Neue","Arial Narrow",sans-serif;font-size:1.5rem;letter-spacing:.04em;margin:.6em 0 .3em;}
    .kkt-sub{opacity:.88;margin:.2em 0;}
    .kkt-small{font-size:.82rem;opacity:.75;}
    .kkt-av{display:inline-flex;align-items:center;justify-content:center;border-radius:50%;
      border:2px solid rgba(255,255,255,.85);box-shadow:0 0 12px rgba(155,92,255,.6);flex:0 0 auto;line-height:1;}
    .kkt-btn{font-family:inherit;font-size:1rem;font-weight:800;color:#0a0414;border:none;cursor:pointer;
      padding:12px 22px;border-radius:999px;background:linear-gradient(135deg,var(--kkt-cyan),var(--kkt-mag));
      box-shadow:0 0 18px rgba(255,47,176,.5);}
    .kkt-btn:disabled{opacity:.4;cursor:default;box-shadow:none;}
    .kkt-btn.ghost{background:rgba(255,255,255,.1);color:#fff;box-shadow:none;border:1px solid rgba(255,255,255,.25);}
    .kkt-btn.sm{padding:8px 14px;font-size:.88rem;}
    .kkt-row{display:flex;gap:10px;align-items:center;flex-wrap:wrap;}
    .kkt-center{justify-content:center;text-align:center;}
    .kkt-card{background:rgba(18,10,36,.82);border:1px solid rgba(155,92,255,.3);border-radius:16px;padding:14px 16px;margin:10px 0;
      box-shadow:0 0 24px rgba(34,224,255,.08) inset;}
    .kkt-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:10px;}
    .kkt-stepper{display:inline-flex;align-items:center;gap:16px;font-weight:800;font-size:1.3rem;}
    .kkt-stepper button{width:42px;height:42px;border-radius:12px;border:none;cursor:pointer;font-size:1.4rem;font-weight:800;
      background:rgba(155,92,255,.25);color:#fff;}
    .kkt-toggle{display:inline-flex;flex-wrap:wrap;border-radius:14px;overflow:hidden;border:1px solid rgba(255,255,255,.2);}
    .kkt-toggle button{padding:9px 14px;border:none;cursor:pointer;background:transparent;color:#f3e9ff;font-weight:700;font:inherit;}
    .kkt-toggle button.on{background:linear-gradient(135deg,var(--kkt-cyan),var(--kkt-mag));color:#0a0414;}
    .kkt-sw{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 0;border-bottom:1px dashed rgba(255,255,255,.1);}
    .kkt-sw:last-child{border-bottom:none;}
    .kkt-sw .lb{font-weight:700;} .kkt-sw .ds{font-size:.78rem;opacity:.7;}
    .kkt-switch{position:relative;width:52px;height:30px;border-radius:999px;border:none;cursor:pointer;flex:0 0 auto;
      background:rgba(255,255,255,.18);transition:background .2s;}
    .kkt-switch::after{content:"";position:absolute;top:3px;left:3px;width:24px;height:24px;border-radius:50%;background:#fff;transition:left .2s;}
    .kkt-switch.on{background:linear-gradient(135deg,var(--kkt-cyan),var(--kkt-mag));} .kkt-switch.on::after{left:25px;}
    .kkt-modes{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;}
    .kkt-mode{text-align:left;cursor:pointer;border-radius:14px;padding:12px;border:2px solid rgba(255,255,255,.12);
      background:rgba(255,255,255,.05);color:#f3e9ff;font:inherit;position:relative;}
    .kkt-mode.on{border-color:var(--kkt-mag);box-shadow:0 0 18px rgba(255,47,176,.4);background:rgba(255,47,176,.12);}
    .kkt-mode .e{font-size:1.6rem;} .kkt-mode .n{font-weight:800;display:block;margin:2px 0;} .kkt-mode .r{font-size:.78rem;opacity:.8;}
    .kkt-mode .tally{position:absolute;top:8px;right:10px;background:var(--kkt-cyan);color:#000;border-radius:999px;padding:1px 8px;font-weight:800;font-size:.8rem;}
    .kkt-players{display:flex;flex-wrap:wrap;gap:10px;margin:12px 0;}
    .kkt-players.center{justify-content:center;}
    .kkt-pl{display:flex;align-items:center;gap:10px;background:rgba(18,10,36,.82);border-radius:12px;padding:8px 12px;min-width:140px;border:1px solid rgba(255,255,255,.08);transition:transform .2s,border-color .2s;}
    .kkt-pl.ok{border-color:var(--kkt-cyan);box-shadow:0 0 12px rgba(34,224,255,.3);}
    .kkt-pl.off{opacity:.45;} .kkt-pl.me{border-color:var(--kkt-mag);}
    .kkt-pl.voted{border-color:var(--kkt-cyan);animation:kkt-pulse .5s ease;}
    @keyframes kkt-pulse{0%{transform:scale(1)}50%{transform:scale(1.08)}100%{transform:scale(1)}}
    .kkt-pl .nm{font-weight:700;} .kkt-pl .mt{font-size:.8rem;opacity:.85;}
    .kkt-voted{color:var(--kkt-cyan);font-weight:800;}
    .kkt-search{width:100%;box-sizing:border-box;font:inherit;font-size:1.05rem;padding:12px 14px;border-radius:12px;
      border:1px solid rgba(34,224,255,.4);background:rgba(255,255,255,.08);color:inherit;}
    .kkt-input{font:inherit;padding:9px 12px;border-radius:10px;border:1px solid rgba(255,255,255,.25);background:rgba(255,255,255,.08);color:inherit;}
    .kkt-chips{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0;}
    .kkt-chip{font:inherit;font-size:.82rem;cursor:pointer;border-radius:999px;padding:6px 11px;border:1px solid rgba(255,255,255,.2);background:rgba(255,255,255,.06);color:#f3e9ff;}
    .kkt-chip.on{background:var(--kkt-cyan);color:#000;}
    .kkt-results{display:flex;flex-direction:column;gap:8px;margin-top:10px;}
    .kkt-res{display:flex;align-items:center;gap:10px;background:rgba(18,10,36,.86);border-radius:12px;padding:8px;border:1px solid rgba(255,255,255,.07);}
    .kkt-res img{width:52px;height:52px;border-radius:8px;object-fit:cover;flex:0 0 auto;background:#241543;}
    .kkt-res .info{flex:1;min-width:0;}
    .kkt-res .t{font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
    .kkt-res .a{font-size:.85rem;opacity:.8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
    .kkt-e{display:inline-block;font-size:.65rem;font-weight:800;background:#ddd;color:#000;border-radius:3px;padding:0 4px;margin-left:4px;vertical-align:middle;}
    .kkt-mini{width:42px;height:42px;border-radius:12px;border:none;cursor:pointer;font-size:1.1rem;
      background:rgba(255,255,255,.14);color:#fff;flex:0 0 auto;}
    .kkt-pick{background:linear-gradient(135deg,var(--kkt-cyan),var(--kkt-mag));color:#0a0414;}
    .kkt-mine{display:flex;flex-direction:column;gap:6px;margin-top:12px;}
    .kkt-mine .kkt-res{border-color:rgba(255,47,176,.4);flex-wrap:wrap;}
    .kkt-mine .note{flex:1 1 100%;display:flex;gap:6px;}
    .kkt-mine .note input{flex:1;min-width:0;}
    .kkt-now{display:flex;flex-direction:column;align-items:center;gap:10px;margin:8px 0 16px;}
    .kkt-cover{width:min(58vw,250px);height:min(58vw,250px);border-radius:18px;object-fit:cover;
      background:#241543;box-shadow:0 0 44px rgba(255,47,176,.5),0 0 18px rgba(34,224,255,.4);}
    .kkt-cover.big{width:min(40vw,340px);height:min(40vw,340px);}
    .kkt-vinyl{width:min(58vw,250px);height:min(58vw,250px);border-radius:50%;
      background:repeating-radial-gradient(circle,#111 0 3px,#1c1c1c 3px 5px);position:relative;
      box-shadow:0 0 44px rgba(255,47,176,.5);animation:kkt-spin 3s linear infinite;display:flex;align-items:center;justify-content:center;}
    .kkt-vinyl::after{content:"?";width:38%;height:38%;border-radius:50%;background:linear-gradient(135deg,var(--kkt-cyan),var(--kkt-mag));
      display:flex;align-items:center;justify-content:center;font:800 2.4rem "Bebas Neue",sans-serif;color:#000;}
    .kkt-vinyl.big{width:min(40vw,340px);height:min(40vw,340px);}
    @keyframes kkt-spin{to{transform:rotate(360deg)}}
    .kkt-tname{font-family:"Bebas Neue","Arial Narrow",sans-serif;font-size:1.9rem;line-height:1;text-align:center;}
    .kkt-tart{opacity:.85;text-align:center;}
    .kkt-count{font-family:"Bebas Neue",sans-serif;font-size:2.4rem;color:var(--kkt-cyan);text-shadow:0 0 14px rgba(34,224,255,.6);}
    .kkt-count.low{color:var(--kkt-mag);text-shadow:0 0 14px rgba(255,47,176,.7);}
    .kkt-count.big{font-size:4rem;}
    .kkt-bar{height:8px;border-radius:999px;background:rgba(255,255,255,.12);overflow:hidden;max-width:420px;margin:6px auto;}
    .kkt-bar > i{display:block;height:100%;background:linear-gradient(90deg,var(--kkt-cyan),var(--kkt-mag));transition:width .3s linear;}
    .kkt-votebtns{display:flex;flex-wrap:wrap;gap:10px;justify-content:center;margin-top:8px;}
    .kkt-vb{display:flex;align-items:center;gap:8px;background:rgba(255,255,255,.07);border:2px solid transparent;position:relative;
      border-radius:14px;padding:8px 14px;cursor:pointer;color:#f3e9ff;font:inherit;font-weight:700;}
    .kkt-vb.on{border-color:#fff;background:linear-gradient(135deg,var(--kkt-cyan),var(--kkt-mag));color:#0a0414;}
    .kkt-vb.second{border-color:var(--kkt-gold);background:rgba(255,213,74,.2);}
    .kkt-vb.out{opacity:.3;text-decoration:line-through;cursor:not-allowed;}
    .kkt-vb .tr{position:absolute;top:-8px;right:-8px;background:var(--kkt-gold);color:#000;border-radius:999px;min-width:22px;height:22px;
      font-size:.75rem;display:flex;align-items:center;justify-content:center;font-weight:800;}
    .kkt-vb:disabled{cursor:default;}
    .kkt-block{margin:12px 0;padding:10px;border-radius:14px;background:rgba(18,10,36,.8);}
    .kkt-block h4{margin:0 0 4px;font-size:.9rem;letter-spacing:.06em;text-transform:uppercase;color:var(--kkt-cyan);}
    .kkt-bets{display:inline-flex;gap:6px;}
    .kkt-bets button{width:46px;height:40px;border-radius:10px;border:2px solid rgba(255,255,255,.2);background:rgba(255,255,255,.06);color:#fff;font:inherit;font-weight:800;cursor:pointer;}
    .kkt-bets button.on{border-color:var(--kkt-gold);background:rgba(255,213,74,.25);}
    .kkt-jokers{display:flex;gap:8px;justify-content:center;flex-wrap:wrap;}
    .kkt-joker{font:inherit;font-weight:700;cursor:pointer;border-radius:12px;padding:8px 12px;border:1px dashed var(--kkt-gold);background:rgba(255,213,74,.08);color:var(--kkt-gold);}
    .kkt-joker:disabled{opacity:.3;cursor:default;}
    .kkt-banner{border-radius:14px;padding:10px 14px;margin:8px 0;background:linear-gradient(135deg,rgba(34,224,255,.18),rgba(255,47,176,.18));
      border:1px solid rgba(255,255,255,.2);font-weight:700;}
    .kkt-banner.gold{background:rgba(255,213,74,.15);border-color:var(--kkt-gold);color:#ffe9a8;}
    .kkt-theme{font-family:"Bebas Neue",sans-serif;font-size:1.9rem;color:var(--kkt-gold);text-shadow:0 0 16px rgba(255,213,74,.5);}
    .kkt-reveal{text-align:center;}
    .kkt-owner{display:inline-flex;align-items:center;gap:10px;font-size:1.3rem;font-weight:800;margin:8px 0;
      text-shadow:0 0 14px rgba(255,47,176,.6);}
    .kkt-owner.big{font-size:2.2rem;animation:kkt-pop .6s cubic-bezier(.2,1.6,.4,1);}
    @keyframes kkt-pop{0%{transform:scale(.2);opacity:0}100%{transform:scale(1);opacity:1}}
    .kkt-note{font-style:italic;opacity:.95;margin:6px auto;max-width:560px;}
    .kkt-arrows{display:flex;flex-direction:column;gap:6px;align-items:center;margin:10px 0;}
    .kkt-arrow{display:flex;align-items:center;gap:8px;font-weight:700;opacity:0;transform:translateY(8px);transition:all .35s;}
    .kkt-arrow.show{opacity:1;transform:none;}
    .kkt-arrow.good{color:#7CFC7C;} .kkt-arrow.bad{color:#ff8aa8;}
    .kkt-arrow .g{font-size:.85rem;opacity:.9;}
    .kkt-hidden-till{opacity:0;transition:opacity .4s;} .kkt-hidden-till.show{opacity:1;}
    .kkt-lead{max-width:520px;margin:14px auto 0;display:flex;flex-direction:column;gap:6px;}
    .kkt-le{display:flex;align-items:center;gap:10px;background:rgba(18,10,36,.86);border-radius:10px;padding:8px 12px;border:1px solid rgba(255,255,255,.07);}
    .kkt-le .rk{width:26px;font-weight:800;color:var(--kkt-cyan);} .kkt-le .nm{flex:1;font-weight:700;text-align:left;} .kkt-le .sc{font-weight:800;}
    .kkt-le .ex{font-size:.75rem;opacity:.75;}
    .kkt-le.top{background:linear-gradient(135deg,rgba(34,224,255,.25),rgba(255,47,176,.25));border-color:var(--kkt-mag);}
    .kkt-le .gain{color:#7CFC7C;font-weight:800;font-size:.85rem;} .kkt-le .gain.neg{color:#ff8aa8;}
    .kkt-trk{max-width:620px;margin:10px auto 0;display:flex;flex-direction:column;gap:6px;}
    .kkt-badges{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:8px;max-width:900px;margin:10px auto;}
    .kkt-badge{background:rgba(255,213,74,.08);border:1px solid rgba(255,213,74,.4);border-radius:14px;padding:10px;text-align:left;display:flex;gap:10px;align-items:center;}
    .kkt-badge .e{font-size:1.8rem;} .kkt-badge .t{font-weight:800;} .kkt-badge .d{font-size:.78rem;opacity:.8;}
    .kkt-slide{min-height:60vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;animation:kkt-pop .5s ease;}
    .kkt-slide .big{font-family:"Bebas Neue",sans-serif;font-size:3.2rem;line-height:1;text-shadow:0 0 22px rgba(255,47,176,.6);}
    .kkt-dots{display:flex;gap:6px;justify-content:center;margin-top:10px;}
    .kkt-dots i{width:8px;height:8px;border-radius:50%;background:rgba(255,255,255,.25);} .kkt-dots i.on{background:var(--kkt-mag);}
    .kkt-tabs{display:inline-flex;border-radius:999px;overflow:hidden;border:1px solid rgba(255,255,255,.2);margin-top:10px;}
    .kkt-tabs button{padding:8px 14px;border:none;background:transparent;color:#fff;font:inherit;font-weight:700;cursor:pointer;}
    .kkt-tabs button.on{background:linear-gradient(135deg,var(--kkt-cyan),var(--kkt-mag));color:#000;}
    .kkt-trend{display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin:8px 0;}
    .kkt-trend .c{display:flex;flex-direction:column;align-items:center;gap:4px;min-width:56px;}
    .kkt-trend .b{width:26px;border-radius:6px 6px 0 0;background:linear-gradient(180deg,var(--kkt-gold),var(--kkt-mag));transition:height .4s;}
    .kkt-trend .col{height:90px;display:flex;align-items:flex-end;}
    .kkt-emoji-grid{display:flex;flex-wrap:wrap;gap:6px;}
    .kkt-emoji-grid button{width:42px;height:42px;border-radius:10px;border:2px solid transparent;background:rgba(255,255,255,.07);font-size:1.3rem;cursor:pointer;}
    .kkt-emoji-grid button.on{border-color:var(--kkt-mag);}
    .kkt-color-grid{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;}
    .kkt-color-grid button{width:30px;height:30px;border-radius:50%;border:3px solid transparent;cursor:pointer;}
    .kkt-color-grid button.on{border-color:#fff;}
    .kkt-toast{position:fixed;top:14px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,.88);color:#fff;
      padding:10px 18px;border-radius:999px;z-index:120;font-weight:600;opacity:0;transition:opacity .25s;pointer-events:none;
      border:1px solid var(--kkt-mag);max-width:90vw;text-align:center;}
    .kkt-toast.show{opacity:1;}
    .kkt-you-panel{border-top:1px dashed rgba(255,255,255,.2);margin-top:16px;padding-top:12px;}
    /* host: cheat drawer, secret panel, join QR */
    .kkt-drawer-btn{position:fixed;right:14px;bottom:64px;z-index:65;width:48px;height:48px;border-radius:50%;border:1px solid rgba(255,255,255,.3);
      background:rgba(0,0,0,.6);color:#fff;font-size:1.3rem;cursor:pointer;}
    .kkt-drawer{position:fixed;right:14px;bottom:120px;z-index:65;display:none;flex-direction:column;gap:6px;background:rgba(10,4,20,.95);
      border:1px solid rgba(255,255,255,.2);border-radius:14px;padding:10px;}
    .kkt-drawer.open{display:flex;}
    .kkt-seg{opacity:.45;transition:opacity .3s,transform .3s;} .kkt-seg.on{opacity:1;transform:scale(1.04);}
    .kkt-cheat{font-family:inherit;cursor:pointer;border:1px solid rgba(255,255,255,.25);
      background:rgba(255,255,255,.07);color:#f3e9ff;padding:8px 12px;border-radius:10px;font-size:.85rem;text-align:left;}
    .kkt-secret-btn{position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:64;}
    .kkt-secret{position:fixed;inset:0;z-index:110;background:rgba(5,2,12,.97);overflow:auto;padding:18px 16px 60px;display:none;}
    .kkt-secret.open{display:block;}
    .kkt-qr-corner{position:fixed;left:12px;bottom:12px;z-index:63;background:rgba(0,0,0,.55);border-radius:12px;padding:6px;text-align:center;
      font-size:.7rem;color:#fff;}
    .kkt-qr-corner .join-qr{margin-top:0;padding:4px;}
    @media (max-width:560px){.kkt-title{font-size:2.1rem}.kkt-qr-corner{display:none}}
    `;
    document.head.appendChild(st);
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

  // Avatar picker (emoji + colour).
  window.kktAvatarPicker = function (av, emojis, colors) {
    return `<div class="kkt-emoji-grid">` + emojis.map((e) =>
      `<button data-av-e="${kktEsc(e)}" class="${av && av.emoji === e ? "on" : ""}">${e}</button>`).join("") +
      `</div><div class="kkt-color-grid">` + colors.map((c) =>
      `<button data-av-c="${kktEsc(c)}" class="${av && av.color === c ? "on" : ""}" style="background:${kktEsc(c)}" aria-label="couleur ${kktEsc(c)}"></button>`).join("") + `</div>`;
  };
  window.kktWireAvatar = function (root, you, send) {
    root.querySelectorAll("[data-av-e]").forEach((b) => (b.onclick = () => send("setAvatar", { emoji: b.getAttribute("data-av-e"), color: you.avatar && you.avatar.color })));
    root.querySelectorAll("[data-av-c]").forEach((b) => (b.onclick = () => send("setAvatar", { emoji: you.avatar && you.avatar.emoji, color: b.getAttribute("data-av-c") })));
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
        <button data-nature="sincere" class="${v.nature === "sincere" ? "on" : ""}" ${locked ? "disabled" : ""}>💖 Un vrai coup de coeur</button>
        <button data-nature="bluff" class="${v.nature === "bluff" ? "on" : ""}" ${locked ? "disabled" : ""}>🃏 Un bluff</button></div></div>`;
    }
    if (s.settings.bets) {
      h += `<div class="kkt-block"><h4>Ta mise</h4><div class="kkt-bets">` + [1, 2, 3].map((b) =>
        `<button data-bet="${b}" class="${(v.bet || 1) === b ? "on" : ""}" ${locked ? "disabled" : ""}>${b}🪙</button>`).join("") +
        `</div><div class="kkt-small">Juste = points x mise. Faux = tu perds mise - 1.</div></div>`;
    }
    const complete = s.parts.every((_, i) => v.p[i]);
    h += `<div class="kkt-row kkt-center" style="margin-top:8px">` + (locked
      ? `<span class="kkt-voted">🔒 Vote verrouille (+1 si juste)</span>`
      : `<button class="kkt-btn ghost sm" data-lock ${complete ? "" : "disabled"}>🔒 Je suis sur (+1)</button>`) + `</div>`;
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
    el.textContent = (g.title ? "✅ Titre trouve " : "Titre : pas encore ") + " · " + (g.artist ? "✅ Artiste trouve" : "Artiste : pas encore");
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
        <span class="nm">${kktEsc(l.name)}${l.id === me ? " (toi)" : ""}${l.left ? " <span class='ex'>(parti)</span>" : ""}${l.late ? " <span class='ex'>(arrive en cours)</span>" : ""}</span>
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
    }).join("") || `<p class="kkt-sub">Personne n'a vote…</p>`;
    const rows = el.querySelectorAll(".kkt-arrow");
    const step = 450;
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
    ["Zouk", "zouk"], ["Maloya / Sega", "maloya"], ["Anime", "anime opening"], ["Annees 2000", "hits 2000"], ["Rock", "rock classics"], ["Electro", "electro"]];

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

    function load(url) {
      const s = ++seq;
      results.innerHTML = `<p class="kkt-sub">Chargement…</p>`;
      fetch(url).then((r) => r.json()).then((d) => { if (s === seq) show(d.results || [], d.error || "Aucun resultat."); })
        .catch(() => { if (s === seq) results.innerHTML = `<p class="kkt-sub">Recherche indisponible.</p>`; });
    }
    function doSearch(query) { load("/api/music/search?q=" + encodeURIComponent(query)); }
    function show(l, emptyMsg) {
      list = l.filter((t) => !(noExplicit() && t.explicit));
      results.innerHTML = list.map((t, i) =>
        `<div class="kkt-res"><img src="${kktEsc(t.cover)}" alt="" onerror="this.style.visibility='hidden'"/>
          <div class="info"><div class="t">${kktEsc(t.title)}${t.explicit ? '<span class="kkt-e">E</span>' : ""}</div><div class="a">${kktEsc(t.artist)}</div></div>
          <button class="kkt-mini" data-prev="${i}" aria-label="Ecouter">▶</button>
          <button class="kkt-mini kkt-pick" data-pick="${i}" ${full() ? "disabled" : ""} aria-label="Choisir">+</button></div>`).join("")
        || `<p class="kkt-sub">${kktEsc(emptyMsg || "Aucun resultat.")}</p>`;
      results.querySelectorAll("[data-prev]").forEach((b) => (b.onclick = () => kktAudio.preview(list[+b.getAttribute("data-prev")].preview).catch(() => {})));
      results.querySelectorAll("[data-pick]").forEach((b) => (b.onclick = () => {
        const t = list[+b.getAttribute("data-pick")];
        kktAudio.stop(); remember(t); send("submitTrack", { track: t });
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
            <button class="kkt-mini" data-prevm="${kktEsc(t.preview)}" aria-label="Ecouter">▶</button>
            <button class="kkt-mini" data-rm="${kktEsc(t.id)}" aria-label="Retirer">✕</button>
            ${tb ? `<div class="kkt-toggle" style="flex:1 1 100%"><button data-nat="sincere" data-id="${kktEsc(t.id)}" class="${t.nature === "sincere" ? "on" : ""}">💖 Sincere</button>
              <button data-nat="bluff" data-id="${kktEsc(t.id)}" class="${t.nature === "bluff" ? "on" : ""}">🃏 Bluff</button></div>` : ""}
            <div class="note"><input class="kkt-input" data-note="${kktEsc(t.id)}" maxlength="120" placeholder="Message cache (revele a la fin de la manche)" value="${kktEsc(t.note || "")}"/></div></div>`).join("")
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
    const done = () => kktToast("Copie dans le presse-papier ✅");
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
  //   data-prestart="<ts>"            -> "Ca commence dans 2s" (hidden after)
  //   data-seg-start / data-seg-len / data-seg="i" -> highlights the playing excerpt
  window.kktTick = function () {
    const now = kktNow();
    document.querySelectorAll("[data-countdown]").forEach((el) => {
      const left = kktLeft(+el.getAttribute("data-countdown"));
      const txt = left + "s";
      if (el.textContent !== txt) el.textContent = txt;
      el.classList.toggle("low", left <= 5);
    });
    document.querySelectorAll("[data-bar-end]").forEach((el) => {
      const a = +el.getAttribute("data-bar-start"), b = +el.getAttribute("data-bar-end");
      const pct = b > a ? Math.max(0, Math.min(1, (b - now) / (b - a))) : 0;
      const i = el.querySelector("i"); if (i) i.style.width = (pct * 100).toFixed(1) + "%";
    });
    document.querySelectorAll("[data-prestart]").forEach((el) => {
      const left = kktLeft(+el.getAttribute("data-prestart"));
      el.hidden = left <= 0;
      if (left > 0) el.textContent = "Ca commence dans " + left + "s…";
    });
    document.querySelectorAll("[data-seg-start]").forEach((box) => {
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
