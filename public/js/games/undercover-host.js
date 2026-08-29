// undercover-host.js -- Host-side rendering of the Undercover board.
//
// It reads the PUBLIC game state (uc:state) and draws the right screen for each
// phase, with the host's control buttons. The generic host.js handles the
// connection and reveals #game-root; this file is purely Undercover.
(function () {
  const socket = window.socket;
  const root = document.getElementById("game-root");
  let state = null;

  socket.on("uc:state", (s) => { state = s; render(); });

  function send(type, payload) {
    socket.emit("game:action", { type, payload });
  }
  function roleLabel(role) {
    return role === "undercover" ? "Undercover" : "Civil";
  }

  // The turn order / player list. `numbered` adds the turn number bubbles.
  function orderList(s, numbered) {
    const items = s.order.map((p, i) => {
      const num = numbered ? `<span class="uc-turn">${i + 1}</span>` : "";
      const cls = p.alive ? "uc-player" : "uc-player out";
      return `<li class="${cls}">${num}${p.name}</li>`;
    }).join("");
    return `<ul class="uc-order">${items}</ul>`;
  }

  function render() {
    if (!state) return;
    const s = state;
    let html = "";

    if (s.phase === "distribution") {
      html = `<p class="uc-eyebrow">Dossier confidentiel</p>
        <h1>Distribution</h1>
        <p class="subtitle">Chaque joueur decouvre son mot sur son telephone.</p>
        ${orderList(s, false)}
        <button id="btn-begin" class="uc-btn">Commencer les indices</button>`;
    } else if (s.phase === "clues") {
      html = `<p class="uc-eyebrow">Manche ${s.round}</p>
        <h1>Tour d'indices</h1>
        <p class="subtitle">Chacun donne UN indice a l'oral, dans l'ordre.</p>
        ${orderList(s, true)}
        <button id="btn-vote" class="uc-btn">Passer au vote</button>`;
    } else if (s.phase === "vote") {
      html = `<p class="uc-eyebrow">Manche ${s.round}</p>
        <h1>Vote</h1>
        <p class="subtitle">${s.votesCount}/${s.votesNeeded} ont vote</p>
        ${orderList(s, false)}
        <button id="btn-resolve" class="uc-btn ghost">Forcer la revelation</button>`;
    } else if (s.phase === "reveal") {
      const e = s.lastEliminated;
      const txt = e
        ? `<strong>${e.name}</strong> est elimine — c'etait un <strong>${roleLabel(e.role)}</strong>.`
        : "Egalite : personne n'est elimine cette manche.";
      html = `<h1>Elimination</h1>
        <p class="uc-elim">${txt}</p>
        <button id="btn-next" class="uc-btn">${s.winner ? "Voir le resultat" : "Manche suivante"}</button>`;
    } else if (s.phase === "ended") {
      html = endScreen(s);
    }

    root.innerHTML = html;
    bind("btn-begin", () => send("beginClues"));
    bind("btn-vote", () => send("toVote"));
    bind("btn-resolve", () => send("resolveVote"));
    bind("btn-next", () => send("next"));
  }

  function endScreen(s) {
    const winTxt = s.winner === "civils"
      ? "Les Civils l'emportent !"
      : "L'Undercover l'emporte !";
    const rolesList = (s.finalRoles || []).map((r) =>
      `<li class="uc-player">${r.name} — ${roleLabel(r.role)}</li>`).join("");
    return `<p class="uc-eyebrow">Fin de partie</p>
      <h1>${winTxt}</h1>
      <div class="uc-pair">
        <span>Mot des civils : <strong>${s.pair.civil}</strong></span>
        <span>Mot de l'undercover : <strong>${s.pair.undercover}</strong></span>
      </div>
      <ul class="uc-order">${rolesList}</ul>`;
  }

  function bind(id, fn) {
    const el = document.getElementById(id);
    if (el) el.onclick = fn;
  }
})();
