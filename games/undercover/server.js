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
  { key: "anime_hasard", label: "Anime au hasard", theme: "gold" },
  { key: "best_of", label: "Best of (les paires les mieux notées)", theme: "ring" },
];

// Options chosen by the HOST before dealing (remembered for the next game).
const DEFAULT_OPTS = {
  lastWord: true,     // 10 s of defence before an elimination
  debateSec: 0,       // debate timer before the vote (0 = off)
  votePublic: false,  // everyone sees who votes for whom, live
  category: "all",    // Classique: word category
  difficulty: "all",  // Classique: facile / normal / expert
};
const OPT_VALUES = {
  lastWord: [true, false], debateSec: [0, 30, 60, 90], votePublic: [false, true],
  category: ["all"].concat(Object.keys(anime.WORD_CATS), ["Perso"]), difficulty: ["all", "facile", "normal", "expert"],
};

// Words and characters now come as HAND-PICKED PAIRS (see data.js).
const ALL_WORDS = [].concat(...anime.WORDS.map(([a, b]) => [a, b])); // for a bot Mr. White's random guess

// ---------- pair memory (which pairs were played / disliked) ----------
// Per room: pairs already played tonight (no repeat until all were seen) and
// the 👍/👎 votes. Global (whole server, until it restarts): the same votes, so
// a pair disliked by several groups stops coming out for everyone. Each vote is
// also printed in the server log (visible on Render) to fix the list later.
const GLOBAL_RATINGS = new Map(); // key -> { up, down }
function memoryOf(room) {
  room.ucMemory = room.ucMemory || { seen: new Set(), ratings: new Map() };
  const m = room.ucMemory;
  m.opts = m.opts || Object.assign({}, DEFAULT_OPTS);
  m.custom = m.custom || { word: [], character: [] };   // pairs proposed by players and accepted by the host
  m.proposals = m.proposals || [];                       // waiting for the host's answer
  m.scores = m.scores || {};                             // name -> points this evening
  m.stats = m.stats || {};                               // name -> { impWins, goodVotes, mrwGuess }
  return m;
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
// wanted = number of undercovers chosen by the host ("auto" = by player count).
function composition(n, wantMrWhite, wanted) {
  const auto = n >= 8 ? 3 : n >= 5 ? 2 : 1;
  const impostors = wanted && wanted !== "auto" ? Number(wanted) + (wantMrWhite && n >= 4 ? 1 : 0) : auto;
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

// Mr. White never speaks 1st or 2nd, in EVERY round: he needs to hear a couple
// of clues first. Only living players count (the dead are skipped when speaking).
function mrWhiteLate(order, mrId, alive) {
  order = order.slice();
  if (!mrId) return order;
  const speaking = order.filter((id) => !alive || alive[id]);
  const pos = speaking.indexOf(mrId);
  if (pos < 0 || pos >= 2 || speaking.length <= 2) return order;
  const later = speaking.slice(2).filter((id) => id !== mrId);
  if (!later.length) return order;
  const other = pick(later);
  const i = order.indexOf(mrId), j = order.indexOf(other);
  [order[i], order[j]] = [order[j], order[i]];
  return order;
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
  // round recap: who voted for whom (shown at the end of the game)
  (state.voteLog = state.voteLog || []).push({
    round: state.round,
    votes: Object.keys(state.votes).map((v) => [state.names[v], state.names[state.votes[v]], isImpostor(state.roles[state.votes[v]])]),
    out: top.length === 1 && max > 0 ? state.names[top[0]] : null,
  });
  Object.keys(state.votes).forEach((v) => { // "good votes" = votes on an impostor (evening stats)
    if (isImpostor(state.roles[state.votes[v]])) bumpStat(room, state.names[v], "goodVotes");
  });

  if (top.length === 1 && max > 0) {
    const id = top[0];
    // Last word: the designated player defends for 10 s, then the host
    // confirms the elimination or asks for a new vote.
    if (memoryOf(room).opts.lastWord) {
      state.defense = { id, name: state.names[id], endsAt: Date.now() + 10000 };
      state.phase = "defense";
      broadcastState(api, room);
      return;
    }
    return eliminate(api, room, id);
  }
  state.lastEliminated = null; // tie or no vote -> nobody eliminated
  checkWinner(state);
  state.phase = "reveal";
  broadcastState(api, room);
}

// The vote is final: this player is out (Mr. White first gets his guess).
function eliminate(api, room, id) {
  const state = room.gameState;
  state.defense = null;
  if (state.roles[id] === "mrwhite") { // last-chance guess before anything is finalized
    state.mrwhiteGuessing = id;
    state.phase = "mrwhite";
    broadcastState(api, room);
    return;
  }
  state.alive[id] = false;
  state.lastEliminated = { id, name: state.names[id], role: state.roles[id] };
  checkWinner(state);
  state.phase = "reveal";
  broadcastState(api, room);
  sendAllCardsToDead(api, room);
}

// ---------- evening scores & stats (kept in the room between games) ----------
function bumpStat(room, name, key, n) {
  const st = memoryOf(room).stats;
  st[name] = st[name] || { impWins: 0, goodVotes: 0, mrwGuess: 0 };
  st[name][key] += n || 1;
}
// Called once, when a game ends: points of the evening.
//   civils win: +1 each civil (+1 more if still alive)
//   impostors win: +2 each impostor, +3 for a Mr. White who guessed the word
function finishGame(room) {
  const s = room.gameState;
  if (!s || s.scored || !s.winner) return;
  s.scored = true;
  const sc = memoryOf(room).scores;
  Object.keys(s.roles).forEach((id) => {
    const name = s.names[id], role = s.roles[id];
    let pts = 0;
    if (s.winner === "civils" && role === "civil") pts = 1 + (s.alive[id] ? 1 : 0);
    if (s.winner === "impostors" && isImpostor(role)) {
      pts = role === "mrwhite" && s.mrwhiteGuessResult && s.mrwhiteGuessResult.correct ? 3 : 2;
      bumpStat(room, name, "impWins");
    }
    if (role === "mrwhite" && s.mrwhiteGuessResult && s.mrwhiteGuessResult.correct) bumpStat(room, name, "mrwGuess");
    sc[name] = (sc[name] || 0) + pts;
  });
}
function eveningRecap(room) {
  const m = memoryOf(room);
  const scores = Object.keys(m.scores).map((n) => ({ name: n, pts: m.scores[n] })).sort((a, b) => b.pts - a.pts);
  const best = (key) => {
    const l = Object.keys(m.stats).filter((n) => m.stats[n][key] > 0).sort((a, b) => m.stats[b][key] - m.stats[a][key]);
    return l.length ? { name: l[0], n: m.stats[l[0]][key] } : null;
  };
  return { scores, impostor: best("impWins"), detective: best("goodVotes"), mrwhite: best("mrwGuess") };
}

// The eliminated see every card (they are out, they can enjoy the show),
// except on the host's own phone (the host also runs the shared screen).
function sendAllCardsToDead(api, room) {
  const s = room.gameState;
  if (!s || !s.cards) return;
  const players = api.players();
  const all = s.order.map((id) => ({ name: s.names[id], role: roleLabel(s.roles[id]), card: s.cards[id], alive: !!s.alive[id] }));
  players.forEach((p) => {
    if (s.alive[p.id] === false && !p.hostDevice) api.toPlayer(p.id, "uc:allCards", all);
  });
}

// ---------- clue turns: who speaks now ----------
function startClueTurn(api, room) {
  const s = room.gameState;
  s.speakerIdx = 0;
  s.clues = {};
  s.debateEndsAt = null;
  scheduleBotClue(api, room);
}
function speakingOrder(s) { return s.order.filter((id) => s.alive[id]); }
// A bot "says" a short clue: a piece of its character's description, or the
// category of its word (honest but vague). Mr. White bluffs with something vague.
function botClue(s, id) {
  const card = s.cards[id];
  if (!card || card.kind === "mrwhite") return pick(["Hmm… c'est connu.", "Je dirais : populaire.", "Ça me parle !", "On en parle souvent."]);
  if (card.kind === "character") {
    const bits = String(card.character.desc || "").split(/[,.]/).map((x) => x.trim()).filter((x) => x.length > 3);
    return bits.length ? pick(bits) : "Un perso connu";
  }
  return s.pair && s.pair.category ? "Catégorie : " + s.pair.category.toLowerCase() : "Je vois très bien…";
}
function scheduleBotClue(api, room) {
  const s = room.gameState;
  if (!s || s.phase !== "clues") return;
  const id = speakingOrder(s)[s.speakerIdx];
  if (!id || !isBotSeat(room, id) || s.clues[id]) return;
  const idx = s.speakerIdx;
  setTimeout(() => {
    if (room.gameState !== s || s.phase !== "clues" || s.speakerIdx !== idx) return;
    s.clues[id] = botClue(s, id);
    s.speakerIdx++;            // a bot passes the turn by itself
    broadcastState(api, room);
    scheduleBotClue(api, room);
  }, 2200);
}

// Deal roles + words once the settings are decided.
function deal(api, room) {
  const state = room.gameState;
  const players = api.players();
  const ids = players.map((p) => p.id);
  const n = ids.length;
  const { nbUnder, mrw } = composition(n, state.settings.mrWhite, state.settings.nbUnder);

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

  // Turn order: Mr. White is never 1st or 2nd (he needs to hear clues first).
  const baseOrder = mrWhiteLate(shuffle(ids), mrwhiteId);

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
  state.voteLog = [];
  state.clues = {};
  state.defense = null;
  state.scored = false;
  state.lastLeft = null;
  state.phase = "distribution";

  players.forEach((p) => api.toPlayer(p.id, "uc:you", cards[p.id]));
  broadcastState(api, room);
}

// All the pairs a mode can draw from, as { a, b, why, kind, src, universe }.
// src = the mode the pair belongs to (used in its key, so ratings match).
function candidates(mode, room) {
  const mem = memoryOf(room), o = mem.opts;
  const words = () => {
    let l = anime.WORDS.map(([a, b, lvl, cat]) => ({ a, b, lvl, cat, kind: "word", src: "classique" }));
    l = l.concat(mem.custom.word.map((c) => ({ a: c.a, b: c.b, lvl: "normal", cat: "Perso", kind: "word", src: "classique", by: c.by })));
    const byCat = o.category === "all" ? l : l.filter((c) => c.cat === o.category);
    const byLvl = o.difficulty === "all" ? byCat : byCat.filter((c) => c.lvl === o.difficulty);
    return byLvl.length ? byLvl : (byCat.length ? byCat : l); // never empty
  };
  const chars = (list, src) => list.map(([a, b, why]) => ({ a, b, why, kind: "character", src }));
  const univers = () => {
    const l = [];
    Object.keys(anime.UNIVERS).forEach((u) => anime.UNIVERS[u].forEach(([a, b, why]) => l.push({ a, b, why, universe: u, kind: "character", src: "univers" })));
    return l;
  };
  const customChars = () => mem.custom.character.map((c) => ({ a: c.a, b: c.b, why: "Paire proposée par " + c.by, kind: "character", src: "anime_confondu", by: c.by }));
  if (mode === "classique") return words();
  if (mode === "anime_saison") return chars(anime.SAISON, "anime_saison");
  if (mode === "univers") return univers();
  if (mode === "anime_hasard") return chars(anime.CONFONDU, "anime_confondu").concat(chars(anime.SAISON, "anime_saison"), univers(), customChars());
  if (mode === "best_of") {
    const all = words().concat(chars(anime.CONFONDU, "anime_confondu"), chars(anime.SAISON, "anime_saison"), univers(), customChars());
    const score = (c) => {
      const k = c.src + ":" + pairKey(c.a, c.b);
      const r = mem.ratings.get(k) || { up: 0, down: 0 }, g = GLOBAL_RATINGS.get(k) || { up: 0, down: 0 };
      return (r.up - r.down) * 2 + (g.up - g.down);
    };
    const liked = all.filter((c) => score(c) > 0);
    return liked.length ? liked : all; // nothing rated yet: everything
  }
  return chars(anime.CONFONDU, "anime_confondu").concat(customChars());
}

// Pick a pair for the chosen mode: never one already played tonight (until
// every pair was seen), never one the players disliked. The civil side is
// chosen at random, so a pair can be played both ways.
function buildPair(mode, room) {
  const cands = candidates(mode, room);
  const mem = memoryOf(room);
  const keyOf = (c) => c.src + ":" + pairKey(c.a, c.b);
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
  const base = { key: keyOf(c), why: c.why || null, category: c.cat || null, level: c.lvl || null, by: c.by || null };
  if (c.kind === "word") return Object.assign(base, { kind: "word", civil: civ, undercover: und });
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
      nbUnder: s.settings.nbUnder,
      opts: memoryOf(room).opts, optValues: OPT_VALUES,
      ratings: ratingsList(room),
      proposals: memoryOf(room).proposals.length,
      maxUnder: Math.max(1, Math.floor((api.players().length - 1) / 2)), // civils must stay the majority
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
    lastLeft: s.lastLeft || null, // "X a quitté la partie"
    speaker: s.phase === "clues" ? (speakingOrder(s)[s.speakerIdx] || null) : null,
    clues: s.clues || {},
    debateEndsAt: s.debateEndsAt || null,
    defense: s.phase === "defense" ? s.defense : null,
    votedIds: Object.keys(s.votes || {}),                   // who has voted (not for whom)
    publicVotes: memoryOf(room).opts.votePublic ? Object.keys(s.votes || {}).map((v) => [s.names[v], s.names[s.votes[v]]]) : null,
    opts: memoryOf(room).opts,
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
    payload.finalRoles = s.order.map((id) => ({ id, name: s.names[id], role: s.roles[id] }));
    payload.voteLog = s.voteLog || [];
    payload.evening = eveningRecap(room);
    payload.ratings = ratingsList(room);
  }
  api.toAll("uc:state", payload);
  scheduleBots(api, room);
}

// Pairs rated tonight (for the host): best first.
function ratingsList(room) {
  return [...memoryOf(room).ratings.entries()].map(([k, r]) => ({ pair: k.split(":").slice(1).join(":"), up: r.up, down: r.down }))
    .sort((a, b) => (b.up - b.down) - (a.up - a.down)).slice(0, 30);
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
      case "setUndercovers": { // host only: "auto" or 1..3 (capped so civils stay the majority)
        if (!isHost || state.phase !== "settings") break;
        const v = payload && payload.value;
        const max = Math.max(1, Math.floor((api.players().length - 1) / 2));
        state.settings.nbUnder = v === "auto" ? "auto" : Math.min(max, Math.max(1, Math.round(Number(v)) || 1));
        memoryOf(room).nbUnder = state.settings.nbUnder;
        broadcastState(api, room);
        break;
      }
      case "finalizeSettings":
        if (isHost && state.phase === "settings") finalizeSettings(api, room);
        break;

      case "setOption": { // host only, before dealing: last word, debate, public vote, category, difficulty
        if (!isHost || state.phase !== "settings" || !payload || !(payload.key in OPT_VALUES)) break;
        if (!OPT_VALUES[payload.key].some((v) => v === payload.value)) break;
        memoryOf(room).opts[payload.key] = payload.value;
        broadcastState(api, room);
        break;
      }
      case "proposePair": { // a player proposes a pair; the host accepts or refuses it
        if (isHost || !payload) break;
        const a = String(payload.a || "").trim().slice(0, 40), b = String(payload.b || "").trim().slice(0, 40);
        const kind = payload.kind === "character" ? "character" : "word";
        const mem = memoryOf(room);
        const who = (api.players().find((p) => p.id === me) || {}).name || "?";
        if (!a || !b || norm(a) === norm(b) || mem.proposals.length >= 30 || mem.proposals.filter((x) => x.byId === me).length >= 5) break;
        mem.proposals.push({ id: Math.random().toString(36).slice(2, 9), a, b, kind, by: who, byId: me });
        api.toPlayer(me, "uc:proposed", { a, b });
        api.toHost("uc:proposals", mem.proposals.map(({ byId, ...x }) => x));
        broadcastState(api, room);
        break;
      }
      case "answerPair": { // host: { id, ok }
        if (!isHost || !payload) break;
        const mem = memoryOf(room);
        const pr = mem.proposals.find((x) => x.id === payload.id);
        if (!pr) break;
        mem.proposals = mem.proposals.filter((x) => x !== pr);
        if (payload.ok) mem.custom[pr.kind].push({ a: pr.a, b: pr.b, by: pr.by });
        api.toPlayer(pr.byId, "uc:proposalAnswer", { a: pr.a, b: pr.b, ok: !!payload.ok });
        api.toHost("uc:proposals", mem.proposals.map(({ byId, ...x }) => x));
        broadcastState(api, room);
        break;
      }
      case "nextSpeaker": // host: the current player has given their clue
        if (isHost && state.phase === "clues" && state.speakerIdx < speakingOrder(state).length) {
          state.speakerIdx++;
          broadcastState(api, room);
          scheduleBotClue(api, room);
        }
        break;
      case "startDebate": { // host: debate timer, then the vote opens by itself
        const sec = memoryOf(room).opts.debateSec;
        if (!isHost || state.phase !== "clues" || !sec || state.debateEndsAt) break;
        state.debateEndsAt = Date.now() + sec * 1000;
        const s0 = state;
        state.debateTimer = setTimeout(() => {
          if (room.gameState === s0 && s0.phase === "clues") module.exports.handle(api, { isHost: true, seatId: null }, room, "toVote");
        }, sec * 1000);
        broadcastState(api, room);
        break;
      }
      case "confirmElim": // host, after the last word
        if (isHost && state.phase === "defense" && state.defense) eliminate(api, room, state.defense.id);
        break;
      case "revoteDefense": // host, after the last word: everybody votes again
        if (isHost && state.phase === "defense") {
          state.defense = null; state.phase = "vote"; state.votes = {}; state.tieCandidates = null;
          state.voteSeq = (state.voteSeq || 0) + 1;
          broadcastState(api, room);
        }
        break;
      case "beginClues":
        if (isHost && state.phase === "distribution") { state.phase = "clues"; startClueTurn(api, room); broadcastState(api, room); }
        break;
      case "toVote":
        if (isHost && state.phase === "clues") {
          clearTimeout(state.debateTimer); state.debateEndsAt = null;
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
          setTimeout(() => sendAllCardsToDead(api, room), 50);
        }
        state.lastEliminated = { id, name: state.names[id], role: "mrwhite" };
        state.mrwhiteGuessing = null;
        state.phase = "reveal";
        broadcastState(api, room);
        break;
      }
      case "next":
        if (isHost && state.phase === "reveal") {
          if (state.winner) { state.phase = "ended"; finishGame(room); }
          else {
            state.phase = "clues";
            state.round += 1;
            state.votes = {};
            state.mrwhiteGuessResult = null;
            // New round -> a brand new random turn order (Mr. White still not 1st/2nd).
            const mr = Object.keys(state.roles).find((id) => state.roles[id] === "mrwhite" && state.alive[id]);
            state.order = mrWhiteLate(shuffle(state.order), mr, state.alive);
            startClueTurn(api, room);
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
    if (who && who.seatId && state.alive && state.alive[who.seatId] === false) setTimeout(() => sendAllCardsToDead(api, room), 50);
    if (who && who.isHost) api.toHost("uc:proposals", memoryOf(room).proposals.map(({ byId, ...x }) => x));
    if (who && who.seatId && state.phase === "vote" && state.votes && state.votes[who.seatId]) {
      broadcastState(api, room); // state first (the phone needs voteSeq), then "already voted"
      api.toPlayer(who.seatId, "uc:voted", { targetId: state.votes[who.seatId] });
      return;
    }
    broadcastState(api, room); // resends the public board to everyone (incl. the returner)
  },

  onPlayerLeave(api, room, playerId) {
    const state = room.gameState;
    if (!state) return;
    if (state.phase === "settings") { delete state.settings.votes[playerId]; broadcastState(api, room); return; }
    if (state.alive[playerId] === undefined) return;
    const wasAlive = state.alive[playerId];
    state.alive[playerId] = false;
    delete state.votes[playerId];
    if (wasAlive) state.lastLeft = { name: state.names[playerId], at: Date.now() };
    // Mr. White left while guessing: the guess counts as missed (no more freeze).
    if (state.phase === "mrwhite" && state.mrwhiteGuessing === playerId) {
      state.mrwhiteGuessResult = { guess: "", correct: false, left: true };
      state.lastEliminated = { id: playerId, name: state.names[playerId], role: "mrwhite" };
      state.mrwhiteGuessing = null;
      checkWinner(state);
      state.phase = "reveal";
      return broadcastState(api, room);
    }
    checkWinner(state);
    if (state.winner && state.phase !== "ended") { state.phase = "ended"; finishGame(room); return broadcastState(api, room); }
    if (state.phase === "defense" && state.defense && state.defense.id === playerId) { // the accused left
      state.defense = null; state.phase = "reveal"; state.lastEliminated = { id: playerId, name: state.names[playerId], role: state.roles[playerId] };
      return broadcastState(api, room);
    }
    if (state.phase === "vote") {
      // votes FOR the one who left are void: those voters vote again
      const lost = Object.keys(state.votes).filter((v) => state.votes[v] === playerId);
      lost.forEach((v) => { delete state.votes[v]; api.toPlayer(v, "uc:revote", { name: state.names[playerId] }); });
      if (state.tieCandidates) {
        state.tieCandidates = state.tieCandidates.filter((id) => id !== playerId);
        if (state.tieCandidates.length < 2) state.tieCandidates = null;
      }
      // everyone still here has voted -> count now (before, it waited forever)
      if (aliveIds(state).length && aliveIds(state).every((id) => state.votes[id])) return resolveVote(api, room);
    }
    broadcastState(api, room);
  },
};

// Open (or re-open, on replay) the 60s settings vote.
function openSettings(api, room) {
  const endsAt = Date.now() + SETTINGS_SECONDS * 1000;
  room.gameState = {
    phase: "settings",
    settings: { votes: {}, endsAt, mrWhite: false, mode: "classique", timer: null,
      nbUnder: (room.ucMemory && room.ucMemory.nbUnder) || "auto" }, // kept for the next game
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
