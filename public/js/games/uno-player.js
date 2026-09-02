// uno-player.js -- Player-side view of "Cascade" (on the phone).
// Shows the settings vote, then my private hand + the current table, and drives
// every action: play, draw, UNO, plus the awaited sub-steps (choose color, pay
// target, flush 3 cards, use protection, stack-or-take, play the drawn card).
(function () {
  const socket = window.socket;
  const root = document.getElementById("game-root");
  let state = null;      // public table (uno:state)
  let hand = [];         // my private hand (uno:hand)
  let you = { yourTurn: false, awaiting: null }; // uno:you
  let myVote = {};       // my local settings choices
  let flushSel = [];     // card ids selected during a flush
  unoInjectStyles();

  socket.on("uno:state", (s) => { state = s; if (s.phase !== "playing") flushSel = []; render(); });
  socket.on("uno:hand", (d) => { hand = d.hand || []; render(); });
  socket.on("uno:you", (d) => { you = d || { yourTurn: false, awaiting: null }; render(); });

  function send(type, payload) { socket.emit("game:action", { type, payload }); }
  const me = () => window.mySeatId;

  // Mirror of the server's playable() so the hand can hint what's legal.
  function playable(c) {
    if (!state) return false;
    if (c.color === null || c.color === undefined) return true;
    if (c.color === state.activeColor) return true;
    const top = state.top;
    if (c.kind === "number") return top.kind === "number" && c.value === top.value;
    return c.kind === top.kind;
  }
  function identical(c) {
    const t = state && state.top;
    return t && c.kind === t.kind && c.color === t.color && c.value === t.value;
  }

  const RULES = [
    { key: "cumul", name: "Cumul des pioches", desc: "Empiler +2 sur +2 (ou +4 sur +4)." },
    { key: "jumpin", name: "Jump-in", desc: "Jouer hors tour une carte identique au dessus." },
    { key: "drawUntil", name: "Pioche jusqu'a jouable", desc: "Piocher jusqu'a avoir une carte jouable." },
    { key: "customs", name: "Cartes maison", desc: "Ajouter Flush, Pay, +1, Copie, Protection." },
  ];

  function render() {
    if (!state) return;
    const s = state;
    if (s.phase === "settings") return renderSettings(s);
    if (s.phase === "ended") return renderEnded(s);
    if (s.phase !== "playing") { root.innerHTML = ""; return; }

    const aw = you.awaiting;
    let html = `<div class="uno-wrap">${miniTable(s)}`;

    // Awaited sub-steps take over the action area.
    if (aw && aw.type === "color") html += colorPicker();
    else if (aw && aw.type === "pay-target") html += payPicker(s);
    else if (aw && aw.type === "protect") html += protectPrompt(aw);
    else if (aw && aw.type === "play-drawn") html += playDrawnPrompt(aw);
    else if (aw && aw.type === "flush") html += flushHint();
    else if (aw && aw.type === "stack-or-take") html += stackHint(aw);
    else html += turnHint(s);

    html += handHtml(s, aw);
    html += denounceBar(s);
    html += `</div>`;
    html += actionBar(s, aw);

    root.innerHTML = html;
    wire(s, aw);
  }

  // ---------- settings vote ----------
  function renderSettings(s) {
    const rows = RULES.map((r) => {
      const on = myVote[r.key];
      const c = (s.counts && s.counts[r.key]) || [0, 0];
      return `<div class="uno-rule"><h3>${r.name}</h3><p>${r.desc}</p>
        <div class="uno-rule-row">
          <button class="uno-set-btn${on === true ? " on" : ""}" data-k="${r.key}" data-v="1">Pour</button>
          <button class="uno-set-btn${on === false ? " on" : ""}" data-k="${r.key}" data-v="0">Contre</button>
          <span class="uno-tally">${c[0]}/${c[1]}</span>
        </div></div>`;
    }).join("");
    root.innerHTML = `<div class="uno-wrap"><p class="uno-eyebrow">Mise en place</p>
      <h1 class="uno-title">Vote des regles</h1>
      <p class="uno-sub">Choisis Pour ou Contre chaque regle. La majorite decide.</p>
      <div class="uno-rules">${rows}</div></div>`;
    root.querySelectorAll("[data-k]").forEach((b) => {
      b.onclick = () => {
        const k = b.getAttribute("data-k"); const v = b.getAttribute("data-v") === "1";
        myVote[k] = v; send("voteSetting", { key: k, value: v }); render();
      };
    });
  }

  // ---------- table summary (top of the phone) ----------
  function miniTable(s) {
    const turnP = s.players.find((p) => p.id === s.turn);
    const cn = UNO_COLOR_NAMES[s.activeColor] || "—";
    const pending = s.pendingDraw > 0 ? `<span class="uno-pending">+${s.pendingDraw}</span>` : "";
    return `<div class="uno-center" style="gap:14px;margin-bottom:6px">
      <div class="uno-pile"><span class="uno-pile-label">Dessus</span>${unoCardHtml(s.top, { small: true })}</div>
      <div class="uno-pile"><span class="uno-colorchip">${unoDot(s.activeColor)} ${cn}</span>
        <span class="uno-pile-label">Sens ${s.dir === 1 ? "↻" : "↺"}</span>${pending}</div>
      <div class="uno-pile"><span class="uno-pile-label">Tour</span><strong>${turnP ? turnP.name : "?"}</strong></div>
    </div>`;
  }

  function turnHint(s) {
    if (you.yourTurn) return `<p class="uno-sub"><strong>A toi de jouer.</strong> Touche une carte jouable, ou pioche.</p>`;
    const jump = s.rules && s.rules.jumpin
      ? " Tu peux jouer une carte STRICTEMENT identique au dessus (jump-in)." : "";
    return `<p class="uno-sub">En attente des autres…${jump}</p>`;
  }

  // ---------- hand ----------
  function handHtml(s, aw) {
    if (!hand.length) return `<p class="uno-sub" style="text-align:center">Main vide.</p>`;
    const flushMode = aw && aw.type === "flush";
    const cards = hand.map((c) => {
      let ok, selected = false;
      if (flushMode) { ok = true; selected = flushSel.includes(c.id); }
      else if (aw && aw.type === "stack-or-take") ok = c.kind === aw.ptype;
      else if (you.yourTurn && !aw) ok = s.pendingDraw > 0 ? (s.rules.cumul && c.kind === s.pendingType) : playable(c);
      else if (!you.yourTurn && s.rules && s.rules.jumpin && !aw) ok = identical(c);
      else ok = false;
      return unoCardHtml(c, { selectable: true, selected, playable: ok });
    }).join("");
    return `<div class="uno-hand">${cards}</div>`;
  }

  // ---------- awaited sub-steps ----------
  function colorPicker() {
    const sw = ["R", "J", "V", "B"].map((k) =>
      `<div class="uno-swatch" data-color="${k}" style="background:${UNO_COLORS[k]}" title="${UNO_COLOR_NAMES[k]}"></div>`).join("");
    return `<p class="uno-sub"><strong>Choisis la couleur active :</strong></p><div class="uno-pick">${sw}</div>`;
  }
  function payPicker(s) {
    const btns = s.players.filter((p) => p.id !== me())
      .map((p) => `<button class="uno-btn ghost" data-pay="${p.id}">${p.name}</button>`).join("");
    return `<p class="uno-sub"><strong>Pay :</strong> qui doit piocher 1 carte ?</p><div class="uno-pick">${btns}</div>`;
  }
  function protectPrompt(aw) {
    return `<p class="uno-sub"><strong>Attaque : +${aw.amount}.</strong> Utiliser ta Protection pour l'annuler ?</p>
      <div class="uno-pick"><button class="uno-btn" data-protect="1">🛡 Utiliser</button>
      <button class="uno-btn ghost" data-protect="0">Piocher +${aw.amount}</button></div>`;
  }
  function playDrawnPrompt(aw) {
    const c = hand.find((x) => x.id === aw.cardId);
    return `<p class="uno-sub"><strong>Tu as pioche</strong> ${c ? "« " + unoCardLabel(c) + " »" : "une carte"} — elle est jouable.</p>
      <div class="uno-pick"><button class="uno-btn" data-drawn="1">Jouer</button>
      <button class="uno-btn ghost" data-drawn="0">Garder</button></div>`;
  }
  function flushHint() {
    return `<p class="uno-sub"><strong>Flush :</strong> choisis les cartes a jeter (jusqu'a 3), puis confirme. Tu piocheras autant de nouvelles cartes.</p>`;
  }
  function stackHint(aw) {
    return `<p class="uno-sub"><strong>Attaque : +${aw.amount}.</strong> Empile une carte ${aw.ptype === "joker" ? "+4" : "+2"} pour la renvoyer, ou pioche.</p>`;
  }

  function denounceBar(s) {
    // Anyone else at 1 card who didn't say UNO can be denounced (+2 to them).
    const targets = s.players.filter((p) => p.id !== me() && p.count === 1 && !p.said);
    if (!targets.length) return "";
    const btns = targets.map((p) =>
      `<button class="uno-cheat" data-denounce="${p.id}">☝ Contre-UNO : ${p.name}</button>`).join("");
    return `<div class="uno-cheatbar" style="margin-top:10px">${btns}</div>`;
  }

  // ---------- bottom action bar ----------
  function actionBar(s, aw) {
    const btns = [];
    if (aw && aw.type === "flush") {
      btns.push(`<button id="uno-flush-go" class="uno-btn"${flushSel.length ? "" : " disabled"}>Defausser (${flushSel.length})</button>`);
    } else if (aw && aw.type === "stack-or-take") {
      btns.push(`<button id="uno-take" class="uno-btn warn">Piocher +${aw.amount}</button>`);
    } else if (you.yourTurn && !aw) {
      if (s.pendingDraw > 0) btns.push(`<button id="uno-draw" class="uno-btn warn">Subir +${s.pendingDraw}</button>`);
      else btns.push(`<button id="uno-draw" class="uno-btn">Piocher</button>`);
    }
    // UNO! button whenever I'm about to be at one card.
    if (hand.length <= 2) btns.push(`<button id="uno-uno" class="uno-btn ghost">UNO !</button>`);
    if (!btns.length) return "";
    return `<div class="uno-actions">${btns.join("")}</div>`;
  }

  // ---------- wiring ----------
  function wire(s, aw) {
    // Hand taps
    root.querySelectorAll(".uno-card.sel").forEach((el) => {
      const id = el.getAttribute("data-id");
      el.onclick = () => onCardTap(s, aw, id);
    });
    root.querySelectorAll("[data-color]").forEach((el) => {
      el.onclick = () => send("chooseColor", { color: el.getAttribute("data-color") });
    });
    root.querySelectorAll("[data-pay]").forEach((el) => {
      el.onclick = () => send("payTarget", { seatId: el.getAttribute("data-pay") });
    });
    root.querySelectorAll("[data-protect]").forEach((el) => {
      el.onclick = () => send("protectDecision", { use: el.getAttribute("data-protect") === "1" });
    });
    root.querySelectorAll("[data-drawn]").forEach((el) => {
      el.onclick = () => send("playDrawn", { play: el.getAttribute("data-drawn") === "1" });
    });
    root.querySelectorAll("[data-denounce]").forEach((el) => {
      el.onclick = () => send("denounce", { seatId: el.getAttribute("data-denounce") });
    });
    bind("uno-draw", () => send("draw"));
    bind("uno-take", () => send("stackTake"));
    bind("uno-uno", () => send("sayUno"));
    bind("uno-flush-go", () => {
      if (flushSel.length) { send("flushDiscard", { cardIds: flushSel.slice(0, 3) }); flushSel = []; }
    });
  }

  function onCardTap(s, aw, id) {
    const c = hand.find((x) => x.id === id);
    if (!c) return;
    if (aw && aw.type === "flush") {
      const i = flushSel.indexOf(id);
      if (i >= 0) flushSel.splice(i, 1);
      else if (flushSel.length < 3) flushSel.push(id);
      render(); return;
    }
    if (aw && aw.type === "stack-or-take") {
      if (c.kind === aw.ptype) send("play", { cardId: id });
      else unoToast("Empile une carte du meme type, ou pioche.");
      return;
    }
    if (aw) return; // other prompts ignore hand taps
    if (you.yourTurn) {
      const ok = s.pendingDraw > 0 ? (s.rules.cumul && c.kind === s.pendingType) : playable(c);
      if (ok) send("play", { cardId: id });
      else if (s.pendingDraw > 0) unoToast("Empile une carte " + (s.pendingType === "joker" ? "+4" : "+2") + ", ou pioche.");
      else unoToast("Cette carte n'est pas jouable.");
      return;
    }
    // Off turn: jump-in if allowed and strictly identical.
    if (s.rules && s.rules.jumpin && identical(c)) send("jumpin", { cardId: id });
    else unoToast("Ce n'est pas ton tour.");
  }

  function renderEnded(s) {
    const mine = s.winner === me();
    root.innerHTML = `<div class="uno-wrap" style="text-align:center">
      <p class="uno-eyebrow">Fin de la manche</p>
      <h1 class="uno-win">${mine ? "🎉 Tu as gagne !" : "Manche terminee"}</h1>
      <p class="uno-sub">${mine ? "Tu as vide ta main le premier." : "Le host peut relancer une manche."}</p></div>`;
  }

  function bind(id, fn) { const el = document.getElementById(id); if (el) el.onclick = fn; }
})();
