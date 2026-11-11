// undercover-player.js -- Player-side view of Undercover (on the phone), all phases.
(function () {
  // Player names and typed text are put in the page as TEXT, never as HTML
  // (otherwise a name like "<img onerror=...>" would run code on other screens).
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const socket = window.socket;
  const root = document.getElementById("game-root");
  let card = null;       // my private card (uc:you)
  let state = null;      // shared public state
  let votedSeq = -1;     // the vote I already voted in (a revote = a new number)
  let myVote = { mode: null, mrWhite: null }; // my settings choices (local)
  let rated = { key: null, up: null };          // my 👍/👎 on the pair of the game
  let leftMsg = "";                             // one-time notice (my vote target left)
  let allCards = null;                          // every card, once I am eliminated
  let buzzKey = "";                             // what I last vibrated for
  let note = "";                                // one-line notice (proposal answers)

  socket.on("uc:you", (c) => { card = c; render(); });
  socket.on("uc:state", (s) => { state = s; if (s.themeKey) applyUcTheme(s.themeKey); render(); });
  socket.on("uc:voted", () => { votedSeq = state ? state.voteSeq : votedSeq; render(); });
  // the player I voted for left: my vote no longer counts, I vote again
  socket.on("uc:revote", ({ name }) => { votedSeq = -1; leftMsg = esc(name) + " est parti : vote à nouveau."; render(); });
  socket.on("uc:allCards", (list) => { allCards = list; render(); });
  socket.on("uc:proposed", ({ a, b }) => { note = "Paire envoyée au host : " + esc(a) + " / " + esc(b); render(); });
  socket.on("uc:proposalAnswer", ({ a, b, ok }) => { note = (ok ? "✓ Le host a ajouté ta paire " : "✕ Le host n'a pas gardé ta paire ") + esc(a) + " / " + esc(b); render(); });

  function send(type, payload) { socket.emit("game:action", { type, payload }); }
  function myEntry() { return state ? state.order.find((p) => p.id === window.mySeatId) : null; }

  // The screen is redrawn at every update: what you were typing (a pair, Mr.
  // White's guess), the cursor and the open/closed panels are kept across it.
  function keepTyping(draw) {
    const vals = {}, opens = {};
    root.querySelectorAll("input[id], select[id]").forEach((x) => (vals[x.id] = x.value));
    root.querySelectorAll("details[class]").forEach((d) => (opens[d.className] = d.open));
    const a = document.activeElement, focusId = a && root.contains(a) ? a.id : null;
    const sel = a && "selectionStart" in a ? [a.selectionStart, a.selectionEnd] : null;
    draw();
    Object.keys(vals).forEach((id) => { const x = document.getElementById(id); if (x && vals[id]) x.value = vals[id]; });
    root.querySelectorAll("details[class]").forEach((d) => { if (d.className in opens) d.open = opens[d.className]; });
    if (focusId) { const x = document.getElementById(focusId); if (x) { x.focus(); if (sel && x.setSelectionRange) try { x.setSelectionRange(sel[0], sel[1]); } catch (e) {} } }
  }

  function render() { keepTyping(draw); }
  function draw() {
    if (!state) return;
    const s = state;

    // Settings vote phase happens BEFORE cards are dealt.
    if (s.phase === "settings") {
      allCards = null;
      root.innerHTML = settingsHtml(s) + proposeHtml() + (note ? `<p class="uc-notice">${note}</p>` : "");
      wireSettings(s); wirePropose(); return;
    }
    if (!card) return; // cards not dealt yet

    let html = cardHtml();
    if (leftMsg && s.phase === "vote") html += `<p class="uc-notice">${leftMsg}</p>`;
    else leftMsg = "";
    if (s.lastLeft && Date.now() - s.lastLeft.at < 20000) html += `<p class="uc-notice">${esc(s.lastLeft.name)} a quitté la partie.</p>`;
    const me = myEntry();
    const alive = me ? me.alive : false;

    if (s.phase === "distribution") {
      html += `<p class="uc-wait">Mémorise ta carte. En attente du host…</p>`;
    } else if (s.phase === "clues") {
      const myTurn = s.speaker === window.mySeatId;
      if (myTurn) {
        html += `<p class="uc-turn-me">🎤 C'est ton tour ! Donne ton indice à l'oral.</p>`;
        buzz("turn" + s.round + "-" + s.speaker, [120, 60, 120]);
      } else {
        const sp = s.order.find((p) => p.id === s.speaker);
        html += `<p class="uc-wait">${sp ? "C'est au tour de <strong>" + esc(sp.name) + "</strong>." : "Écoute, et donne ton indice à l'oral à ton tour."}</p>`;
      }
      if (s.debateEndsAt) html += `<p class="uc-wait">Débat en cours, le vote s'ouvre tout seul.</p>`;
    } else if (s.phase === "defense" && s.defense) {
      html += s.defense.id === window.mySeatId
        ? `<p class="uc-turn-me">⚖️ Tu es désigné ! Tu as 10 secondes pour te défendre à l'oral.</p>`
        : `<p class="uc-wait"><strong>${esc(s.defense.name)}</strong> se défend… le host décide ensuite.</p>`;
      if (s.defense.id === window.mySeatId) buzz("def" + s.round + s.voteSeq, [200, 80, 200]);
    } else if (s.phase === "vote") {
      buzz("vote" + s.voteSeq, 90); // the vote is open
      if (s.publicVotes && s.publicVotes.length) html += `<p class="uc-wait">${s.publicVotes.map(([a, b]) => esc(a) + " → " + esc(b)).join(" · ")}</p>`;
      if (!alive) html += `<p class="uc-wait">Tu es éliminé — tu observes le vote.</p>`;
      else if (votedSeq === s.voteSeq) html += `<p class="uc-wait">Vote enregistré. En attente…</p>`;
      else html += voteButtons(s);
    } else if (s.phase === "mrwhite") {
      if (s.mrwhite && s.mrwhite.id === window.mySeatId) {
        html += `<p class="uc-wait">Tu es démasqué ! Devine le mot des civils :</p>
          <div class="uc-guess"><input id="uc-guess-input" placeholder="ton mot…" autocomplete="off" />
          <button id="uc-guess-btn" class="uc-btn">Proposer</button></div>`;
      } else {
        html += `<p class="uc-wait"><strong>${s.mrwhite ? esc(s.mrwhite.name) : "?"}</strong> était Mr. White ! Il tente de deviner le mot…</p>`;
      }
    } else if (s.phase === "reveal") {
      if (s.mrwhiteGuessResult) {
        html += s.mrwhiteGuessResult.left
          ? `<p class="uc-wait">Mr. White a quitté la partie sans deviner.</p>`
          : `<p class="uc-wait">Mr. White : « ${esc(s.mrwhiteGuessResult.guess)} » — ${s.mrwhiteGuessResult.correct ? "correct !" : "raté."}</p>`;
      } else {
        const e = s.lastEliminated;
        html += `<p class="uc-wait">${e ? esc(e.name) + " est éliminé (" + ucRoleLabel(e.role) + ")." : "Personne n'est éliminé."}</p>`;
      }
    } else if (s.phase === "ended") {
      // Roles are only revealed now (finalRoles). Find mine to know if I won.
      const mine = (s.finalRoles || []).find((r) => r.id === window.mySeatId);
      const myRole = mine ? mine.role : null;
      const won = (s.winner === "civils" && myRole === "civil")
        || (s.winner === "impostors" && (myRole === "undercover" || myRole === "mrwhite"));
      html += `<p class="uc-result">${won ? "🎉 Ton camp gagne !" : "😖 Ton camp perd."}</p>`;
      // rate the pair: helps remove the bad ones (it is NOT about who won)
      const p = s.pair || {};
      const a = p.kind === "word" ? p.civil : p.civil && p.civil.name;
      const b = p.kind === "word" ? p.undercover : p.undercover && p.undercover.name;
      if (a && b) {
        if (rated.key !== p.key) rated = { key: p.key, up: null };
        html += `<div class="uc-rate"><p class="uc-wait">La paire <strong>${esc(a)}</strong> / <strong>${esc(b)}</strong> était…</p>
          <div class="uc-rate-btns"><button class="uc-btn${rated.up === true ? " on" : ""}" data-rate="1">👍 Bien trouvée</button>
          <button class="uc-btn${rated.up === false ? " on" : ""}" data-rate="0">👎 Pas terrible</button></div></div>`;
      }
      html += proposeHtml();
    }
    // eliminated: I see every card (the show goes on)
    if (allCards && !alive && s.phase !== "ended") {
      html += `<details class="uc-all" open><summary>Tu es éliminé : voici les cartes de tout le monde</summary><ul class="uc-order">${allCards.map((c) =>
        `<li class="uc-player${c.alive ? "" : " out"}">${esc(c.name)} — <b>${esc(c.role)}</b>${c.card && c.card.kind === "word" ? " : " + esc(c.card.word) : c.card && c.card.kind === "character" ? " : " + esc(c.card.character.name) : ""}</li>`).join("")}</ul></details>`;
    }
    if (note) html += `<p class="uc-notice">${note}</p>`;

    root.innerHTML = html;
    wirePropose();
    root.querySelectorAll("[data-rate]").forEach((b) => (b.onclick = () => {
      rated.up = b.getAttribute("data-rate") === "1";
      root.querySelectorAll("[data-rate]").forEach((x) => x.classList.toggle("on", x === b));
      send("ratePair", { up: rated.up });
    }));
    afterRender(s, alive);
  }

  // ----- pieces -----
  function settingsHtml(s) {
    const modeBtns = s.modes.map((m) =>
      `<button class="uc-set-btn${myVote.mode === m.key ? " on" : ""}" data-mode="${m.key}">${m.label}</button>`).join("");
    let mr = "";
    if (s.mrWhiteAllowed) {
      mr = `<p class="uc-wait">Ajouter Mr. White ?</p>
        <div class="uc-vote-list">
          <button class="uc-set-btn${myVote.mrWhite === true ? " on" : ""}" data-mr="yes">Oui</button>
          <button class="uc-set-btn${myVote.mrWhite === false ? " on" : ""}" data-mr="no">Non</button>
        </div>`;
    }
    return `<p class="uc-eyebrow">Mise en place</p>
      <h1 class="uc-title">Vos réglages</h1>
      <p class="uc-wait">Choisis le mode :</p>
      <div class="uc-vote-list">${modeBtns}</div>${mr}
      <button id="uc-howto-btn" class="uc-btn ghost" type="button">Comment jouer ?</button>`;
  }
  // "Proposer une paire": sent to the host, who adds it (or not) to the game.
  function proposeHtml() {
    return `<details class="uc-propose"><summary>💡 Proposer une paire</summary>
      <form id="uc-propose-form" class="uc-guess">
        <input id="uc-pa" maxlength="40" placeholder="Mot ou perso 1" aria-label="Premier mot ou perso" autocomplete="off">
        <input id="uc-pb" maxlength="40" placeholder="Mot ou perso 2" aria-label="Deuxième mot ou perso" autocomplete="off">
        <select id="uc-pk" aria-label="Type de paire"><option value="word">Mots</option><option value="character">Persos d'anime</option></select>
        <button class="uc-btn" type="submit">Envoyer</button></form></details>`;
  }
  function wirePropose() {
    const f = document.getElementById("uc-propose-form");
    const hb = document.getElementById("uc-howto-btn");
    if (hb) hb.onclick = () => ucHowTo();
    if (!f) return;
    f.onsubmit = (e) => {
      e.preventDefault();
      const a = document.getElementById("uc-pa").value.trim(), b = document.getElementById("uc-pb").value.trim();
      if (!a || !b) return;
      send("proposePair", { a, b, kind: document.getElementById("uc-pk").value });
      document.getElementById("uc-pa").value = ""; document.getElementById("uc-pb").value = "";
    };
  }
  function buzz(key, pattern) { if (buzzKey !== key) { buzzKey = key; ucBuzz(pattern); } }
  function wireSettings(s) {
    root.querySelectorAll("[data-mode]").forEach((b) => {
      b.onclick = () => { myVote.mode = b.getAttribute("data-mode"); send("voteSetting", { key: "mode", value: myVote.mode }); render(); };
    });
    root.querySelectorAll("[data-mr]").forEach((b) => {
      b.onclick = () => { myVote.mrWhite = b.getAttribute("data-mr") === "yes"; send("voteSetting", { key: "mrWhite", value: myVote.mrWhite }); render(); };
    });
  }

  // Mr. White knows he has no word. Civils and the undercover get an IDENTICAL
  // card (same label, same hint, same style): the undercover must not be able to
  // tell he is the undercover.
  function cardHtml() {
    if (card.kind === "mrwhite") {
      return `<div class="uc-card">
        <span class="uc-stamp">Mr. White</span>
        <span class="uc-word">?</span>
        <span class="uc-card-hint">Tu n'as pas de mot. Bluffe : écoute et fais comme si tu savais.</span>
      </div>`;
    }
    if (card.kind === "character") {
      const c = card.character;
      return `<div class="uc-card">
        <span class="uc-stamp">Voici ta carte</span>
        <img id="uc-img" class="uc-card-img" alt="" hidden />
        <span class="uc-word">${esc(c.name)}</span>
        <span class="uc-card-hint">${esc(c.desc)}</span>
      </div>`;
    }
    // word
    return `<div class="uc-card">
      <span class="uc-stamp">Voici ta carte</span>
      <span class="uc-word">${esc(card.word)}</span>
      <span class="uc-card-hint">Donne des indices sur ton mot, sans le dire ni être trop évident.</span>
    </div>`;
  }

  function voteButtons(s) {
    const tieIds = s.tie ? s.tie.map((t) => t.id) : null;
    const btns = s.order.filter((p) => p.alive && p.id !== window.mySeatId && (!tieIds || tieIds.includes(p.id)))
      .map((p) => `<button id="vote-${p.id}" class="uc-vote-btn">${window.PixelAvatar && p.avatar ? `<img class="px-av" src="${PixelAvatar.url(p.avatar)}" width="26" height="26" alt=""> ` : ""}${esc(p.name)}</button>`).join("");
    const title = s.tie ? `Égalité ! Revote entre ${s.tie.map((t) => esc(t.name)).join(" et ")} :` : "Qui est l'imposteur ? Vote :";
    return `<p class="uc-wait">${title}</p><div class="uc-vote-list">${btns}</div>`;
  }

  function afterRender(s, alive) {
    // Load the character image (if any) once the card is in the DOM.
    if (card && card.kind === "character") {
      const img = document.getElementById("uc-img");
      if (img) {
        ucAnimeImage(card.character.name, card.character.series).then((url) => {
          if (url) { img.src = url; img.hidden = false; }
        });
      }
    }
    // Wire vote buttons
    if (s.phase === "vote" && alive && votedSeq !== s.voteSeq) {
      s.order.filter((p) => p.alive && p.id !== window.mySeatId).forEach((p) => {
        const b = document.getElementById("vote-" + p.id);
        if (b) b.onclick = () => send("vote", { targetId: p.id });
      });
    }
    // Wire Mr. White guess
    const gb = document.getElementById("uc-guess-btn");
    if (gb) gb.onclick = () => {
      const val = document.getElementById("uc-guess-input").value;
      if (val && val.trim()) send("mrwhiteGuess", { word: val.trim() });
    };
  }
})();
