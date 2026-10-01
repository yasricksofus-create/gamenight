// common.js -- Shared helpers, NEON/club styles, and reusable participant UI for
// "Kietkoutsa Reborn". Loaded for both the host and the players.
(function () {
  window.kktEsc = function (s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  };

  window.kktAvatar = function (av, size) {
    const bg = (av && av.color) || "#9b5cff";
    const em = (av && av.emoji) || "🎵";
    size = size || 48;
    return `<span class="kkt-av" style="width:${size}px;height:${size}px;background:${bg};font-size:${Math.round(size * 0.52)}px">${em}</span>`;
  };

  // Shared <audio> for the 30s preview. It follows the master volume slider.
  window.kktAudio = (function () {
    let el = null, cur = "";
    const ensure = () => {
      if (!el) {
        el = new Audio(); el.preload = "auto";
        if (window.Sound && Sound.attachExternal) Sound.attachExternal(el); // obey the volume bar
        else el.volume = 0.7;
      }
      return el;
    };
    return {
      play(url) { const a = ensure(); if (cur !== url) { a.src = url; cur = url; } try { a.currentTime = 0; } catch (e) {} return a.play() || Promise.resolve(); },
      stop() { if (el) { try { el.pause(); } catch (e) {} } },
    };
  })();

  window.kktToast = function (msg) {
    let t = document.getElementById("kkt-toast");
    if (!t) { t = document.createElement("div"); t.id = "kkt-toast"; t.className = "kkt-toast"; document.body.appendChild(t); }
    t.textContent = msg; t.classList.add("show");
    clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove("show"), 1600);
  };

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
    :root{--kkt-mag:#ff2fb0;--kkt-cyan:#22e0ff;--kkt-pur:#9b5cff;--kkt-ink:#07060f;}
    /* animated neon background */
    #kkt-bg{position:fixed;inset:0;z-index:0;overflow:hidden;background:
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
    @keyframes kkt-eq{0%{transform:scaleY(.25)}100%{transform:scaleY(1)}}
    @media (prefers-reduced-motion: reduce){.kkt-eq span,.kkt-bg-glow{animation:none}}

    .kkt-stage{position:relative;z-index:1;width:100vw;left:50%;margin-left:-50vw;
      min-height:calc(100vh - 8px);padding:18px 16px 44px;color:#f3e9ff;}
    .kkt-wrap{max-width:900px;margin:0 auto;}
    .kkt-eyebrow{letter-spacing:.22em;text-transform:uppercase;font-size:.72rem;color:var(--kkt-cyan);margin:0 0 4px;}
    .kkt-title{font-family:"Bebas Neue","Arial Narrow",sans-serif;font-size:2.6rem;letter-spacing:.03em;margin:.05em 0 .3em;
      text-shadow:0 0 18px rgba(255,47,176,.55),0 0 4px rgba(34,224,255,.4);}
    .kkt-sub{opacity:.88;margin:.2em 0;}
    .kkt-av{display:inline-flex;align-items:center;justify-content:center;border-radius:50%;
      border:2px solid rgba(255,255,255,.85);box-shadow:0 0 12px rgba(155,92,255,.6);flex:0 0 auto;line-height:1;}
    .kkt-btn{font-family:inherit;font-size:1rem;font-weight:800;color:#0a0414;border:none;cursor:pointer;
      padding:12px 22px;border-radius:999px;background:linear-gradient(135deg,var(--kkt-cyan),var(--kkt-mag));
      box-shadow:0 0 18px rgba(255,47,176,.5);}
    .kkt-btn:disabled{opacity:.4;cursor:default;box-shadow:none;}
    .kkt-btn.ghost{background:rgba(255,255,255,.1);color:#fff;box-shadow:none;border:1px solid rgba(255,255,255,.25);}
    .kkt-row{display:flex;gap:10px;align-items:center;flex-wrap:wrap;}
    .kkt-card{background:rgba(255,255,255,.05);border:1px solid rgba(155,92,255,.3);border-radius:16px;padding:14px 16px;margin:10px 0;
      box-shadow:0 0 24px rgba(34,224,255,.08) inset;}
    .kkt-stepper{display:inline-flex;align-items:center;gap:16px;font-weight:800;font-size:1.3rem;}
    .kkt-stepper button{width:42px;height:42px;border-radius:12px;border:none;cursor:pointer;font-size:1.4rem;font-weight:800;
      background:rgba(155,92,255,.25);color:#fff;}
    .kkt-toggle{display:inline-flex;border-radius:999px;overflow:hidden;border:1px solid rgba(255,255,255,.2);}
    .kkt-toggle button{padding:10px 18px;border:none;cursor:pointer;background:transparent;color:#f3e9ff;font-weight:700;}
    .kkt-toggle button.on{background:linear-gradient(135deg,var(--kkt-cyan),var(--kkt-mag));color:#0a0414;}
    .kkt-players{display:flex;flex-wrap:wrap;gap:10px;margin:12px 0;}
    .kkt-pl{display:flex;align-items:center;gap:10px;background:rgba(255,255,255,.05);border-radius:12px;padding:8px 12px;min-width:150px;border:1px solid rgba(255,255,255,.08);}
    .kkt-pl.ok{border-color:var(--kkt-cyan);box-shadow:0 0 12px rgba(34,224,255,.3);}
    .kkt-pl.off{opacity:.45;} .kkt-pl.me{border-color:var(--kkt-mag);}
    .kkt-pl .nm{font-weight:700;} .kkt-pl .mt{font-size:.8rem;opacity:.85;}
    .kkt-voted{color:var(--kkt-cyan);font-weight:800;}
    .kkt-search{width:100%;font:inherit;font-size:1.05rem;padding:12px 14px;border-radius:12px;
      border:1px solid rgba(34,224,255,.4);background:rgba(255,255,255,.08);color:inherit;}
    .kkt-results{display:flex;flex-direction:column;gap:8px;margin-top:10px;}
    .kkt-res{display:flex;align-items:center;gap:10px;background:rgba(255,255,255,.05);border-radius:12px;padding:8px;border:1px solid rgba(255,255,255,.07);}
    .kkt-res img{width:52px;height:52px;border-radius:8px;object-fit:cover;flex:0 0 auto;background:#241543;}
    .kkt-res .info{flex:1;min-width:0;}
    .kkt-res .t{font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
    .kkt-res .a{font-size:.85rem;opacity:.8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
    .kkt-mini{width:42px;height:42px;border-radius:12px;border:none;cursor:pointer;font-size:1.1rem;
      background:rgba(255,255,255,.14);color:#fff;flex:0 0 auto;}
    .kkt-pick{background:linear-gradient(135deg,var(--kkt-cyan),var(--kkt-mag));color:#0a0414;}
    .kkt-mine{display:flex;flex-direction:column;gap:6px;margin-top:12px;}
    .kkt-mine .kkt-res{border-color:rgba(255,47,176,.4);}
    .kkt-now{display:flex;flex-direction:column;align-items:center;gap:10px;margin:8px 0 16px;}
    .kkt-cover{width:min(58vw,250px);height:min(58vw,250px);border-radius:18px;object-fit:cover;
      background:#241543;box-shadow:0 0 44px rgba(255,47,176,.5),0 0 18px rgba(34,224,255,.4);}
    .kkt-tname{font-family:"Bebas Neue","Arial Narrow",sans-serif;font-size:1.9rem;line-height:1;text-align:center;}
    .kkt-tart{opacity:.85;text-align:center;}
    .kkt-count{font-family:"Bebas Neue",sans-serif;font-size:2.4rem;color:var(--kkt-cyan);text-shadow:0 0 14px rgba(34,224,255,.6);}
    .kkt-count.low{color:var(--kkt-mag);text-shadow:0 0 14px rgba(255,47,176,.7);}
    .kkt-votebtns{display:flex;flex-wrap:wrap;gap:10px;justify-content:center;margin-top:8px;}
    .kkt-vb{display:flex;align-items:center;gap:8px;background:rgba(255,255,255,.07);border:2px solid transparent;
      border-radius:14px;padding:8px 14px;cursor:pointer;color:#f3e9ff;font:inherit;font-weight:700;}
    .kkt-vb.on{border-color:#fff;background:linear-gradient(135deg,var(--kkt-cyan),var(--kkt-mag));color:#0a0414;}
    .kkt-reveal{text-align:center;}
    .kkt-owner{display:inline-flex;align-items:center;gap:10px;font-size:1.3rem;font-weight:800;margin:8px 0;
      text-shadow:0 0 14px rgba(255,47,176,.6);}
    .kkt-lead{max-width:460px;margin:14px auto 0;display:flex;flex-direction:column;gap:6px;}
    .kkt-le{display:flex;align-items:center;gap:10px;background:rgba(255,255,255,.05);border-radius:10px;padding:8px 12px;border:1px solid rgba(255,255,255,.07);}
    .kkt-le .rk{width:26px;font-weight:800;color:var(--kkt-cyan);} .kkt-le .nm{flex:1;font-weight:700;} .kkt-le .sc{font-weight:800;}
    .kkt-le.top{background:linear-gradient(135deg,rgba(34,224,255,.25),rgba(255,47,176,.25));border-color:var(--kkt-mag);}
    .kkt-trk{max-width:560px;margin:10px auto 0;display:flex;flex-direction:column;gap:6px;}
    .kkt-cheatbar{display:flex;flex-wrap:wrap;gap:8px;justify-content:center;margin-top:18px;}
    .kkt-cheat{font-family:inherit;cursor:pointer;border:1px solid rgba(255,255,255,.25);
      background:rgba(255,255,255,.07);color:#f3e9ff;padding:8px 12px;border-radius:10px;font-size:.85rem;}
    .kkt-toast{position:fixed;top:14px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,.85);color:#fff;
      padding:10px 18px;border-radius:999px;z-index:60;font-weight:600;opacity:0;transition:opacity .25s;pointer-events:none;
      border:1px solid var(--kkt-mag);}
    .kkt-toast.show{opacity:1;}
    .kkt-draw{position:fixed;inset:0;z-index:70;display:flex;align-items:center;justify-content:center;pointer-events:none;}
    .kkt-you-panel{border-top:1px dashed rgba(255,255,255,.2);margin-top:16px;padding-top:12px;}
    `;
    document.head.appendChild(st);
  };

  // ---------- reusable participant controls (used by BOTH host and player) ----------
  // makeSearch builds the search+picks UI once in `el`, then .update(you) patches it.
  window.KktSearch = function (el, send) {
    let timer = null, seq = 0;
    el.innerHTML = `<input class="kkt-search" placeholder="Rechercher un titre, un artiste…" autocomplete="off"/>
      <div class="kkt-results"></div>
      <h3 class="kkt-title" style="font-size:1.1rem;margin:14px 0 4px">Mes morceaux <span class="kkt-pickc"></span></h3>
      <div class="kkt-mine"></div>`;
    const q = el.querySelector(".kkt-search");
    const results = el.querySelector(".kkt-results");
    const mine = el.querySelector(".kkt-mine");
    const pickc = el.querySelector(".kkt-pickc");
    let you = { subs: [], perPlayer: 1 };
    q.addEventListener("input", () => {
      const v = q.value.trim();
      clearTimeout(timer);
      if (!v) { results.innerHTML = ""; return; }
      timer = setTimeout(() => doSearch(v), 350);
    });
    function full() { return you.subs.length >= (you.perPlayer || 1); }
    function doSearch(query) {
      const s = ++seq;
      results.innerHTML = `<p class="kkt-sub">Recherche…</p>`;
      fetch("/api/music/search?q=" + encodeURIComponent(query)).then((r) => r.json()).then((d) => {
        if (s !== seq) return;
        const list = d.results || [];
        results.innerHTML = list.map((t, i) =>
          `<div class="kkt-res"><img src="${kktEsc(t.cover)}" onerror="this.style.visibility='hidden'"/>
            <div class="info"><div class="t">${kktEsc(t.title)}</div><div class="a">${kktEsc(t.artist)}</div></div>
            <button class="kkt-mini" data-prev="${i}">▶</button>
            <button class="kkt-mini kkt-pick" data-pick="${i}" ${full() ? "disabled" : ""}>+</button></div>`).join("")
          || `<p class="kkt-sub">Aucun resultat.</p>`;
        results.querySelectorAll("[data-prev]").forEach((b) => (b.onclick = () => kktAudio.play(list[+b.getAttribute("data-prev")].preview).catch(() => {})));
        results.querySelectorAll("[data-pick]").forEach((b) => (b.onclick = () => { kktAudio.stop(); send("submitTrack", { track: list[+b.getAttribute("data-pick")] }); }));
      }).catch(() => { results.innerHTML = `<p class="kkt-sub">Recherche indisponible.</p>`; });
    }
    function update(y) {
      you = y || you;
      const max = you.perPlayer || 1, n = you.subs.length;
      pickc.textContent = n >= max ? `(${max}/${max} ✓)` : `(${n}/${max})`;
      mine.innerHTML = you.subs.length ? you.subs.map((t) =>
        `<div class="kkt-res"><img src="${kktEsc(t.cover)}" onerror="this.style.visibility='hidden'"/>
          <div class="info"><div class="t">${kktEsc(t.title)}</div><div class="a">${kktEsc(t.artist)}</div></div>
          <button class="kkt-mini" data-prev="${kktEsc(t.preview)}">▶</button>
          <button class="kkt-mini" data-rm="${kktEsc(t.id)}">✕</button></div>`).join("")
        : `<p class="kkt-sub">Rien encore.</p>`;
      mine.querySelectorAll("[data-prev]").forEach((b) => (b.onclick = () => kktAudio.play(b.getAttribute("data-prev")).catch(() => {})));
      mine.querySelectorAll("[data-rm]").forEach((b) => (b.onclick = () => send("removeTrack", { trackId: b.getAttribute("data-rm") })));
      // disable the + buttons in the results if full
      results.querySelectorAll("[data-pick]").forEach((b) => (b.disabled = full()));
    }
    return { update };
  };

  // Vote buttons for everyone except `me`. Rebuilt each call (no input to keep).
  window.kktVoteButtons = function (players, me, vote) {
    return `<div class="kkt-votebtns">` + players.filter((p) => p.id !== me).map((p) =>
      `<button class="kkt-vb ${vote === p.id ? "on" : ""}" data-vote="${p.id}">${kktAvatar(p.avatar, 28)} ${kktEsc(p.name)}</button>`).join("") + `</div>`;
  };
  window.kktLeaderboard = function (lead, me) {
    return `<div class="kkt-lead">` + lead.map((l, i) =>
      `<div class="kkt-le ${l.id === me ? "top" : ""}"><span class="rk">${i + 1}</span>${kktAvatar(l.avatar, 28)}
        <span class="nm">${kktEsc(l.name)}${l.id === me ? " (toi)" : ""}</span><span class="sc">${l.score}</span></div>`).join("") + `</div>`;
  };
})();
