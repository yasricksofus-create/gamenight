// game-modules/undercover.js -- Server-side logic for the Undercover game.
//
// Covers phases 1-4:
//  - a 60s SETTINGS vote (Mr. White yes/no + game mode) decided by the players;
//  - roles Civil / Undercover / Mr. White, with a "sale" (spicy) scaling;
//  - modes: classique (FR words), anime melanges, anime recents, univers precis
//    (the two anime word "words" are characters -> the client fetches images);
//  - full loop: distribution -> clues (oral) -> vote -> reveal -> ended, with
//    Mr. White's last-chance guess when he is eliminated;
//  - host cheats (reveal roles, redeal, cancel elimination, revote).
//
// The engine knows NONE of this; it only relays through "api".

const anime = require("./anime-data");

const MIN_PLAYERS = 3;
const SETTINGS_SECONDS = 60;

// Modes offered in the settings vote. themeKey drives the visual DA on screen.
const MODES = [
  { key: "classique", label: "Classique (FR)", theme: "marine" },
  { key: "anime_confondu", label: "Anime melanges", theme: "gold" },
  { key: "anime_saison", label: "Anime recents", theme: "gold" },
  { key: "univers", label: "Univers precis", theme: "ring" },
];

const WORD_PAIRS = [
  { civil: "Cafe", undercover: "The" }, { civil: "Chien", undercover: "Loup" },
  { civil: "Citron", undercover: "Orange" }, { civil: "Plage", undercover: "Desert" },
  { civil: "Voiture", undercover: "Moto" }, { civil: "Soleil", undercover: "Lune" },
  { civil: "Livre", undercover: "Cahier" }, { civil: "Piano", undercover: "Guitare" },
  { civil: "Neige", undercover: "Pluie" }, { civil: "Montagne", undercover: "Colline" },
  { civil: "Avion", undercover: "Helicoptere" }, { civil: "Fraise", undercover: "Framboise" },
  { civil: "Chat", undercover: "Tigre" }, { civil: "Velo", undercover: "Trottinette" },
  { civil: "Bateau", undercover: "Sous-marin" }, { civil: "Epee", undercover: "Couteau" },
  { civil: "Chateau", undercover: "Forteresse" }, { civil: "Riviere", undercover: "Lac" },
  { civil: "Pizza", undercover: "Tarte" }, { civil: "Chocolat", undercover: "Caramel" },
  { civil: "Trompette", undercover: "Saxophone" }, { civil: "Etoile", undercover: "Planete" },
  { civil: "Renard", undercover: "Ecureuil" }, { civil: "Train", undercover: "Metro" },
  { civil: "Miel", undercover: "Confiture" }, { civil: "Requin", undercover: "Dauphin" },
  { civil: "Nuage", undercover: "Brouillard" }, { civil: "Croissant", undercover: "Baguette" },
  { civil: "Volcan", undercover: "Geyser" }, { civil: "Roi", undercover: "Reine" },
];

// ---------- small helpers ----------
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function roleLabel(role) {
  if (role === "undercover") return "Undercover";
  if (role === "mrwhite") return "Mr. White";
  return "Civil";
}
// Normalize a word for a forgiving comparison (accents/case/spaces ignored).
function norm(s) {
  return String(s || "").toLowerCase().normalize("NFD")
    .replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");
}
function aliveIds(state) {
  return Object.keys(state.alive).filter((id) => state.alive[id]);
}
function isImpostor(role) { return role === "undercover" || role === "mrwhite"; }

// Spicy undercover count, then balanced so civils always outnumber impostors.
function composition(n, wantMrWhite) {
  let nbUnder = n >= 8 ? 3 : n >= 5 ? 2 : 1;
  const mrw = wantMrWhite && n >= 4;
  const maxImpostors = Math.floor((n - 1) / 2);
  while (nbUnder + (mrw ? 1 : 0) > maxImpostors && nbUnder > 0) nbUnder--;
  return { nbUnder, mrw };
}

// ---------- state transitions ----------

function checkWinner(state) {
  const living = aliveIds(state);
  const impostorsAlive = living.filter((id) => isImpostor(state.roles[id])).length;
  const civilsAlive = living.filter((id) => state.roles[id] === "civil").length;
  if (impostorsAlive === 0) state.winner = "civils";
  else if (impostorsAlive >= civilsAlive) state.winner = "impostors";
  else state.winner = null;
}

// The word the civils "hold" (for Mr. White's guess and the final reveal).
function civilWord(state) {
  return state.pair.kind === "word" ? state.pair.civil : state.pair.civil.name;
}

function resolveVote(api, room) {
  const state = room.gameState;
  const tally = {};
  Object.values(state.votes).forEach((t) => { tally[t] = (tally[t] || 0) + 1; });
  let max = 0, top = [];
  Object.entries(tally).forEach(([id, n]) => {
    if (n > max) { max = n; top = [id]; }
    else if (n === max) top.push(id);
  });

  if (top.length === 1 && max > 0) {
    const id = top[0];
    // Mr. White eliminated -> last-chance guess before anything is finalized.
    if (state.roles[id] === "mrwhite") {
      state.mrwhiteGuessing = id;
      state.phase = "mrwhite";
      broadcastState(api, room);
      return;
    }
    state.alive[id] = false;
    state.lastEliminated = { id, name: state.names[id], role: state.roles[id] };
  } else {
    state.lastEliminated = null; // tie or no vote -> nobody eliminated
  }
  checkWinner(state);
  state.phase = "reveal";
  broadcastState(api, room);
}

// Deal roles + words once the settings are decided.
function deal(api, room) {
  const state = room.gameState;
  const players = api.players();
  const ids = players.map((p) => p.id);
  const n = ids.length;
  const { nbUnder, mrw } = composition(n, state.settings.mrWhite);

  const shuffled = shuffle(ids);
  const undercovers = new Set(shuffled.slice(0, nbUnder));
  const mrwhiteId = mrw ? shuffled[nbUnder] : null;

  // Build the secret content according to the chosen mode.
  const pair = buildPair(state.settings.mode);
  state.pair = pair;

  const roles = {}, alive = {}, names = {}, cards = {};
  players.forEach((p) => {
    let role = "civil";
    if (undercovers.has(p.id)) role = "undercover";
    else if (p.id === mrwhiteId) role = "mrwhite";
    roles[p.id] = role;
    alive[p.id] = true;
    names[p.id] = p.name;
    cards[p.id] = cardFor(role, pair);
  });

  // Turn order: Mr. White is never 1st or 2nd on round 1.
  let order = shuffle(ids);
  if (mrwhiteId) {
    const idx = order.indexOf(mrwhiteId);
    if (idx < 2 && order.length > 2) {
      const swapWith = 2 + Math.floor(Math.random() * (order.length - 2));
      [order[idx], order[swapWith]] = [order[swapWith], order[idx]];
    }
  }

  state.roles = roles;
  state.alive = alive;
  state.names = names;
  state.cards = cards;
  state.order = order;
  state.votes = {};
  state.round = 1;
  state.lastEliminated = null;
  state.winner = null;
  state.mrwhiteGuessing = null;
  state.mrwhiteGuessResult = null;
  state.phase = "distribution";

  players.forEach((p) => api.toPlayer(p.id, "uc:you", cards[p.id]));
  broadcastState(api, room);
}

function buildPair(mode) {
  if (mode === "classique") {
    const w = pick(WORD_PAIRS);
    return { kind: "word", civil: w.civil, undercover: w.undercover };
  }
  let list, universe = null;
  if (mode === "anime_saison") list = anime.SAISON;
  else if (mode === "univers") {
    universe = pick(Object.keys(anime.UNIVERS));
    list = anime.UNIVERS[universe];
  } else list = anime.CONFONDU; // anime_confondu (default)

  const p = pick(list);
  // Randomize which character is the civils' one.
  const flip = Math.random() < 0.5;
  const civ = flip ? p.a : p.b;
  const und = flip ? p.b : p.a;
  return {
    kind: "character",
    universe,
    civil: { name: civ.name, desc: civ.desc },
    undercover: { name: und.name, desc: und.desc },
  };
}

function cardFor(role, pair) {
  if (role === "mrwhite") {
    return { kind: "mrwhite", role, roleLabel: roleLabel(role) };
  }
  const which = role === "undercover" ? pair.undercover : pair.civil;
  if (pair.kind === "word") {
    return { kind: "word", role, roleLabel: roleLabel(role), word: which };
  }
  return { kind: "character", role, roleLabel: roleLabel(role), character: which };
}

// Build the PUBLIC state (no secret words) and send it to everyone.
function broadcastState(api, room) {
  const s = room.gameState;
  const theme = (MODES.find((m) => m.key === (s.settings && s.settings.mode)) || {}).theme || "gold";

  const base = { phase: s.phase, themeKey: theme };

  if (s.phase === "settings") {
    const votes = s.settings.votes;
    const modeCounts = {};
    MODES.forEach((m) => (modeCounts[m.key] = 0));
    let mrYes = 0, mrNo = 0, voted = 0;
    Object.values(votes).forEach((v) => {
      voted++;
      if (v.mode) modeCounts[v.mode] = (modeCounts[v.mode] || 0) + 1;
      if (v.mrWhite === true) mrYes++;
      if (v.mrWhite === false) mrNo++;
    });
    api.toAll("uc:state", {
      ...base,
      modes: MODES,
      mrWhiteAllowed: api.players().length >= 4,
      modeCounts, mrYes, mrNo,
      voted, total: api.players().length,
      endsAt: s.settings.endsAt,
    });
    return;
  }

  const order = s.order.map((id) => ({ id, name: s.names[id], alive: !!s.alive[id] }));
  const living = aliveIds(s);
  const payload = {
    ...base,
    mode: s.settings.mode,
    round: s.round,
    order,
    aliveCount: living.length,
    votesCount: Object.keys(s.votes).length,
    votesNeeded: living.length,
    lastEliminated: s.lastEliminated,
    winner: s.winner,
    universe: s.pair && s.pair.universe,
  };
  if (s.phase === "mrwhite") {
    payload.mrwhite = { id: s.mrwhiteGuessing, name: s.names[s.mrwhiteGuessing] };
  }
  if (s.phase === "reveal" && s.mrwhiteGuessResult) {
    payload.mrwhiteGuessResult = s.mrwhiteGuessResult;
  }
  if (s.phase === "ended") {
    payload.pair = s.pair;
    payload.finalRoles = s.order.map((id) => ({ name: s.names[id], role: s.roles[id] }));
  }
  api.toAll("uc:state", payload);
}

// ---------- module (called by the engine) ----------
module.exports = {
  id: "undercover",
  minPlayers: MIN_PLAYERS,

  // Host started the game -> open the settings vote (Mr. White + mode).
  start(api, room) {
    const endsAt = Date.now() + SETTINGS_SECONDS * 1000;
    room.gameState = {
      phase: "settings",
      settings: { votes: {}, endsAt, mrWhite: false, mode: "classique", timer: null },
    };
    // Auto-finalize when the timer runs out (host can also finalize early).
    room.gameState.settings.timer = setTimeout(() => finalizeSettings(api, room), SETTINGS_SECONDS * 1000);
    broadcastState(api, room);
  },

  handle(api, socket, room, type, payload) {
    const state = room.gameState;
    if (!state) return;
    const isHost = socket.id === room.hostId;

    switch (type) {
      case "voteSetting": {
        if (state.phase !== "settings") break;
        if (socket.id === room.hostId) break; // host doesn't vote settings
        const v = state.settings.votes[socket.id] || {};
        if (payload && payload.key === "mrWhite" && api.players().length >= 4) {
          v.mrWhite = !!payload.value;
        }
        if (payload && payload.key === "mode" && MODES.some((m) => m.key === payload.value)) {
          v.mode = payload.value;
        }
        state.settings.votes[socket.id] = v;
        broadcastState(api, room);
        break;
      }
      case "finalizeSettings":
        if (isHost && state.phase === "settings") finalizeSettings(api, room);
        break;

      case "beginClues":
        if (isHost && state.phase === "distribution") { state.phase = "clues"; broadcastState(api, room); }
        break;
      case "toVote":
        if (isHost && state.phase === "clues") { state.phase = "vote"; state.votes = {}; broadcastState(api, room); }
        break;
      case "vote": {
        if (state.phase !== "vote") break;
        const voter = socket.id, target = payload && payload.targetId;
        if (!state.alive[voter] || !state.alive[target] || target === voter) break;
        state.votes[voter] = target;
        api.toPlayer(voter, "uc:voted", { targetId: target });
        if (aliveIds(state).every((id) => state.votes[id])) resolveVote(api, room);
        else broadcastState(api, room);
        break;
      }
      case "resolveVote":
        if (isHost && state.phase === "vote") resolveVote(api, room);
        break;
      case "mrwhiteGuess": {
        if (state.phase !== "mrwhite" || socket.id !== state.mrwhiteGuessing) break;
        const guess = payload && payload.word;
        const correct = norm(guess) && norm(guess) === norm(civilWord(state));
        state.mrwhiteGuessResult = { guess: String(guess || ""), correct };
        const id = state.mrwhiteGuessing;
        if (correct) {
          state.winner = "impostors"; // Mr. White steals the win
        } else {
          state.alive[id] = false;
          checkWinner(state);
        }
        state.lastEliminated = { id, name: state.names[id], role: "mrwhite" };
        state.mrwhiteGuessing = null;
        state.phase = "reveal";
        broadcastState(api, room);
        break;
      }
      case "next":
        if (isHost && state.phase === "reveal") {
          if (state.winner) state.phase = "ended";
          else { state.phase = "clues"; state.round += 1; state.votes = {}; state.mrwhiteGuessResult = null; }
          broadcastState(api, room);
        }
        break;
    }
  },

  // Host cheats from the console (validated as host by the engine already).
  onCheat(api, room, cheatId) {
    const state = room.gameState;
    if (!state) return;
    switch (cheatId) {
      case "reveal-role":
        api.toHost("uc:cheatReveal", {
          roles: (state.order || []).map((id) => ({ name: state.names[id], role: roleLabel(state.roles[id]) })),
        });
        break;
      case "redeal":
        if (state.settings) deal(api, room);
        break;
      case "cancel-elim":
        if (state.lastEliminated && state.alive[state.lastEliminated.id] === false) {
          state.alive[state.lastEliminated.id] = true;
          state.lastEliminated = null;
          state.winner = null;
          state.phase = "clues";
          broadcastState(api, room);
        }
        break;
      case "revote":
        state.votes = {};
        state.phase = "vote";
        broadcastState(api, room);
        break;
    }
  },

  onPlayerLeave(api, room, playerId) {
    const state = room.gameState;
    if (!state) return;
    if (state.phase === "settings") { delete state.settings.votes[playerId]; broadcastState(api, room); return; }
    if (state.alive[playerId] === undefined) return;
    state.alive[playerId] = false;
    delete state.votes[playerId];
    checkWinner(state);
    if (state.winner && state.phase !== "ended") state.phase = "ended";
    broadcastState(api, room);
  },
};

// Decide the settings from the votes, then deal.
function finalizeSettings(api, room) {
  const state = room.gameState;
  if (!state || state.phase !== "settings") return;
  if (state.settings.timer) { clearTimeout(state.settings.timer); state.settings.timer = null; }

  const votes = Object.values(state.settings.votes);
  // Mr. White: majority of YES among those who expressed an opinion (needs >=4).
  let yes = 0, no = 0;
  votes.forEach((v) => { if (v.mrWhite === true) yes++; else if (v.mrWhite === false) no++; });
  state.settings.mrWhite = api.players().length >= 4 && yes > no;

  // Mode: most-voted, random among ties, default classique.
  const counts = {};
  votes.forEach((v) => { if (v.mode) counts[v.mode] = (counts[v.mode] || 0) + 1; });
  let best = 0, top = [];
  Object.entries(counts).forEach(([k, c]) => {
    if (c > best) { best = c; top = [k]; } else if (c === best) top.push(k);
  });
  state.settings.mode = top.length ? pick(top) : "classique";

  deal(api, room);
}
