// games/undercover/server.js -- Server-side logic for the Undercover game.
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

const anime = require("./data");

const MIN_PLAYERS = 3;
const SETTINGS_SECONDS = 60;

// Modes offered in the settings vote. themeKey drives the visual DA on screen.
const MODES = [
  { key: "classique", label: "Classique (FR)", theme: "marine" },
  { key: "anime_confondu", label: "Anime mélangés", theme: "gold" },
  { key: "anime_saison", label: "Anime récents", theme: "gold" },
  { key: "univers", label: "Univers précis", theme: "ring" },
];

// Words and characters now come as HAND-PICKED PAIRS (see data.js).
const ALL_WORDS = [].concat(...anime.WORDS); // for a bot Mr. White's random guess

// ---------- pair memory (which pairs were played / disliked) ----------
// Per room: pairs already played tonight (no repeat until all were seen) and
// the 👍/👎 votes. Global (whole server, until it restarts): the same votes, so
// a pair disliked by several groups stops coming out for everyone. Each vote is
// also printed in the server log (visible on Render) to fix the list later.
const GLOBAL_RATINGS = new Map(); // key -> { up, down }
function memoryOf(room) {
  room.ucMemory = room.ucMemory || { seen: new Set(), ratings: new Map() };
  return room.ucMemory;
}
function pairKey(a, b) { return [a, b].sort().join(" / "); }
function isBadPair(room, key) {
  const r = memoryOf(room).ratings.get(key);
  if (r && r.down >= 2 && r.down > r.up) return true; // disliked tonight
  const g = GLOBAL_RATINGS.get(key);
  return !!(g && g.down - g.up >= 3);                 // disliked by many groups
}

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
// Pick two DIFFERENT members of a list, at random (needs length >= 2).
function pickTwo(list) {
  const i = Math.floor(Math.random() * list.length);
  let j;
  do { j = Math.floor(Math.random() * list.length); } while (j === i);
  return [list[i], list[j]];
}
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

// Rotate an array by k positions (used to change the turn order each round).
function rotate(arr, k) {
  const n = arr.length;
  if (n === 0) return arr.slice();
  k = ((k % n) + n) % n;
  return arr.slice(k).concat(arr.slice(0, k));
}

// Total impostor count ("sale" scaling). Mr. White does NOT add one: when he is
// present he TAKES the place of one undercover, so the total stays the same.
function composition(n, wantMrWhite) {
  const impostors = n >= 8 ? 3 : n >= 5 ? 2 : 1;
  const mrw = wantMrWhite && n >= 4;
  let nbUnder = mrw ? impostors - 1 : impostors;
  // Safety: keep the civils a strict majority.
  const maxImp = Math.floor((n - 1) / 2);
  while (nbUnder + (mrw ? 1 : 0) > maxImp && nbUnder > 0) nbUnder--;
  return { nbUnder, mrw };
}

// ---------- BOTS (dev/solo testing: a bot is a seat flagged isBot) ----------
// Clues are said out loud, so bots only VOTE (random suspect) and, as Mr. White,
// make a (random) guess. They act through the same actions as a human.
function isBotSeat(room, id) { const p = (room.players || []).find((x) => x.seatId === id); return !!(p && p.isBot); }
function scheduleBots(api, room) {
  const s = room.gameState;
  if (!s || !s.alive) return;
  const act = (id, type, payload) => module.exports.handle(api, { isHost: false, seatId: id }, room, type, payload);
  if (s.phase === "vote") {
    const seq = s.voteSeq || 0;
    s._botVoted = s._botVoted || {};
    aliveIds(s).filter((id) => isBotSeat(room, id) && !s.votes[id] && s._botVoted[id] !== seq).forEach((id) => {
      s._botVoted[id] = seq;
      setTimeout(() => {
        if (room.gameState !== s || s.phase !== "vote" || (s.voteSeq || 0) !== seq || s.votes[id]) return;
        const opts = (s.tieCandidates || aliveIds(s)).filter((x) => x !== id && s.alive[x]);
        if (opts.length) act(id, "vote", { targetId: pick(opts) });
      }, 1200 + Math.floor(Math.random() * 2500));
    });
  }
  if (s.phase === "mrwhite" && isBotSeat(room, s.mrwhiteGuessing) && s._botGuess !== s.mrwhiteGuessing) {
    const id = s._botGuess = s.mrwhiteGuessing;
    setTimeout(() => {
      if (room.gameState === s && s.phase === "mrwhite" && s.mrwhiteGuessing === id) act(id, "mrwhiteGuess", { word: pick(ALL_WORDS) });
    }, 2500);
  }
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

  // Tie: ONE revote, only between the tied players. A second tie = nobody out.
  if (top.length > 1 && max > 0 && !state.tieCandidates) {
    state.tieCandidates = top;
    state.votes = {};
    state.voteSeq = (state.voteSeq || 0) + 1;
    broadcastState(api, room);
    return;
  }
  state.tieCandidates = null;

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
  const pair = buildPair(state.settings.mode, room);
  state.pair = pair;
  state.rating = {}; // 👍/👎 of each player at the end

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

  // Base turn order (round 1): Mr. White is never 1st or 2nd. Later rounds
  // rotate this base order so a different player leads each round.
  let baseOrder = shuffle(ids);
  if (mrwhiteId) {
    const idx = baseOrder.indexOf(mrwhiteId);
    if (idx < 2 && baseOrder.length > 2) {
      const swapWith = 2 + Math.floor(Math.random() * (baseOrder.length - 2));
      [baseOrder[idx], baseOrder[swapWith]] = [baseOrder[swapWith], baseOrder[idx]];
    }
  }

  state.roles = roles;
  state.alive = alive;
  state.names = names;
  state.cards = cards;
  state.baseOrder = baseOrder;
  state.order = baseOrder.slice();
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

// Pick a pair for the chosen mode: never one already played tonight (until
// every pair was seen), never one the players disliked. The civil side is
// chosen at random, so a pair can be played both ways.
function buildPair(mode, room) {
  let cands; // [{ a, b, why, universe }]
  if (mode === "classique") cands = anime.WORDS.map(([a, b]) => ({ a, b }));
  else if (mode === "univers") {
    cands = [];
    Object.keys(anime.UNIVERS).forEach((u) => anime.UNIVERS[u].forEach(([a, b, why]) => cands.push({ a, b, why, universe: u })));
  } else {
    const list = mode === "anime_saison" ? anime.SAISON : anime.CONFONDU;
    cands = list.map(([a, b, why]) => ({ a, b, why }));
  }
  const mem = memoryOf(room);
  const keyOf = (c) => mode + ":" + pairKey(c.a, c.b);
  let ok = cands.filter((c) => !isBadPair(room, keyOf(c)));
  if (!ok.length) ok = cands; // everything disliked?! play anyway
  let fresh = ok.filter((c) => !mem.seen.has(keyOf(c)));
  if (!fresh.length) { ok.forEach((c) => mem.seen.delete(keyOf(c))); fresh = ok; } // all seen: start over
  if (mode === "univers") { // pick the universe first, so big series do not dominate
    const u = pick([...new Set(fresh.map((c) => c.universe))]);
    fresh = fresh.filter((c) => c.universe === u);
  }
  const c = pick(fresh);
  mem.seen.add(keyOf(c));
  const [civ, und] = Math.random() < 0.5 ? [c.a, c.b] : [c.b, c.a];
  const base = { key: keyOf(c), why: c.why || null };
  if (mode === "classique") return Object.assign(base, { kind: "word", civil: civ, undercover: und });
  return Object.assign(base, { kind: "character", universe: c.universe || null, civil: anime.character(civ), undercover: anime.character(und) });
}

// Mr. White's guess: accents/case ignored; for a character, the first name OR
// the last name is enough ("Gojo" for "Gojo Satoru", "Luffy" for "Monkey D. Luffy").
function guessMatches(guess, target) {
  const g = norm(guess);
  if (!g) return false;
  if (g === norm(target)) return true;
  return String(target).split(/[\s.]+/).some((part) => part.length >= 3 && norm(part) === g);
}

function cardFor(role, pair) {
  if (role === "mrwhite") {
    return { kind: "mrwhite" }; // Mr. White knows he has no word
  }
  // Civils AND the undercover get an IDENTICAL-LOOKING card: no role is sent, so
  // the undercover cannot know he is the undercover (he just has a word).
  const which = role === "undercover" ? pair.undercover : pair.civil;
  if (pair.kind === "word") return { kind: "word", word: which };
  return { kind: "character", character: which };
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

  const avatars = {};
  api.players().forEach((p) => (avatars[p.id] = p.avatar || null));
  const order = s.order.map((id) => ({ id, name: s.names[id], alive: !!s.alive[id], avatar: avatars[id] || null }));
  const living = aliveIds(s);
  const payload = {
    ...base,
    mode: s.settings.mode,
    round: s.round,
    order,
    aliveCount: living.length,
    votesCount: Object.keys(s.votes).length,
    voteSeq: s.voteSeq || 0,
    tie: s.tieCandidates ? s.tieCandidates.map((id) => ({ id, name: s.names[id] })) : null,
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
    const r = Object.values(s.rating || {});
    payload.rating = { up: r.filter((x) => x).length, down: r.filter((x) => !x).length };
    payload.finalRoles = s.order.map((id) => ({ name: s.names[id], role: s.roles[id] }));
  }
  api.toAll("uc:state", payload);
  scheduleBots(api, room);
}

// ---------- module (called by the engine) ----------
module.exports = {
  id: "undercover",
  minPlayers: MIN_PLAYERS,

  // Host started the game -> open the settings vote (Mr. White + mode).
  start(api, room) {
    openSettings(api, room);
  },

  // actor = { isHost, seatId } -- a STABLE identity (survives reconnections).
  handle(api, actor, room, type, payload) {
    const state = room.gameState;
    if (!state) return;
    const isHost = actor.isHost;
    const me = actor.seatId;

    switch (type) {
      case "voteSetting": {
        if (state.phase !== "settings") break;
        if (isHost) break; // host doesn't vote settings
        const v = state.settings.votes[me] || {};
        if (payload && payload.key === "mrWhite" && api.players().length >= 4) {
          v.mrWhite = !!payload.value;
        }
        if (payload && payload.key === "mode" && MODES.some((m) => m.key === payload.value)) {
          v.mode = payload.value;
        }
        state.settings.votes[me] = v;
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
        if (isHost && state.phase === "clues") {
          state.phase = "vote"; state.votes = {}; state.tieCandidates = null;
          state.voteSeq = (state.voteSeq || 0) + 1; // phones use it to know a NEW vote started
          broadcastState(api, room);
        }
        break;
      case "vote": {
        if (state.phase !== "vote") break;
        const voter = me, target = payload && payload.targetId;
        if (!state.alive[voter] || !state.alive[target] || target === voter) break;
        if (state.tieCandidates && !state.tieCandidates.includes(target)) break; // revote: tied players only
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
        if (state.phase !== "mrwhite" || me !== state.mrwhiteGuessing) break;
        const guess = payload && payload.word;
        const correct = state.pair.kind === "word" ? !!norm(guess) && norm(guess) === norm(civilWord(state)) : guessMatches(guess, civilWord(state));
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
          else {
            state.phase = "clues";
            state.round += 1;
            state.votes = {};
            state.mrwhiteGuessResult = null;
            // New round -> a brand new random turn order.
            state.order = shuffle(state.order);
          }
          broadcastState(api, room);
        }
        break;

      case "ratePair": { // 👍 / 👎 on the pair, at the end of the game
        if (state.phase !== "ended" || !state.pair || isHost || !state.names[me]) break;
        const up = !!(payload && payload.up);
        const before = state.rating[me];
        if (before === up) break;
        state.rating[me] = up;
        const bump = (map) => {
          const r = map.get(state.pair.key) || { up: 0, down: 0 };
          if (before !== undefined) r[before ? "up" : "down"]--;
          r[up ? "up" : "down"]++;
          map.set(state.pair.key, r);
          return r;
        };
        bump(memoryOf(room).ratings);
        const g = bump(GLOBAL_RATINGS);
        console.log("[undercover] paire " + (up ? "👍" : "👎") + " " + state.pair.key + "  (total 👍" + g.up + " 👎" + g.down + ")");
        broadcastState(api, room);
        break;
      }
      case "replay":
        // At the end, the host can restart: everyone goes back to the settings vote.
        if (isHost && state.phase === "ended") openSettings(api, room);
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
        state.tieCandidates = null;
        state.voteSeq = (state.voteSeq || 0) + 1;
        state.phase = "vote";
        broadcastState(api, room);
        break;
    }
  },

  // a player changed their avatar or name: refresh the boards
  onPlayerUpdate(api, room, seatId) {
    const st = room.gameState;
    if (!st || !st.order) return;
    const p = api.players().find((x) => x.id === seatId);
    if (p && p.name && st.names && seatId in st.names) st.names[seatId] = p.name;
    broadcastState(api, room);
  },

  // Someone came back (a player to their seat, or the host). Resend their state.
  onReconnect(api, room, who) {
    const state = room.gameState;
    if (!state) return;
    if (who && who.seatId && state.cards && state.cards[who.seatId]) {
      api.toPlayer(who.seatId, "uc:you", state.cards[who.seatId]);
    }
    broadcastState(api, room); // resends the public board to everyone (incl. the returner)
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

// Open (or re-open, on replay) the 60s settings vote.
function openSettings(api, room) {
  const endsAt = Date.now() + SETTINGS_SECONDS * 1000;
  room.gameState = {
    phase: "settings",
    settings: { votes: {}, endsAt, mrWhite: false, mode: "classique", timer: null },
  };
  // Auto-finalize when the timer runs out (host can also finalize early).
  room.gameState.settings.timer = setTimeout(() => finalizeSettings(api, room), SETTINGS_SECONDS * 1000);
  broadcastState(api, room);
}

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
