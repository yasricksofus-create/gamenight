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
  .uno-sym{max-width:94%;max-height:94%;object-fit:contain;position:relative;z-index:2;
    filter:drop-shadow(0 2px 3px rgba(0,0,0,.35));}
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
