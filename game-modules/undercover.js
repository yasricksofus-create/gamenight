// game-modules/undercover.js -- Server-side logic for the Undercover game.
//
// PHASE 1: "Classique" mode only (two similar FRENCH words), default settings,
// NO Mr. White yet (phase 2). This file is a GAME MODULE: the engine loads it
// only when an Undercover room starts a game, then calls the functions below.
// The engine knows NONE of these rules -- it just relays messages through "api".
//
// The whole game is a small STATE MACHINE:
//   distribution -> clues -> vote -> reveal -> (clues again OR ended)

// Pairs of similar-but-different French words. Civils get the first, the
// undercover(s) get the second. Generating more later is trivial (just add lines).
const WORD_PAIRS = [
  { civil: "Cafe", undercover: "The" },
  { civil: "Chien", undercover: "Loup" },
  { civil: "Citron", undercover: "Orange" },
  { civil: "Plage", undercover: "Desert" },
  { civil: "Voiture", undercover: "Moto" },
  { civil: "Soleil", undercover: "Lune" },
  { civil: "Livre", undercover: "Cahier" },
  { civil: "Piano", undercover: "Guitare" },
  { civil: "Neige", undercover: "Pluie" },
  { civil: "Montagne", undercover: "Colline" },
  { civil: "Avion", undercover: "Helicoptere" },
  { civil: "Fraise", undercover: "Framboise" },
  { civil: "Chat", undercover: "Tigre" },
  { civil: "Velo", undercover: "Trottinette" },
  { civil: "Bateau", undercover: "Sous-marin" },
  { civil: "Epee", undercover: "Couteau" },
  { civil: "Chateau", undercover: "Forteresse" },
  { civil: "Riviere", undercover: "Lac" },
  { civil: "Pizza", undercover: "Tarte" },
  { civil: "Chocolat", undercover: "Caramel" },
  { civil: "Trompette", undercover: "Saxophone" },
  { civil: "Etoile", undercover: "Planete" },
  { civil: "Renard", undercover: "Ecureuil" },
  { civil: "Train", undercover: "Metro" },
  { civil: "Miel", undercover: "Confiture" },
  { civil: "Requin", undercover: "Dauphin" },
  { civil: "Nuage", undercover: "Brouillard" },
  { civil: "Croissant", undercover: "Baguette" },
  { civil: "Volcan", undercover: "Geyser" },
  { civil: "Roi", undercover: "Reine" },
];

const MIN_PLAYERS = 3;

// Phase 1 default number of undercovers (phase 2 will use the "sale" scaling).
function undercoverCount(n) {
  return n >= 6 ? 2 : 1;
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function roleLabel(role) {
  return role === "undercover" ? "Undercover" : "Civil";
}

// ----- Helpers that read/update the state (not exported) -----

function aliveIds(state) {
  return Object.keys(state.alive).filter((id) => state.alive[id]);
}

// Decide if a side has won, and store it in state.winner (or null).
function checkWinner(state) {
  const living = aliveIds(state);
  const undercoverAlive = living.filter((id) => state.roles[id] === "undercover").length;
  const civilAlive = living.filter((id) => state.roles[id] === "civil").length;
  if (undercoverAlive === 0) state.winner = "civils";
  else if (undercoverAlive >= civilAlive) state.winner = "undercover";
  else state.winner = null;
}

// Count the votes and eliminate the most-voted player (tie -> nobody).
function resolveVote(api, room) {
  const state = room.gameState;
  const tally = {};
  Object.values(state.votes).forEach((target) => {
    tally[target] = (tally[target] || 0) + 1;
  });

  let max = 0;
  let top = [];
  Object.entries(tally).forEach(([id, n]) => {
    if (n > max) { max = n; top = [id]; }
    else if (n === max) top.push(id);
  });

  if (top.length === 1 && max > 0) {
    const id = top[0];
    state.alive[id] = false;
    state.lastEliminated = { id, name: state.names[id], role: state.roles[id] };
  } else {
    state.lastEliminated = null; // tie or no votes -> nobody eliminated
  }

  checkWinner(state);
  state.phase = "reveal";
  broadcastState(api, room);
}

// Build the PUBLIC state (no secret words) and send it to everyone.
function broadcastState(api, room) {
  const s = room.gameState;
  const order = s.order.map((id) => ({ id, name: s.names[id], alive: !!s.alive[id] }));
  const living = aliveIds(s);

  const publicState = {
    phase: s.phase,
    mode: s.mode,
    round: s.round,
    order,
    aliveCount: living.length,
    votesCount: Object.keys(s.votes).length,
    votesNeeded: living.length,
    lastEliminated: s.lastEliminated,
    winner: s.winner,
    // Reveal the words + everyone's role ONLY when the game is over.
    pair: s.phase === "ended" ? s.pair : null,
    finalRoles: s.phase === "ended"
      ? s.order.map((id) => ({ name: s.names[id], role: s.roles[id] }))
      : null,
  };
  api.toAll("uc:state", publicState);
}

module.exports = {
  id: "undercover",
  minPlayers: MIN_PLAYERS,

  // Host started the game: build state, deal the words, show the board.
  start(api, room) {
    const players = api.players(); // [{id, name}]
    const pair = WORD_PAIRS[Math.floor(Math.random() * WORD_PAIRS.length)];

    const ids = players.map((p) => p.id);
    const nbUndercover = undercoverCount(ids.length);
    const undercovers = new Set(shuffle(ids).slice(0, nbUndercover));

    const roles = {};
    const words = {};
    const alive = {};
    const names = {};
    players.forEach((p) => {
      const isUnder = undercovers.has(p.id);
      roles[p.id] = isUnder ? "undercover" : "civil";
      words[p.id] = isUnder ? pair.undercover : pair.civil;
      alive[p.id] = true;
      names[p.id] = p.name;
    });

    room.gameState = {
      phase: "distribution",
      mode: "classique",
      pair,
      roles,
      words,
      alive,
      names,
      order: shuffle(ids), // clue turn order (phase 2: Mr. White never 1st/2nd)
      votes: {},
      lastEliminated: null,
      round: 1,
      winner: null,
    };

    // Each player gets their OWN private card (role + secret word).
    players.forEach((p) => {
      api.toPlayer(p.id, "uc:you", {
        role: roles[p.id],
        roleLabel: roleLabel(roles[p.id]),
        word: words[p.id],
      });
    });
    broadcastState(api, room);
  },

  // A socket sent a game action. The engine already checked the room exists.
  handle(api, socket, room, type, payload) {
    const state = room.gameState;
    if (!state) return;
    const isHost = socket.id === room.hostId;

    switch (type) {
      case "beginClues":
        if (isHost && state.phase === "distribution") {
          state.phase = "clues";
          broadcastState(api, room);
        }
        break;

      case "toVote":
        if (isHost && state.phase === "clues") {
          state.phase = "vote";
          state.votes = {};
          broadcastState(api, room);
        }
        break;

      case "vote": {
        if (state.phase !== "vote") break;
        const voter = socket.id;
        const target = payload && payload.targetId;
        if (!state.alive[voter]) break;            // only living players vote
        if (!target || !state.alive[target]) break; // target must be alive
        if (target === voter) break;               // no self-vote
        state.votes[voter] = target;
        api.toPlayer(voter, "uc:voted", { targetId: target });

        // Auto-resolve once every living player has voted.
        const allVoted = aliveIds(state).every((id) => state.votes[id]);
        if (allVoted) resolveVote(api, room);
        else broadcastState(api, room);
        break;
      }

      case "resolveVote":
        if (isHost && state.phase === "vote") resolveVote(api, room);
        break;

      case "next":
        if (isHost && state.phase === "reveal") {
          if (state.winner) {
            state.phase = "ended";
          } else {
            state.phase = "clues";
            state.round += 1;
            state.votes = {};
          }
          broadcastState(api, room);
        }
        break;
    }
  },

  // A player disconnected mid-game: treat them as out, then re-check the winner.
  onPlayerLeave(api, room, playerId) {
    const state = room.gameState;
    if (!state || state.alive[playerId] === undefined) return;
    state.alive[playerId] = false;
    delete state.votes[playerId];
    checkWinner(state);
    if (state.winner && state.phase !== "ended") state.phase = "ended";
    broadcastState(api, room);
  },
};
