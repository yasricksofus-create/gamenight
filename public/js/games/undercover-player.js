// undercover-player.js -- Player-side view of the Undercover game (on the phone).
//
// Shows the player's OWN secret card (from the private uc:you message) and, at
// vote time, the buttons to vote. Reads uc:state for the shared phase/round.
(function () {
  const socket = window.socket;
  const root = document.getElementById("game-root");
  let card = null;      // my private card: {role, roleLabel, word}
  let state = null;     // the shared public state
  let votedRound = -1;  // the round number I have already voted in

  socket.on("uc:you", (c) => { card = c; render(); });
  socket.on("uc:state", (s) => { state = s; render(); });
  socket.on("uc:voted", () => { votedRound = state ? state.round : votedRound; render(); });

  function send(type, payload) {
    socket.emit("game:action", { type, payload });
  }
  function roleLabel(role) {
    return role === "undercover" ? "Undercover" : "Civil";
  }
  function myEntry() {
    return state ? state.order.find((p) => p.id === socket.id) : null;
  }

  function render() {
    if (!card || !state) return;
    const s = state;
    const me = myEntry();
    const alive = me ? me.alive : false;
    let html = cardHtml(); // always show my secret card at the top

    if (s.phase === "distribution") {
      html += `<p class="uc-wait">Memorise ton mot. En attente du host…</p>`;
    } else if (s.phase === "clues") {
      html += `<p class="uc-wait">Ecoute, et donne ton indice a l'oral quand c'est ton tour.</p>`;
    } else if (s.phase === "vote") {
      if (!alive) html += `<p class="uc-wait">Tu es elimine — tu observes le vote.</p>`;
      else if (votedRound === s.round) html += `<p class="uc-wait">Vote enregistre. En attente des autres…</p>`;
      else html += voteButtons(s);
    } else if (s.phase === "reveal") {
      const e = s.lastEliminated;
      html += `<p class="uc-wait">${e
        ? e.name + " est elimine (" + roleLabel(e.role) + ")."
        : "Personne n'est elimine cette manche."}</p>`;
    } else if (s.phase === "ended") {
      const won = s.winner === "civils" ? card.role === "civil" : card.role === "undercover";
      html += `<p class="uc-result">${won ? "🎉 Ton camp gagne !" : "😖 Ton camp perd."}</p>
        <p class="uc-wait">Civils : ${s.pair.civil} — Undercover : ${s.pair.undercover}</p>`;
    }

    root.innerHTML = html;

    if (s.phase === "vote" && alive && votedRound !== s.round) {
      s.order.filter((p) => p.alive && p.id !== socket.id).forEach((p) => {
        const b = document.getElementById("vote-" + p.id);
        if (b) b.onclick = () => send("vote", { targetId: p.id });
      });
    }
  }

  function cardHtml() {
    const isUnder = card.role === "undercover";
    return `<div class="uc-card ${isUnder ? "under" : "civil"}">
        <span class="uc-stamp">${card.roleLabel}</span>
        <span class="uc-word">${card.word}</span>
        <span class="uc-card-hint">${isUnder
          ? "Fonds-toi dans la masse : des indices plausibles, sans te trahir."
          : "Donne des indices sur ton mot, sans le dire ni etre trop evident."}</span>
      </div>`;
  }

  function voteButtons(s) {
    const btns = s.order
      .filter((p) => p.alive && p.id !== socket.id)
      .map((p) => `<button id="vote-${p.id}" class="uc-vote-btn">${p.name}</button>`)
      .join("");
    return `<p class="uc-wait">Qui est l'imposteur ? Vote :</p>
      <div class="uc-vote-list">${btns}</div>`;
  }
})();
