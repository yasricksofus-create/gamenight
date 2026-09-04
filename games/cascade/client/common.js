// uno-common.js -- Shared helpers for the "Cascade" client (host + player).
//
// Cards are drawn TWO ways (the user's "hybride" choice):
//   * NUMBER cards (0-9) are drawn fully in code here (colored oval + big digit).
//   * SPECIAL + CUSTOM cards use the user's Canva symbol PNGs from /cards/.
// The 4 colors and the 3 card backs also come from the user's Canva files.

// The user's palette (Canva): R=rouge, J=jaune, V=vert, B=bleu.
window.UNO_COLORS = { R: "#F04646", J: "#F0E246", V: "#5DF046", B: "#4C46F0" };
window.UNO_COLOR_NAMES = { R: "Rouge", J: "Jaune", V: "Vert", B: "Bleu" };

// Which Canva symbol PNG each non-number card uses.
window.UNO_SYMS = {
  skip: "/cards/sym-passer.png",
  reverse: "/cards/sym-inverser.png",
  draw2: "/cards/sym-plus2.png",
  joker: "/cards/sym-joker.png", // the joker also serves as the +4
  flush: "/cards/sym-flush.png",
  pay: "/cards/sym-pay.png",
  plus1: "/cards/sym-plus1-everyone.png",
  print: "/cards/sym-print.png",
  protect: "/cards/sym-protect.png",
};
// The 3 card backs, rotated for visual variety.
window.UNO_BACKS = ["/cards/dos.png", "/cards/dos2.png", "/cards/dos3.png"];

// Text fallback shown if a symbol PNG is missing (e.g. before the user uploads
// them), so a card is never a blank/broken box.
const UNO_FALLBACK = {
  skip: "⊘", reverse: "⇄", draw2: "+2", joker: "+4",
  flush: "FLUSH", pay: "PAY", plus1: "+1", print: "COPY", protect: "🛡",
};

// A human label for a card (used in the "last action" line and for accessibility).
window.unoCardLabel = function (c) {
  if (!c) return "";
  if (c.kind === "number") return (UNO_COLOR_NAMES[c.color] || "") + " " + c.value;
  const names = { skip: "Passer", reverse: "Inverser", draw2: "+2", joker: "Joker +4",
    flush: "Flush", pay: "Pay", plus1: "+1 pour tous", print: "Copie", protect: "Protection" };
  return names[c.kind] || c.kind;
};

window.unoIsColorless = function (c) { return !c || c.color === null || c.color === undefined; };

// Build the HTML for one CARD FACE. opts: { small, selectable, selected, playable }.
window.unoCardHtml = function (c, opts) {
  opts = opts || {};
  const cls = ["uno-card"];
  if (opts.small) cls.push("small");
  if (opts.selectable) cls.push("sel");
  if (opts.selected) cls.push("on");
  if (opts.playable === false) cls.push("dim");
  const colorless = unoIsColorless(c);
  if (colorless) cls.push("colorless");
  const color = colorless ? "#222" : (UNO_COLORS[c.color] || "#666");
  const dataId = c.id ? ` data-id="${c.id}"` : "";

  let inner;
  if (c.kind === "number") {
    // Clean, untilted oval + big digit (crisp: no rotation, no heavy shadow).
    inner = `<span class="uno-corner tl">${c.value}</span>
      <span class="uno-face-num"><span class="uno-big">${c.value}</span></span>
      <span class="uno-corner br">${c.value}</span>`;
  } else {
    // Special / custom cards: one BIG centered symbol (the user's Canva PNG),
    // with a text fallback behind it if the image is missing.
    const src = UNO_SYMS[c.kind];
    const fb = UNO_FALLBACK[c.kind] || "?";
    inner = `<span class="uno-symwrap">
        <span class="uno-fallback">${fb}</span>
        <img class="uno-sym" src="${src}" alt="${fb}" onerror="this.style.display='none'" />
      </span>`;
  }
  return `<div class="${cls.join(" ")}" style="--c:${color}"${dataId}>${inner}</div>`;
};

// A face-down card (uses the user's 3 backs, rotated by seed).
window.unoBackHtml = function (seed, small) {
  const src = UNO_BACKS[(seed || 0) % UNO_BACKS.length];
  const cls = "uno-card back" + (small ? " small" : "");
  return `<div class="${cls}"><img class="uno-back-img" src="${src}" alt="dos"
    onerror="this.style.display='none';this.parentNode.classList.add('noimg')" /></div>`;
};

// A colored dot (used in turn order / active-color chip).
window.unoDot = function (color) {
  const c = UNO_COLORS[color] || "#888";
  return `<span class="uno-dot" style="background:${c}"></span>`;
};

// Inject the Cascade stylesheet once (kept out of base.css so the game is
// self-contained). Reuses the page's --primary/--text theme variables.
window.unoInjectStyles = function () {
  if (document.getElementById("uno-styles")) return;
  const st = document.createElement("style");
  st.id = "uno-styles";
  st.textContent = `
  .uno-wrap{max-width:1100px;margin:0 auto;padding:8px 12px 96px;}
  .uno-eyebrow{letter-spacing:.14em;text-transform:uppercase;font-size:.72rem;opacity:.7;margin:0 0 2px;}
  .uno-title{font-family:"Bebas Neue",sans-serif;font-size:2.4rem;letter-spacing:.03em;margin:.1em 0 .3em;}
  .uno-sub{opacity:.82;margin:.2em 0;}
  /* --- a card --- */
  .uno-card{position:relative;width:94px;height:134px;border-radius:12px;background:var(--c);
    box-shadow:0 4px 10px rgba(0,0,0,.35);border:3px solid #fff;-webkit-font-smoothing:antialiased;
    display:flex;align-items:center;justify-content:center;flex:0 0 auto;overflow:hidden;}
  .uno-card.small{width:56px;height:80px;border-width:2px;border-radius:9px;}
  .uno-card.colorless{background:
    conic-gradient(from 45deg,#F04646 0 25%,#F0E246 0 50%,#5DF046 0 75%,#4C46F0 0);}
  /* number face: a clean untilted white oval + a big crisp digit */
  .uno-face-num{width:72%;height:80%;border-radius:50%/40%;background:#fff;
    display:flex;align-items:center;justify-content:center;}
  .uno-big{font-family:"Bebas Neue","Arial Narrow",sans-serif;color:var(--c);
    font-size:3rem;line-height:1;}
  .uno-card.small .uno-big{font-size:1.95rem;}
  .uno-corner{position:absolute;font-family:"Bebas Neue","Arial Narrow",sans-serif;color:#fff;
    font-size:1.15rem;line-height:1;}
  .uno-card.small .uno-corner{font-size:.75rem;}
  .uno-corner.tl{top:5px;left:8px;} .uno-corner.br{bottom:5px;right:8px;transform:rotate(180deg);}
  /* symbol face: one BIG centered symbol with a soft backing panel */
  .uno-symwrap{position:relative;width:90%;height:90%;display:flex;align-items:center;justify-content:center;}
  .uno-symwrap::before{content:"";position:absolute;width:96%;height:74%;border-radius:16px;
    background:rgba(255,255,255,.18);}
  .uno-card.colorless .uno-symwrap::before{background:rgba(12,12,20,.55);}
  .uno-sym{max-width:94%;max-height:94%;object-fit:contain;position:relative;z-index:2;}
  .uno-fallback{position:absolute;z-index:1;font-family:"Bebas Neue","Arial Narrow",sans-serif;
    font-weight:700;color:#fff;font-size:1.5rem;line-height:1;text-align:center;
    text-shadow:0 1px 2px rgba(0,0,0,.55);}
  .uno-card.small .uno-fallback{font-size:.95rem;}
  .uno-card.back{background:#12203f;}
  .uno-back-img{width:100%;height:100%;object-fit:cover;}
  .uno-card.back.noimg{background:repeating-linear-gradient(45deg,#26325a,#26325a 8px,#1b2547 8px,#1b2547 16px);}
  /* selectable (player hand) */
  .uno-card.sel{cursor:pointer;transition:transform .12s,box-shadow .12s;}
  .uno-card.sel:hover{transform:translateY(-8px);}
  .uno-card.on{outline:4px solid #fff;transform:translateY(-14px);box-shadow:0 10px 20px rgba(0,0,0,.5);}
  .uno-card.dim{opacity:.42;filter:grayscale(.4);}
  /* --- table (host) --- */
  .uno-table{display:flex;flex-direction:column;align-items:center;gap:14px;}
  .uno-center{display:flex;align-items:center;gap:26px;justify-content:center;flex-wrap:wrap;}
  .uno-pile{display:flex;flex-direction:column;align-items:center;gap:6px;}
  .uno-pile-label{font-size:.75rem;opacity:.7;letter-spacing:.08em;text-transform:uppercase;}
  .uno-colorchip{display:inline-flex;align-items:center;gap:8px;padding:6px 14px;border-radius:999px;
    background:rgba(255,255,255,.08);font-weight:600;}
  .uno-dot{width:16px;height:16px;border-radius:50%;display:inline-block;border:2px solid rgba(255,255,255,.6);}
  .uno-pending{background:#F04646;color:#fff;padding:6px 14px;border-radius:999px;font-weight:700;}
  .uno-seats{display:flex;flex-wrap:wrap;gap:10px;justify-content:center;margin-top:8px;}
  .uno-seat{display:flex;align-items:center;gap:10px;padding:10px 14px;border-radius:14px;
    background:rgba(255,255,255,.06);min-width:150px;}
  .uno-seat.turn{background:linear-gradient(135deg,var(--primary),var(--secondary));box-shadow:0 0 0 2px #fff;}
  .uno-seat.off{opacity:.5;}
  .uno-seat-name{font-weight:700;}
  .uno-seat-meta{font-size:.8rem;opacity:.85;}
  .uno-mini{display:flex;gap:3px;}
  .uno-mini .m{width:12px;height:18px;border-radius:3px;background:#26325a;border:1px solid rgba(255,255,255,.25);}
  .uno-dir{font-size:1.4rem;}
  .uno-said{color:#F0E246;font-weight:700;}
  /* --- buttons / bars --- */
  .uno-btn{font-family:inherit;font-size:1rem;font-weight:700;color:#fff;border:none;cursor:pointer;
    padding:12px 22px;border-radius:12px;background:linear-gradient(135deg,var(--primary),var(--secondary));
    box-shadow:0 4px 12px rgba(0,0,0,.3);}
  .uno-btn:disabled{opacity:.45;cursor:default;}
  .uno-btn.ghost{background:rgba(255,255,255,.12);}
  .uno-btn.warn{background:linear-gradient(135deg,#F0A020,#F04646);}
  .uno-actions{position:fixed;left:0;right:0;bottom:0;padding:12px;display:flex;gap:10px;
    justify-content:center;background:linear-gradient(rgba(0,0,0,0),rgba(0,0,0,.55));z-index:5;}
  .uno-hand{display:flex;flex-wrap:wrap;gap:8px;justify-content:center;margin-top:10px;}
  .uno-cheatbar{display:flex;flex-wrap:wrap;gap:8px;justify-content:center;margin-top:18px;}
  .uno-cheat{font-family:inherit;cursor:pointer;border:1px solid rgba(255,255,255,.25);
    background:rgba(255,255,255,.07);color:var(--text);padding:8px 12px;border-radius:10px;font-size:.85rem;}
  .uno-cheatbar-title{width:100%;text-align:center;font-size:.75rem;opacity:.6;letter-spacing:.1em;text-transform:uppercase;}
  /* --- settings vote --- */
  .uno-rules{display:flex;flex-direction:column;gap:10px;max-width:520px;margin:0 auto;}
  .uno-rule{background:rgba(255,255,255,.06);border-radius:14px;padding:12px 16px;}
  .uno-rule h3{margin:0 0 2px;font-size:1.05rem;}
  .uno-rule p{margin:0 0 8px;font-size:.85rem;opacity:.78;}
  .uno-rule-row{display:flex;gap:8px;align-items:center;}
  .uno-set-btn{flex:1;font-family:inherit;cursor:pointer;border:2px solid rgba(255,255,255,.2);
    background:rgba(255,255,255,.05);color:var(--text);padding:10px;border-radius:10px;font-weight:600;}
  .uno-set-btn.on{background:linear-gradient(135deg,var(--primary),var(--secondary));border-color:#fff;}
  .uno-tally{font-size:.78rem;opacity:.7;white-space:nowrap;}
  .uno-overlay{position:fixed;inset:0;background:rgba(0,0,0,.55);display:none;align-items:center;
    justify-content:center;z-index:20;padding:16px;}
  .uno-overlay.show{display:flex;}
  .uno-sheet{background:#141a2e;border:1px solid rgba(255,255,255,.15);border-radius:18px;
    padding:22px;max-width:520px;width:100%;text-align:center;}
  .uno-pick{display:flex;gap:12px;justify-content:center;flex-wrap:wrap;margin-top:12px;}
  .uno-swatch{width:70px;height:70px;border-radius:14px;border:3px solid rgba(255,255,255,.85);cursor:pointer;}
  .uno-win{font-family:"Bebas Neue",sans-serif;font-size:2.6rem;text-align:center;}
  .uno-toast{position:fixed;top:14px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,.8);
    color:#fff;padding:10px 18px;border-radius:999px;z-index:30;font-weight:600;opacity:0;
    transition:opacity .25s;pointer-events:none;}
  .uno-toast.show{opacity:1;}
  /* ===== Cascade host TABLE view (playing phase) ===== */
  /* Break out of the page's narrow centered column to use the FULL viewport width. */
  .cscd-stage{position:relative;width:100vw;left:50%;margin-left:-50vw;min-height:calc(100vh - 8px);
    overflow:hidden;--pod:154px;
    background:
      linear-gradient(rgba(6,10,26,.30),rgba(4,7,20,.72)),
      url("/games/cascade/img/fond.jpg"),
      radial-gradient(circle at 50% 34%, #263a7a 0%, #101a3e 52%, #05070f 100%);
    background-size:cover;background-position:center;background-repeat:no-repeat;}
  .cscd-top{position:absolute;top:12px;left:0;right:0;z-index:5;display:flex;justify-content:center;
    gap:10px;align-items:center;flex-wrap:wrap;pointer-events:none;}
  .cscd-title{font-family:"Bebas Neue","Arial Narrow",sans-serif;font-size:1.8rem;letter-spacing:.02em;
    text-shadow:0 2px 6px rgba(0,0,0,.7);}
  .cscd-chip{background:rgba(0,0,0,.42);border:1px solid rgba(255,255,255,.16);border-radius:999px;
    padding:5px 13px;font-weight:700;display:inline-flex;align-items:center;gap:7px;font-size:.9rem;}
  /* the felt table */
  .cscd-table{position:absolute;left:50%;top:48%;transform:translate(-50%,-50%);
    width:min(70vw,780px);height:min(56vh,520px);border-radius:50%;
    background:radial-gradient(circle at 50% 38%, #2a7d55 0%, #17603c 68%, #0f4429 100%);
    box-shadow:inset 0 0 70px rgba(0,0,0,.55),0 24px 70px rgba(0,0,0,.55);border:11px solid #2c1c13;}
  .cscd-table::after{content:"";position:absolute;inset:16px;border-radius:50%;
    border:2px dashed rgba(255,255,255,.10);pointer-events:none;}
  /* center piles */
  .cscd-center{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);z-index:2;
    display:flex;flex-direction:column;align-items:center;gap:9px;}
  .cscd-piles{display:flex;align-items:center;gap:16px;}
  .cscd-pile{display:flex;flex-direction:column;align-items:center;gap:4px;}
  .cscd-pile .lbl{font-size:.66rem;letter-spacing:.09em;text-transform:uppercase;opacity:.8;}
  .cscd-info{display:flex;align-items:center;gap:9px;flex-wrap:wrap;justify-content:center;}
  .cscd-pending{background:#F04646;color:#fff;padding:4px 13px;border-radius:999px;font-weight:800;}
  /* a player pod, absolutely placed on the ring */
  .cscd-pod{position:absolute;transform:translate(-50%,-50%);z-index:3;width:calc(var(--pod));
    text-align:center;transition:opacity .2s;}
  .cscd-av{width:calc(var(--pod)*.44);height:calc(var(--pod)*.44);border-radius:50%;margin:0 auto;
    display:flex;align-items:center;justify-content:center;font-size:calc(var(--pod)*.24);line-height:1;
    border:3px solid rgba(255,255,255,.85);box-shadow:0 5px 12px rgba(0,0,0,.45);}
  .cscd-pod .nm{font-weight:800;font-size:calc(var(--pod)*.115);margin-top:3px;white-space:nowrap;
    text-shadow:0 1px 3px rgba(0,0,0,.7);overflow:hidden;text-overflow:ellipsis;}
  .cscd-pod .act{font-size:calc(var(--pod)*.093);min-height:1.05em;opacity:.92;
    text-shadow:0 1px 2px rgba(0,0,0,.7);}
  .cscd-fan{position:relative;height:calc(var(--pod)*.34);margin-top:3px;}
  .cscd-fan .b{position:absolute;left:50%;bottom:0;width:calc(var(--pod)*.2);height:calc(var(--pod)*.3);
    border-radius:4px;border:1px solid rgba(255,255,255,.55);background-size:cover;background-position:center;
    background-color:#26325a;transform-origin:bottom center;}
  .cscd-cnt{display:inline-block;margin-top:3px;font-size:calc(var(--pod)*.1);font-weight:800;
    background:rgba(0,0,0,.5);border-radius:999px;padding:1px 9px;}
  .cscd-pod.turn .cscd-av{border-color:#FFD54A;box-shadow:0 0 0 4px rgba(255,213,74,.45),0 0 24px rgba(255,213,74,.7);}
  .cscd-pod.off{opacity:.42;}
  .cscd-uno{color:#FFD54A;font-weight:900;}
  .cscd-cheatwrap{position:absolute;left:0;right:0;bottom:10px;z-index:5;}
  `;
  document.head.appendChild(st);
};

// A brief toast message (e.g. "Ce n'est pas ton tour").
window.unoToast = function (msg) {
  let t = document.getElementById("uno-toast");
  if (!t) { t = document.createElement("div"); t.id = "uno-toast"; t.className = "uno-toast"; document.body.appendChild(t); }
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.remove("show"), 1600);
};
