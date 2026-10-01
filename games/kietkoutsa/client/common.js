// common.js -- Shared helpers + styles for the "Kietkoutsa Reborn" client.
(function () {
  window.kktEsc = function (s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  };

  // Emoji-on-colour avatar bubble (size in px).
  window.kktAvatar = function (av, size) {
    const bg = (av && av.color) || "#4C46F0";
    const em = (av && av.emoji) || "🎵";
    size = size || 48;
    return `<span class="kkt-av" style="width:${size}px;height:${size}px;background:${bg};font-size:${Math.round(size * 0.52)}px">${em}</span>`;
  };

  // One shared <audio> for the 30s preview (round song + search previews).
  window.kktAudio = (function () {
    let el = null, cur = "";
    const ensure = () => { if (!el) { el = new Audio(); el.preload = "auto"; } return el; };
    return {
      play(url) { const a = ensure(); if (cur !== url) { a.src = url; cur = url; } try { a.currentTime = 0; } catch (e) {} return a.play() || Promise.resolve(); },
      stop() { if (el) { try { el.pause(); } catch (e) {} } },
    };
  })();

  window.kktInjectStyles = function () {
    if (document.getElementById("kkt-styles")) return;
    const st = document.createElement("style");
    st.id = "kkt-styles";
    st.textContent = `
    .kkt-stage{position:relative;width:100vw;left:50%;margin-left:-50vw;min-height:calc(100vh - 8px);
      overflow-x:hidden;padding:18px 16px 40px;
      background:linear-gradient(rgba(10,6,24,.42),rgba(8,4,20,.82)),url("/games/kietkoutsa/img/fond.jpg"),
        radial-gradient(circle at 50% 28%, #3a1d6b 0%, #1a1038 55%, #0a0618 100%);
      background-size:cover;background-position:center;background-repeat:no-repeat;}
    .kkt-wrap{max-width:900px;margin:0 auto;}
    .kkt-eyebrow{letter-spacing:.14em;text-transform:uppercase;font-size:.72rem;opacity:.75;margin:0 0 2px;}
    .kkt-title{font-family:"Bebas Neue","Arial Narrow",sans-serif;font-size:2.3rem;letter-spacing:.02em;margin:.1em 0 .35em;}
    .kkt-sub{opacity:.85;margin:.2em 0;}
    .kkt-av{display:inline-flex;align-items:center;justify-content:center;border-radius:50%;
      border:2px solid rgba(255,255,255,.8);box-shadow:0 3px 8px rgba(0,0,0,.4);flex:0 0 auto;line-height:1;}
    .kkt-btn{font-family:inherit;font-size:1rem;font-weight:700;color:#fff;border:none;cursor:pointer;
      padding:12px 20px;border-radius:12px;background:linear-gradient(135deg,var(--primary,#8B2FE0),var(--secondary,#E92EC0));
      box-shadow:0 4px 12px rgba(0,0,0,.35);}
    .kkt-btn:disabled{opacity:.45;cursor:default;}
    .kkt-btn.ghost{background:rgba(255,255,255,.12);}
    .kkt-row{display:flex;gap:10px;align-items:center;flex-wrap:wrap;}
    /* settings */
    .kkt-card{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);border-radius:14px;padding:14px 16px;margin:10px 0;}
    .kkt-stepper{display:inline-flex;align-items:center;gap:14px;font-weight:800;font-size:1.2rem;}
    .kkt-stepper button{width:40px;height:40px;border-radius:10px;border:none;cursor:pointer;font-size:1.3rem;font-weight:800;
      background:rgba(255,255,255,.14);color:#fff;}
    .kkt-toggle{display:inline-flex;border-radius:999px;overflow:hidden;border:1px solid rgba(255,255,255,.2);}
    .kkt-toggle button{padding:9px 16px;border:none;cursor:pointer;background:transparent;color:var(--text);font-weight:700;}
    .kkt-toggle button.on{background:linear-gradient(135deg,var(--primary),var(--secondary));color:#fff;}
    /* players readiness / list */
    .kkt-players{display:flex;flex-wrap:wrap;gap:10px;margin:12px 0;}
    .kkt-pl{display:flex;align-items:center;gap:10px;background:rgba(255,255,255,.06);border-radius:12px;padding:8px 12px;min-width:150px;}
    .kkt-pl.ok{background:rgba(93,240,70,.14);}
    .kkt-pl.off{opacity:.45;}
    .kkt-pl .nm{font-weight:700;}
    .kkt-pl .mt{font-size:.8rem;opacity:.85;}
    .kkt-voted{color:#7CFC7C;font-weight:800;}
    /* search */
    .kkt-search{width:100%;font:inherit;font-size:1.05rem;padding:12px 14px;border-radius:12px;
      border:1px solid rgba(255,255,255,.25);background:rgba(255,255,255,.08);color:inherit;}
    .kkt-results{display:flex;flex-direction:column;gap:8px;margin-top:10px;}
    .kkt-res{display:flex;align-items:center;gap:10px;background:rgba(255,255,255,.06);border-radius:12px;padding:8px;}
    .kkt-res img{width:52px;height:52px;border-radius:8px;object-fit:cover;flex:0 0 auto;background:#222;}
    .kkt-res .info{flex:1;min-width:0;}
    .kkt-res .t{font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
    .kkt-res .a{font-size:.85rem;opacity:.8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
    .kkt-mini{width:40px;height:40px;border-radius:10px;border:none;cursor:pointer;font-size:1.1rem;
      background:rgba(255,255,255,.14);color:#fff;flex:0 0 auto;}
    .kkt-pick{background:linear-gradient(135deg,var(--primary),var(--secondary));}
    .kkt-mine{display:flex;flex-direction:column;gap:6px;margin-top:12px;}
    .kkt-mine .kkt-res{background:rgba(139,47,224,.18);}
    /* playing stage */
    .kkt-now{display:flex;flex-direction:column;align-items:center;gap:10px;margin:10px 0 18px;}
    .kkt-cover{width:min(60vw,260px);height:min(60vw,260px);border-radius:18px;object-fit:cover;
      box-shadow:0 16px 48px rgba(0,0,0,.55);background:#241543;}
    .kkt-tname{font-family:"Bebas Neue","Arial Narrow",sans-serif;font-size:1.8rem;line-height:1;text-align:center;}
    .kkt-tart{opacity:.85;text-align:center;}
    .kkt-count{font-family:"Bebas Neue",sans-serif;font-size:2.2rem;}
    .kkt-count.low{color:#F06666;}
    .kkt-votebtns{display:flex;flex-wrap:wrap;gap:10px;justify-content:center;margin-top:8px;}
    .kkt-vb{display:flex;align-items:center;gap:8px;background:rgba(255,255,255,.08);border:2px solid transparent;
      border-radius:12px;padding:8px 12px;cursor:pointer;color:var(--text);font:inherit;font-weight:700;}
    .kkt-vb.on{border-color:#fff;background:linear-gradient(135deg,var(--primary),var(--secondary));color:#fff;}
    /* reveal + leaderboard */
    .kkt-reveal{text-align:center;}
    .kkt-owner{display:inline-flex;align-items:center;gap:10px;font-size:1.2rem;font-weight:800;margin:8px 0;}
    .kkt-lead{max-width:460px;margin:14px auto 0;display:flex;flex-direction:column;gap:6px;}
    .kkt-le{display:flex;align-items:center;gap:10px;background:rgba(255,255,255,.06);border-radius:10px;padding:8px 12px;}
    .kkt-le .rk{width:26px;font-weight:800;opacity:.8;}
    .kkt-le .nm{flex:1;font-weight:700;}
    .kkt-le .sc{font-weight:800;}
    .kkt-le.top{background:linear-gradient(135deg,rgba(139,47,224,.4),rgba(233,46,192,.4));}
    .kkt-trk{max-width:560px;margin:10px auto 0;display:flex;flex-direction:column;gap:6px;}
    .kkt-trk .kkt-res{background:rgba(255,255,255,.06);}
    .kkt-cheatbar{display:flex;flex-wrap:wrap;gap:8px;justify-content:center;margin-top:18px;}
    .kkt-cheat{font-family:inherit;cursor:pointer;border:1px solid rgba(255,255,255,.25);
      background:rgba(255,255,255,.07);color:var(--text);padding:8px 12px;border-radius:10px;font-size:.85rem;}
    .kkt-toast{position:fixed;top:14px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,.82);color:#fff;
      padding:10px 18px;border-radius:999px;z-index:60;font-weight:600;opacity:0;transition:opacity .25s;pointer-events:none;}
    .kkt-toast.show{opacity:1;}
    `;
    document.head.appendChild(st);
  };

  window.kktToast = function (msg) {
    let t = document.getElementById("kkt-toast");
    if (!t) { t = document.createElement("div"); t.id = "kkt-toast"; t.className = "kkt-toast"; document.body.appendChild(t); }
    t.textContent = msg; t.classList.add("show");
    clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove("show"), 1600);
  };
})();
