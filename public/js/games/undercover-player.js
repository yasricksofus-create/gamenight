// undercover-player.js -- Player-side view of Undercover (on the phone), all phases.
(function () {
  const socket = window.socket;
  const root = document.getElementById("game-root");
  let card = null;       // my private card (uc:you)
  let state = null;      // shared public state
  let votedRound = -1;   // round I already voted in
  let myVote = { mode: null, mrWhite: null }; // my settings choices (local)

  socket.on("uc:you", (c) => { card = c; render(); });
  socket.on("uc:state", (s) => { state = s; if (s.themeKey) applyUcTheme(s.themeKey); render(); });
  socket.on("uc:voted", () => { votedRound = state ? state.round : votedRound; render(); });

  function send(type, payload) { socket.emit("game:action", { type, payload }); }
  function myEntry() { return state ? state.order.find((p) => p.id === socket.id) : null; }

  function render() {
    if (!state) return;
    const s = state;

    // Settings vote phase happens BEFORE cards are dealt.
    if (s.phase === "settings") { root.innerHTML = settingsHtml(s); wireSettings(s); return; }
    if (!card) return; // cards not dealt yet

    let html = cardHtml();
    const me = myEntry();
    const alive = me ? me.alive : false;

    if (s.phase === "distribution") {
      html += `<p class="uc-wait">Memorise ta carte. En attente du host…</p>`;
    } else if (s.phase === "clues") {
      html += `<p class="uc-wait">Ecoute, et donne ton indice a l'oral a ton tour.</p>`;
    } else if (s.phase === "vote") {
      if (!alive) html += `<p class="uc-wait">Tu es elimine — tu observes le vote.</p>`;
      else if (votedRound === s.round) html += `<p class="uc-wait">Vote enregistre. En attente…</p>`;
      else html += voteButtons(s);
    } else if (s.phase === "mrwhite") {
      if (s.mrwhite && s.mrwhite.id === socket.id) {
        html += `<p class="uc-wait">Tu es demasque ! Devine le mot des civils :</p>
          <div class="uc-guess"><input id="uc-guess-input" placeholder="ton mot…" autocomplete="off" />
          <button id="uc-guess-btn" class="uc-btn">Proposer</button></div>`;
      } else {
        html += `<p class="uc-wait"><strong>${s.mrwhite ? s.mrwhite.name : "?"}</strong> etait Mr. White ! Il tente de deviner le mot…</p>`;
      }
    } else if (s.phase === "reveal") {
      if (s.mrwhiteGuessResult) {
        html += `<p class="uc-wait">Mr. White : « ${s.mrwhiteGuessResult.guess} » — ${s.mrwhiteGuessResult.correct ? "correct !" : "rate."}</p>`;
      } else {
        const e = s.lastEliminated;
        html += `<p class="uc-wait">${e ? e.name + " est elimine (" + ucRoleLabel(e.role) + ")." : "Personne n'est elimine."}</p>`;
      }
    } else if (s.phase === "ended") {
      const won = (s.winner === "civils" && card.role === "civil")
        || (s.winner === "impostors" && (card.role === "undercover" || card.role === "mrwhite"));
      html += `<p class="uc-result">${won ? "🎉 Ton camp gagne !" : "😖 Ton camp perd."}</p>`;
    }

    root.innerHTML = html;
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
      <h1 class="uc-title">Vos reglages</h1>
      <p class="uc-wait">Choisis le mode :</p>
      <div class="uc-vote-list">${modeBtns}</div>${mr}`;
  }
  function wireSettings(s) {
    root.querySelectorAll("[data-mode]").forEach((b) => {
      b.onclick = () => { myVote.mode = b.getAttribute("data-mode"); send("voteSetting", { key: "mode", value: myVote.mode }); render(); };
    });
    root.querySelectorAll("[data-mr]").forEach((b) => {
      b.onclick = () => { myVote.mrWhite = b.getAttribute("data-mr") === "yes"; send("voteSetting", { key: "mrWhite", value: myVote.mrWhite }); render(); };
    });
  }

  function cardHtml() {
    if (card.kind === "mrwhite") {
      return `<div class="uc-card under">
        <span class="uc-stamp">${card.roleLabel}</span>
        <span class="uc-word">?</span>
        <span class="uc-card-hint">Tu n'as pas de mot. Bluffe : ecoute et fais comme si tu savais.</span>
      </div>`;
    }
    if (card.kind === "character") {
      const c = card.character;
      return `<div class="uc-card ${card.role === "undercover" ? "under" : "civil"}">
        <span class="uc-stamp">${card.roleLabel}</span>
        <img id="uc-img" class="uc-card-img" alt="" hidden />
        <span class="uc-word">${c.name}</span>
        <span class="uc-card-hint">${c.desc}</span>
      </div>`;
    }
    // word
    return `<div class="uc-card ${card.role === "undercover" ? "under" : "civil"}">
      <span class="uc-stamp">${card.roleLabel}</span>
      <span class="uc-word">${card.word}</span>
      <span class="uc-card-hint">${card.role === "undercover"
        ? "Fonds-toi dans la masse, sans te trahir."
        : "Donne des indices sur ton mot, sans le dire."}</span>
    </div>`;
  }

  function voteButtons(s) {
    const btns = s.order.filter((p) => p.alive && p.id !== socket.id)
      .map((p) => `<button id="vote-${p.id}" class="uc-vote-btn">${p.name}</button>`).join("");
    return `<p class="uc-wait">Qui est l'imposteur ? Vote :</p><div class="uc-vote-list">${btns}</div>`;
  }

  function afterRender(s, alive) {
    // Load the character image (if any) once the card is in the DOM.
    if (card && card.kind === "character") {
      const img = document.getElementById("uc-img");
      if (img) {
        ucAnimeImage(card.character.name).then((url) => {
          if (url) { img.src = url; img.hidden = false; }
        });
      }
    }
    // Wire vote buttons
    if (s.phase === "vote" && alive && votedRound !== s.round) {
      s.order.filter((p) => p.alive && p.id !== socket.id).forEach((p) => {
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
