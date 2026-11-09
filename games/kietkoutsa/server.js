// games/kietkoutsa/server.js -- "Kietkoutsa Reborn" ("qui ecoute ca ?").
//
// Players secretly pick songs (through the engine's music service). Each round a
// song plays while everyone votes for WHO picked it.
//
// PHASES:  settings -> submit -> playing <-> reveal -> ended
//
// What this file adds on top of the original game:
//   modes (classic / usurp / truebluff / mashup), blind mode + blind-test guesses,
//   imposed theme, confidence bets, jokers, hints, live vote trend, final round x2,
//   2-suspect vote for big groups, speed bonus, combos, two rankings, badges,
//   confusion matrix, submit timer, anti-duplicate, secret notes, explicit filter,
//   synced start, early end, auto-next, song ratings, "wrapped" stats, tournament,
//   host-plays-or-not, custom avatars, late join, smarter bots, safe leave.
//
// Players are ALWAYS identified by their stable seatId. Owners stay secret in
// the public state until the round's reveal.

const D = require("./data");
const { CFG, SETTINGS, JOKERS, defaultSettings, cleanSetting, revealAnimMs } = require("./config");
const { shuffle, pick, fuzzyEq, artistMatch, trackKey, sameTrack } = require("./util");
const { computeFinal: computeFinalRaw } = require("./final");
const makeBots = require("./bots");

const HOST_SEAT = "__host__"; // the host's seat when the host plays too
const MIN_PLAYERS = 2;        // engine check (phones); we need 3 PARTICIPANTS to begin

// ---------- who is who ----------
function seatOf(room, id) { return (room.players || []).find((x) => x.seatId === id); }
function isBot(room, id) { const p = seatOf(room, id); return !!(p && p.isBot); }
function isConnected(api, id) { return id === HOST_SEAT ? true : api.connected(id); }
// Participants still in the game (not gone).
function active(s) { return s.players.filter((id) => !s.left[id]); }
// Who can own songs = active participants who did not arrive late.
function owners(s) { return active(s).filter((id) => !s.late[id]); }
// Who may vote this round = active participants.
function voters(s) { return active(s); }
// The suspects for one part of the round: possible owners + the real owner
// (kept even if they left mid-round, as a "ghost", so the round stays solvable).
function suspects(s, owner) {
  const list = owners(s);
  if (!list.includes(owner)) list.push(owner);
  return list;
}
function duoOn(s) {
  if (!s.round || s.round.parts.length !== 1) return false;
  if (s.settings.duo === "on") return true;
  if (s.settings.duo === "off") return false;
  return active(s).length >= 8; // "auto": big groups only
}
function tell(api, id, event, data) {
  if (id === HOST_SEAT) api.toHost(event, data);
  else api.toPlayer(id, event, data);
}
function toast(api, id, msg) { tell(api, id, "kkt:toast", { msg }); }

function clearTimers(s) {
  if (!s) return;
  Object.values(s.timers || {}).forEach((t) => clearTimeout(t));
  s.timers = {};
  (s.botTimers || []).forEach(clearTimeout);
  s.botTimers = [];
}

// ---------- seating ----------
function seatParticipant(s, id, name, opts) {
  opts = opts || {};
  if (!s.players.includes(id)) s.players.push(id);
  delete s.left[id];
  s.names[id] = name;
  // the avatar is the player's own pixel-art face, managed by the engine
  if (opts.avatar) s.avatars[id] = opts.avatar;
  else if (!(id in s.avatars)) s.avatars[id] = null;
  if (s.scores[id] == null) s.scores[id] = 0;
  s.det[id] = s.det[id] || 0; s.cam[id] = s.cam[id] || 0;
  s.streak[id] = s.streak[id] || 0;
  s.jokersUsed[id] = s.jokersUsed[id] || {};
  s.stats[id] = s.stats[id] || { correct: 0, voted: 0, sheep: 0, fast: 0, betLoss: 0, blind: 0, maxStreak: 0, ownRounds: 0, ownFound: 0, ownVoters: 0 };
  if (opts.late) s.late[id] = true;
}

// bots get the few game functions they need (defined below; hoisted)
const { fillBots, scheduleBotVotes, botRatings } = makeBots({
  owners, voters, suspects, duoOn, isBot, allSubs,
  afterVote: (api, room) => afterVote(api, room), rate: (...a) => rate(...a), broadcast: (...a) => broadcast(...a),
});
function computeFinal(s) {
  computeFinalRaw(s, ratingOf);
  // the recap is built: free what is no longer needed (big track lists)
  s.queue = []; s.subs = {}; s.round = null; s.trackScores = []; s.conf = {};
}

// ---------- submissions ----------
function allSubs(s) {
  const out = [];
  Object.values(s.subs).forEach((l) => (l || []).forEach((t) => out.push(t)));
  return out;
}
function submitReady(api, s) {
  return owners(s).every((id) =>
    !isConnected(api, id) || (s.subs[id] || []).length >= s.settings.perPlayer);
}
// Builds the list of rounds. Avoids the same owner twice in a row; in Mashup,
// pairs two songs of two DIFFERENT owners in each round.
function buildQueue(s) {
  const items = [];
  owners(s).forEach((id) => (s.subs[id] || []).forEach((t) => items.push({ owner: id, track: t })));
  let list = shuffle(items);
  for (let i = 1; i < list.length; i++) { // spread owners apart
    if (list[i].owner === list[i - 1].owner) {
      const j = list.findIndex((x, k) => k > i && x.owner !== list[i - 1].owner);
      if (j > 0) [list[i], list[j]] = [list[j], list[i]];
    }
  }
  if (s.settings.mode !== "mashup") return list.map((x) => ({ parts: [x] }));
  const rounds = [];
  const pool = list.slice();
  while (pool.length) {
    const a = pool.shift();
    const j = pool.findIndex((x) => x.owner !== a.owner);
    if (j >= 0) rounds.push({ parts: [a, pool.splice(j, 1)[0]] });
    else rounds.push({ parts: [a] });
  }
  return rounds;
}
function assignTargets(s) { // usurp: everyone gets someone else to imitate
  const ids = owners(s);
  s.targets = {};
  if (ids.length < 2) return;
  const sh = shuffle(ids);
  sh.forEach((id, i) => (s.targets[id] = sh[(i + 1) % sh.length])); // a cycle: nobody gets themselves
}

function startRounds(api, room, force) {
  const s = room.gameState;
  if (s.phase !== "submit") return false;
  if (!force && !submitReady(api, s)) return false;
  // Anyone who did not finish is simply skipped (their partial picks still count).
  const queue = buildQueue(s);
  if (!queue.length) {
    s.phase = "ended"; s.endReason = "Personne n'a proposé de son.";
    clearTimers(s); computeFinal(s); broadcast(api, room);
    return true;
  }
  clearTimeout(s.timers.submit);
  s.queue = queue;
  s.idx = 0;
  startRound(api, room);
  return true;
}

// ---------- rounds ----------
function startRound(api, room) {
  const s = room.gameState;
  clearTimers(s);
  s.roundNo = (s.roundNo || 0) + 1;
  // skip songs without any playable excerpt (e.g. a bot's fallback track)
  while (s.idx < s.queue.length) {
    const it = s.queue[s.idx];
    it.parts = it.parts.filter((p) => p.track.preview);
    if (it.parts.length) break;
    s.idx++;
  }
  if (s.idx >= s.queue.length) { s.phase = "ended"; computeFinal(s); return broadcast(api, room); }
  const item = s.queue[s.idx];
  s.round = {
    parts: item.parts, votes: {}, eliminated: [[], []], trend: null,
    scrambled: false, doubles: {}, guesses: {}, ratings: {},
  };
  s.phase = "playing";
  s.roundMs = s.settings.roundSec * 1000;
  s.startsAt = Date.now() + CFG.LEAD_MS;
  s.endsAt = s.startsAt + s.roundMs;
  scheduleRoundTimers(api, room);
  scheduleBotVotes(api, room);
  broadcast(api, room);
  // Preview links can expire: ask the catalogue for a fresh one right now. If it
  // changed, re-broadcast (players start at startsAt, so it is usually in time).
  const roundNo = s.roundNo;
  item.parts.forEach((part) => {
    // Only when the link is about to expire. Refreshing a still-valid link gives
    // a NEW address: every device would then reload the sound (= a delay).
    if (!api.music || !part.track.preview || !linkExpiring(api, part.track.preview, 3 * 60000)) return;
    refreshPart(api, part).then((changed) => {
      if (changed && room.gameState === s && s.roundNo === roundNo && s.phase === "playing") broadcast(api, room);
    });
  });
}

// Ask the catalogue for a fresh preview link (they can expire). Resolves true if
// the link changed.
function refreshPart(api, part) {
  part.track.refreshedAt = Date.now();
  return api.music.refresh(part.track).then((url) => {
    if (url && url !== part.track.preview) { part.track.preview = url; warmTrack(api, part.track); return true; }
    return false;
  }).catch(() => false);
}
function linkExpiring(api, url, withinMs) {
  return api.music && api.music.needsRefresh ? api.music.needsRefresh(url, withinMs) : false;
}
// Ask the server's music service to download a preview NOW (into memory), so the
// host screen gets it instantly when the round starts.
function warmTrack(api, track) {
  if (api.music && api.music.warm && track && track.preview) api.music.warm(track.preview);
}

// A song that cannot be played (no preview, dead link): drop it and move on.
function skipUnplayable(api, room, why) {
  const s = room.gameState;
  api.toAll("kkt:toast", { msg: "🔇 " + (why || "Extrait indisponible") + " : on passe au suivant." });
  nextRound(api, room);
}

// (Re)arms the end / hint / trend timers from s.endsAt (used after +15s too).
function scheduleRoundTimers(api, room) {
  const s = room.gameState;
  const roundNo = s.roundNo;
  const guard = (fn) => () => { if (room.gameState === s && s.phase === "playing" && s.roundNo === roundNo) fn(); };
  ["end", "hint", "trend"].forEach((k) => clearTimeout(s.timers[k]));
  const now = Date.now();
  s.timers.end = setTimeout(guard(() => endRound(api, room)), Math.max(0, s.endsAt - now));
  if (s.settings.hints && s.roundMs >= 15000) {
    const hintAt = s.endsAt - CFG.HINT_BEFORE_MS;
    if (!s.round.hintDone) s.timers.hint = setTimeout(guard(() => giveHint(api, room)), Math.max(0, hintAt - now));
    const trendAt = s.endsAt - CFG.TREND_BEFORE_MS;
    if (!s.round.trend) s.timers.trend = setTimeout(guard(() => giveTrend(api, room)), Math.max(0, trendAt - now));
  }
}

// Hint: grey out one wrong suspect per part (never the real owner).
function giveHint(api, room) {
  const s = room.gameState;
  s.round.hintDone = true;
  s.round.parts.forEach((part, i) => {
    const fakes = suspects(s, part.owner).filter((x) => x !== part.owner && !s.round.eliminated[i].includes(x));
    if (fakes.length >= 2) s.round.eliminated[i].push(pick(fakes)); // keep at least one fake
  });
  broadcast(api, room);
}
// Trend: the anonymous split of the votes so far (counts per suspect).
function giveTrend(api, room) {
  const s = room.gameState;
  s.round.trend = s.round.parts.map((part, i) => {
    const c = {};
    Object.values(s.round.votes).forEach((v) => { const t = v.p[i]; if (t) c[t] = (c[t] || 0) + 1; });
    return c;
  });
  broadcast(api, room);
}

function voteComplete(s, v) {
  if (!v) return false;
  return s.round.parts.every((_, i) => v.p[i] != null);
}
// After any vote: maybe shorten the round if every connected voter is done.
function afterVote(api, room) {
  const s = room.gameState;
  if (s.settings.earlyEnd) {
    const need = voters(s).filter((id) => isConnected(api, id));
    if (need.length && need.every((id) => voteComplete(s, s.round.votes[id]))) {
      const target = Math.max(Date.now(), s.startsAt) + CFG.EARLY_END_MS;
      if (target < s.endsAt) { s.endsAt = target; scheduleRoundTimers(api, room); }
    }
  }
  broadcastSoon(api, room);
}

function rate(s, track, voter, v) {
  const k = trackKey(track);
  s.ratings[k] = s.ratings[k] || {};
  s.ratings[k][voter] = v > 0 ? 1 : -1;
}
function ratingOf(s, track) {
  const r = s.ratings[trackKey(track)] || {};
  return Object.values(r).reduce((a, b) => a + b, 0);
}

// ---------- scoring ----------
// Points (all multiplied by 2 on the final round if "finale x2" is on):
//   voter, per part: right first pick = +1 (+2 if the 2-suspect vote is on),
//     right 2nd pick only = +1, speed bonus +1 (right pick in the first 40%),
//     locked "Je suis sur" + right = +1, nature right (Vrai ou Bluff) = +1,
//     blind test: right title +1, right artist +1.
//   bets: a right pick is multiplied by the bet; a wrong one LOSES (bet - 1).
//   combo: every 3 right rounds in a row = +2.
//   owner: +1 per voter who picked someone ELSE (players who did not vote give
//     nothing -> no free points from AFK players); Usurpation: +1 more per vote
//     that landed on the person they imitated.
//   joker "double": the user's gains of this round x2.
function endRound(api, room) {
  const s = room.gameState;
  if (!s || s.phase !== "playing") return;
  clearTimers(s);
  const r = s.round;
  const last = s.idx + 1 >= s.queue.length;
  const mult = last && s.settings.finalDouble ? 2 : 1;
  const duo = duoOn(s);
  const gains = {};   // id -> points won this round (before the final x2)
  const add = (id, n) => { gains[id] = (gains[id] || 0) + n; };
  const detGain = {}, camGain = {};

  // plurality per part (for the "sheep" badge)
  const plural = r.parts.map((_, i) => {
    const c = {};
    Object.values(r.votes).forEach((v) => { if (v.p[i]) c[v.p[i]] = (c[v.p[i]] || 0) + 1; });
    return Object.keys(c).sort((a, b) => c[b] - c[a])[0] || null;
  });

  const partsOut = r.parts.map((part, i) => {
    const owner = part.owner;
    let found = 0, wrong = 0, onTarget = 0;
    const foundNames = [];
    Object.keys(r.votes).forEach((voter) => {
      if (voter === owner) return; // the owner's decoy vote never scores
      const v = r.votes[voter];
      const choice = v.p[i];
      const secondOk = duo && i === 0 && v.second === owner && choice !== owner;
      if (choice == null && !secondOk) return; // no vote = no effect at all
      const st = s.stats[voter];
      if (st) st.voted++;
      if (st && choice && choice === plural[i]) st.sheep++;
      let pts = 0;
      if (choice === owner) {
        found++; foundNames.push(s.names[voter]);
        pts = duo ? 2 : 1;
        if (st) st.correct++;
        const early = v.at - s.startsAt <= s.roundMs * 0.4;
        if (s.settings.speed && early) { pts += 1; if (st) st.fast++; }
        if (v.locked) pts += 1;
        // confusion matrix is only about wrong picks; nothing to record here
      } else if (secondOk) {
        found++; foundNames.push(s.names[voter] + " (2e choix)");
        pts = 1;
      } else {
        wrong++;
        if (choice) {
          s.conf[owner] = s.conf[owner] || {};
          s.conf[owner][choice] = (s.conf[owner][choice] || 0) + 1;
          if (s.settings.mode === "usurp" && s.targets[owner] === choice) onTarget++;
        }
      }
      if (s.settings.bets) {
        const bet = v.bet || 1;
        if (pts > 0) pts *= bet;
        else { pts = -(bet - 1); if (st) st.betLoss += bet - 1; }
      }
      add(voter, pts); detGain[voter] = (detGain[voter] || 0) + pts;
    });
    let ownerPts = 0;
    if (!s.left[owner]) {
      ownerPts = wrong + onTarget;
      add(owner, ownerPts); camGain[owner] = (camGain[owner] || 0) + ownerPts;
    }
    const ost = s.stats[owner];
    if (ost) { ost.ownRounds++; ost.ownFound += found; ost.ownVoters += found + wrong; }
    s.trackScores.push({ owner, track: part.track, points: ownerPts, found, voters: found + wrong });
    return {
      track: part.track, ownerId: owner, ownerName: s.names[owner] || "?", ownerAvatar: s.avatars[owner],
      note: part.track.note || "", nature: part.track.nature || null,
      targetName: s.settings.mode === "usurp" && s.targets[owner] ? s.names[s.targets[owner]] : null,
      ownerPts, found, onTarget, foundNames,
    };
  });

  // nature (Vrai ou Bluff) + blind-test guesses
  Object.keys(r.votes).forEach((voter) => {
    const v = r.votes[voter];
    if (s.settings.mode === "truebluff" && v.nature && r.parts[0].owner !== voter && v.nature === r.parts[0].track.nature) {
      add(voter, 1); detGain[voter] = (detGain[voter] || 0) + 1;
    }
  });
  Object.keys(r.guesses).forEach((voter) => {
    const g = r.guesses[voter];
    const n = (g.title ? 1 : 0) + (g.artist ? 1 : 0);
    if (n) { add(voter, n); detGain[voter] = (detGain[voter] || 0) + n; if (s.stats[voter]) s.stats[voter].blind += n; }
  });

  // combos (3 right rounds in a row), per voter
  const combos = [];
  voters(s).forEach((id) => {
    const v = r.votes[id];
    const owned = r.parts.some((p) => p.owner === id);
    if (owned) return; // owning a song neither breaks nor builds a streak
    const right = v && r.parts.some((p, i) => v.p[i] === p.owner);
    if (right) {
      s.streak[id] = (s.streak[id] || 0) + 1;
      const st = s.stats[id]; if (st) st.maxStreak = Math.max(st.maxStreak, s.streak[id]);
      if (s.streak[id] % 3 === 0) { add(id, 2); detGain[id] = (detGain[id] || 0) + 2; combos.push(s.names[id]); }
    } else s.streak[id] = 0;
  });

  // jokers "double" and the final x2, then apply (a total never goes below 0)
  const final = {};
  Object.keys(gains).forEach((id) => {
    let g = gains[id];
    if (g > 0 && r.doubles[id]) g *= 2;
    if (g > 0) g *= mult;
    final[id] = g;
    s.scores[id] = Math.max(0, (s.scores[id] || 0) + g);
    const ratio = gains[id] ? g / gains[id] : 1;
    s.det[id] = Math.max(0, (s.det[id] || 0) + Math.round((detGain[id] || 0) * ratio));
    s.cam[id] = (s.cam[id] || 0) + Math.round((camGain[id] || 0) * ratio);
  });

  const voteList = Object.keys(r.votes).filter((id) => s.names[id]).map((id) => {
    const v = r.votes[id];
    return {
      id, name: s.names[id], avatar: s.avatars[id], picks: v.p.slice(0, r.parts.length),
      second: v.second || null, bet: v.bet || 1, locked: !!v.locked, nature: v.nature || null,
      gained: final[id] || 0,
    };
  });
  s.result = { parts: partsOut, votes: voteList, gains: final, mult, combos, duo, doubles: Object.keys(r.doubles).map((id) => s.names[id]) };
  s.phase = "reveal";
  s.revealAt = Date.now();
  s.result.animMs = revealAnimMs(voteList.length); // phones wait this long (no spoiler)
  // get the next song ready during the reveal: fresh link if needed, in memory
  const nextItem = s.queue[s.idx + 1];
  if (nextItem && api.music) nextItem.parts.forEach((p) => {
    if (!p.track.preview) return;
    if (linkExpiring(api, p.track.preview, 15 * 60000)) refreshPart(api, p);
    else warmTrack(api, p.track);
  });
  botRatings(room);
  if (s.settings.autoNext) {
    const ms = CFG.REVEAL_BASE_MS + CFG.REVEAL_PER_VOTE_MS * voteList.length;
    const roundNo = s.roundNo;
    s.timers.reveal = setTimeout(() => {
      if (room.gameState === s && s.phase === "reveal" && s.roundNo === roundNo) nextRound(api, room);
    }, ms);
    s.nextAt = Date.now() + ms;
  } else s.nextAt = 0;
  broadcast(api, room);
}

function nextRound(api, room) {
  const s = room.gameState;
  clearTimers(s);
  s.idx++;
  if (s.idx < s.queue.length) startRound(api, room);
  else { s.phase = "ended"; computeFinal(s); broadcast(api, room); }
}

// ---------- broadcasting ----------
function leaderboard(s) {
  return s.players.filter((id) => s.names[id])
    .map((id) => ({ id, name: s.names[id], avatar: s.avatars[id], score: s.scores[id] || 0,
      det: s.det[id] || 0, cam: s.cam[id] || 0, left: !!s.left[id], late: !!s.late[id],
      total: s.tournament.games ? (s.tournament.totals[id] || 0) : null }))
    .sort((a, b) => b.score - a.score);
}
function pubPlayers(api, s, extra) {
  return active(s).map((id) => Object.assign({
    id, name: s.names[id], avatar: s.avatars[id], connected: isConnected(api, id),
    late: !!s.late[id], host: id === HOST_SEAT,
  }, extra ? extra(id) : {}));
}
// What a track looks like publicly during a round (hidden in blind / scramble).
function pubTrack(s, t) {
  const hide = s.settings.blind || s.round.scrambled;
  return hide
    ? { title: "???", artist: "???", cover: "", preview: t.preview, hidden: true }
    : { title: t.title, artist: t.artist, cover: t.cover, preview: t.preview, hidden: false };
}

// Static data (mode list, avatar choices) never changes: sent once per arrival
// instead of in every state message.
function sendStatic(api) {
  api.toAll("kkt:static", { modes: D.MODES, settingsUI: D.SETTINGS_UI });
}

// Small, frequent changes (a vote, a bet, a rating...) are GROUPED: one send
// at most every 120 ms instead of one per click. Phase changes still go out
// immediately through broadcast().
const BATCH_MS = 120;
function broadcastSoon(api, room) {
  const s = room.gameState;
  if (!s || s.timers.batch) return;
  s.timers.batch = setTimeout(() => {
    if (room.gameState !== s) return;
    s.timers.batch = null;
    broadcast(api, room);
  }, BATCH_MS);
}

// Sends the public state. The FIRST message of a phase is complete ("kkt:state");
// after that, only the parts that changed are sent ("kkt:patch"): e.g. a vote only
// sends the vote counter and the player list, not the whole round again.
function sendPublic(api, s, pub, force) {
  if (!pub) return;
  const full = force || !s.lastPub || s.lastPub.phase !== JSON.stringify(pub.phase);
  const enc = {};
  Object.keys(pub).forEach((k) => { if (k !== "serverNow") enc[k] = JSON.stringify(pub[k]); });
  if (full) {
    s.lastPub = enc;
    api.toAll("kkt:state", pub);
    return;
  }
  const patch = {};
  Object.keys(enc).forEach((k) => { if (s.lastPub[k] !== enc[k]) patch[k] = pub[k]; });
  Object.keys(s.lastPub).forEach((k) => { if (!(k in enc)) patch[k] = null; });
  s.lastPub = enc;
  if (!Object.keys(patch).length) return; // nothing changed: send nothing
  patch.phase = pub.phase; patch.serverNow = pub.serverNow;
  api.toAll("kkt:patch", patch);
}

// force = true re-sends everything (full state + private info) to everyone
// (reconnections, a new phone arriving).
function broadcast(api, room, force) {
  const s = room.gameState;
  if (!s) return;
  if (s.timers.batch) { clearTimeout(s.timers.batch); s.timers.batch = null; } // this send covers it
  const base = {
    phase: s.phase, settings: s.settings, serverNow: Date.now(),
    mode: D.MODES[s.settings.mode], theme: s.themeText || null,
    tournament: s.tournament.games ? { games: s.tournament.games } : null,
  };

  let pub = null;
  if (s.phase === "settings") {
    const tally = {};
    Object.values(s.modeVotes).forEach((m) => (tally[m] = (tally[m] || 0) + 1));
    pub = (Object.assign(base, {
      modeTally: tally, hostName: s.names[HOST_SEAT] || s.hostName, phones: api.players().length,
      players: pubPlayers(api, s),
    }));
  } else if (s.phase === "submit") {
    pub = (Object.assign(base, {
      perPlayer: s.settings.perPlayer, submitEndsAt: s.submitEndsAt || 0,
      ready: submitReady(api, s), totalSubs: allSubs(s).length,
      players: pubPlayers(api, s, (id) => ({ done: (s.subs[id] || []).length, owner: !s.late[id] })),
    }));
  } else if (s.phase === "playing") {
    const r = s.round;
    pub = (Object.assign(base, {
      round: s.idx + 1, total: s.queue.length, final: s.idx + 1 >= s.queue.length && s.settings.finalDouble,
      parts: r.parts.map((p) => pubTrack(s, p.track)), // owners hidden!
      suspects: r.parts.map((p) => suspects(s, p.owner)),
      startsAt: s.startsAt, endsAt: s.endsAt, roundMs: s.roundMs,
      eliminated: r.eliminated.slice(0, r.parts.length), trend: r.trend, duo: duoOn(s),
      scrambled: r.scrambled,
      votedCount: Object.keys(r.votes).filter((id) => voteComplete(s, r.votes[id])).length,
      voterCount: voters(s).length,
      players: pubPlayers(api, s, (id) => ({
        voted: voteComplete(s, r.votes[id]), locked: !!(r.votes[id] && r.votes[id].locked),
        score: s.scores[id] || 0, ghost: false,
      })).concat(r.parts.filter((p) => s.left[p.owner] && s.names[p.owner]).map((p) => ({
        id: p.owner, name: s.names[p.owner], avatar: s.avatars[p.owner], connected: false, ghost: true,
      }))),
    }));
  } else if (s.phase === "reveal") {
    const nextItem = s.queue[s.idx + 1];
    pub = (Object.assign(base, {
      round: s.idx + 1, total: s.queue.length, result: s.result, leaderboard: leaderboard(s),
      last: s.idx + 1 >= s.queue.length, nextAt: s.nextAt || 0, revealAt: s.revealAt || 0,
      // preload the next song(s) during the reveal (only the audio, no owner)
      nextPreviews: nextItem ? nextItem.parts.map((p) => p.track.preview).filter(Boolean) : [],
      ratings: s.result.parts.map((p) => ratingOf(s, p.track)),
    }));
  } else if (s.phase === "ended") {
    const lb = leaderboard(s); // computed once
    pub = (Object.assign(base, {
      leaderboard: lb, endReason: s.endReason || null, final: s.final,
      detBoard: lb.slice().sort((a, b) => b.det - a.det),
      camBoard: lb.slice().sort((a, b) => b.cam - a.cam),
    }));
  }
  sendPublic(api, s, pub, force);


  // Private per-participant info (own picks, own vote, own jokers...), sent only
  // when it actually changed for that person.
  s.lastYou = s.lastYou || {};
  active(s).forEach((id) => {
    const y = youOf(s, id);
    const str = JSON.stringify(y);
    if (!force && s.lastYou[id] === str) return;
    s.lastYou[id] = str;
    tell(api, id, "kkt:you", y);
  });
}

function youOf(s, id) {
  const r = s.round;
  const playing = s.phase === "playing" && r;
  const owned = playing ? r.parts.map((p, i) => (p.owner === id ? i : -1)).filter((i) => i >= 0) : [];
  const v = playing ? r.votes[id] : null;
  const used = s.jokersUsed[id] || {};
  return {
    id, name: s.names[id], avatar: s.avatars[id],
    subs: s.subs[id] || [], perPlayer: s.settings.perPlayer,
    late: !!s.late[id], modeVote: s.modeVotes[id] || null,
    target: s.settings.mode === "usurp" && s.targets[id] ? { id: s.targets[id], name: s.names[s.targets[id]] } : null,
    vote: v ? { p: v.p, second: v.second, bet: v.bet, locked: v.locked, nature: v.nature } : null,
    ownedParts: owned, isOwner: owned.length > 0,
    jokers: s.settings.jokers ? JOKERS.filter((j) => !used[j]) : [],
    doubleOn: !!(playing && r.doubles[id]),
    guess: playing && r.guesses[id] ? r.guesses[id] : null,
    rated: s.phase === "reveal" && s.result ? s.result.parts.map((p) => ((s.ratings[trackKey(p.track)] || {})[id]) || 0) : [],
  };
}

// ---------- module ----------
function newState(api, room, prev, keepScores) {
  const s = {
    phase: "settings",
    settings: prev ? Object.assign({}, prev.settings) : defaultSettings(),
    hostName: prev ? (prev.names[HOST_SEAT] || prev.hostName) : "Hôte",
    players: [], left: {}, late: {},
    names: {}, avatars: {}, scores: {}, det: {}, cam: {}, streak: {}, jokersUsed: {}, stats: {},
    subs: {}, queue: [], idx: -1, round: null, roundNo: 0, result: null,
    modeVotes: {}, targets: {}, themeText: null, ratings: {}, conf: {},
    startsAt: 0, endsAt: 0, roundMs: 30000, submitEndsAt: 0, nextAt: 0,
    timers: {}, botTimers: [], trackScores: [], final: null,
    tournament: keepScores && prev ? prev.tournament : { games: 0, totals: {} },
  };
  const phones = api.players();
  // Default: the host plays from the shared screen only if there are too few phones.
  if (!prev) s.settings.hostPlays = phones.length < 3;
  phones.forEach((p) => seatParticipant(s, p.id, p.name, { avatar: p.avatar }));
  if (s.settings.hostPlays) seatParticipant(s, HOST_SEAT, s.hostName, { avatar: hostAvatar(api) });
  return s;
}

const hostAvatar = (api) => (api.hostAvatar ? api.hostAvatar() : null);
function setHostPlays(api, s, on) {
  s.settings.hostPlays = on;
  if (on) seatParticipant(s, HOST_SEAT, s.hostName, { avatar: hostAvatar(api) });
  else {
    s.players = s.players.filter((id) => id !== HOST_SEAT);
    delete s.modeVotes[HOST_SEAT];
  }
}

module.exports = {
  id: "kietkoutsa",
  minPlayers: MIN_PLAYERS,
  _cfg: CFG,          // exposed for the automated tests only
  _fuzzy: { fuzzyEq, artistMatch },

  start(api, room) {
    clearTimers(room.gameState);
    room.gameState = newState(api, room, null, false);
    sendStatic(api);
    broadcast(api, room);
  },

  // Late arrivals are welcome until the game is over (they cannot own songs once
  // the submissions are closed: they play as "detectives" from the next round).
  allowLateJoin(room) {
    const s = room.gameState;
    return !!s && s.phase !== "ended" && active(s).length < 16;
  },
  onPlayerJoin(api, room, seatId) {
    const s = room.gameState;
    const seat = seatOf(room, seatId);
    if (!s || !seat) return;
    const late = s.phase !== "settings" && s.phase !== "submit";
    seatParticipant(s, seatId, seat.name, { late, avatar: seat.avatar });
    if (s.phase === "submit") {
      s.subs[seatId] = [];
      if (s.settings.mode === "usurp") { // give them someone to imitate
        const others = owners(s).filter((x) => x !== seatId);
        if (others.length) s.targets[seatId] = pick(others);
      }
      if (seat.isBot) fillBots(api, room, seatId); // a bot added now picks its songs too
    }
    sendStatic(api);
    broadcast(api, room, true);
  },

  handle(api, actor, room, type, payload) {
    const s = room.gameState;
    if (!s) return;
    const host = actor.isHost;
    const me = host ? HOST_SEAT : actor.seatId; // the host plays as the HOST seat
    const amIn = s.players.includes(me) && !s.left[me];
    payload = payload || {};

    // ----- settings -----
    if (s.phase === "settings") {
      if (type === "voteMode" && amIn && D.MODES[payload.mode]) {
        s.modeVotes[me] = payload.mode; return broadcastSoon(api, room);
      }
      if (!host) return;
      if (type === "setSetting") {
        const v = cleanSetting(payload.key, payload.value);
        if (v === undefined) return;
        if (payload.key === "perPlayer" && s.settings.mode === "truebluff") return; // always 2 there
        if (payload.key === "hostPlays") setHostPlays(api, s, v);
        else s.settings[payload.key] = v;
        if (payload.key === "mode" && v === "truebluff") s.settings.perPlayer = 2;
        return broadcast(api, room);
      }
      // legacy action names (kept so old clients still work)
      if (type === "setPerPlayer") { s.settings.perPlayer = cleanSetting("perPlayer", payload.n) || 1; return broadcast(api, room); }
      if (type === "setPlayback") { s.settings.playback = payload.mode === "host" ? "host" : "all"; return broadcast(api, room); }
      if (type === "setHostName") {
        const n = String(payload.name || "").trim().slice(0, 16);
        if (n) { s.hostName = n; if (s.names[HOST_SEAT]) s.names[HOST_SEAT] = n; }
        return broadcast(api, room);
      }
      if (type === "applyModeVote") {
        const tally = {};
        Object.values(s.modeVotes).forEach((m) => (tally[m] = (tally[m] || 0) + 1));
        const top = Object.keys(tally).sort((a, b) => tally[b] - tally[a])[0];
        if (top) { s.settings.mode = top; if (top === "truebluff") s.settings.perPlayer = 2; }
        return broadcast(api, room);
      }
      if (type === "beginSubmit") {
        if (owners(s).length < 3) {
          return toast(api, HOST_SEAT, "Il faut au moins 3 participants : active « Le host joue aussi » ou ajoute des joueurs.");
        }
        if (s.settings.mode === "truebluff") s.settings.perPlayer = 2;
        s.phase = "submit";
        s.themeText = s.settings.theme ? pick(D.THEMES) : null;
        s.players.forEach((id) => (s.subs[id] = []));
        if (s.settings.mode === "usurp") assignTargets(s);
        if (s.settings.submitSec) {
          s.submitEndsAt = Date.now() + s.settings.submitSec * 1000;
          s.timers.submit = setTimeout(() => {
            if (room.gameState === s && s.phase === "submit") startRounds(api, room, true);
          }, s.settings.submitSec * 1000);
        }
        broadcast(api, room);
        fillBots(api, room);
      }
      return;
    }

    // ----- submissions -----
    if (s.phase === "submit") {
      if (type === "submitTrack" && amIn && !s.late[me]) {
        const t = api.music ? api.music.sanitizeTrack(payload.track) : null;
        const mine = s.subs[me] = s.subs[me] || [];
        if (!t) return toast(api, me, "Ce morceau n'a pas d'extrait jouable.");
        if (mine.length >= s.settings.perPlayer) return toast(api, me, "Tu as déjà tous tes sons.");
        if (s.settings.noExplicit && t.explicit) return toast(api, me, "Les sons explicites sont désactivés pour cette partie.");
        if (allSubs(s).some((x) => sameTrack(x, t))) return toast(api, me, "Déjà pris par quelqu'un ! Choisis-en un autre.");
        t.note = String(payload.note || "").trim().slice(0, 120);
        if (s.settings.mode === "truebluff") t.nature = mine.some((x) => x.nature === "sincere") ? "bluff" : "sincere";
        mine.push(t);
        warmTrack(api, t); // downloaded in the background while the others choose
        return broadcast(api, room);
      }
      if (type === "removeTrack" && amIn) {
        s.subs[me] = (s.subs[me] || []).filter((x) => x.id !== payload.trackId);
        return broadcast(api, room);
      }
      if (type === "setNote" && amIn) {
        const t = (s.subs[me] || []).find((x) => x.id === payload.trackId);
        if (t) t.note = String(payload.note || "").trim().slice(0, 120);
        return broadcastSoon(api, room);
      }
      if (type === "setNature" && amIn && s.settings.mode === "truebluff") {
        const nat = payload.nature === "bluff" ? "bluff" : "sincere";
        (s.subs[me] || []).forEach((x) => {
          if (x.id === payload.trackId) x.nature = nat;
          else x.nature = nat === "sincere" ? "bluff" : "sincere"; // exactly one of each
        });
        return broadcast(api, room);
      }
      if (host && type === "startRounds") {
        if (!startRounds(api, room, !!payload.force)) toast(api, HOST_SEAT, "Tout le monde n'a pas fini (utilise « Forcer »).");
      }
      return;
    }

    // ----- playing: votes, bets, lock, nature, guesses, jokers -----
    if (s.phase === "playing") {
      const r = s.round;
      // the shared screen could not play this excerpt (dead link): skip it
      if (type === "audioError" && host && payload.round === s.idx + 1) {
        if (r.audioFailed) return;
        r.audioFailed = true;
        return skipUnplayable(api, room);
      }
      if (!amIn) return;
      const v = r.votes[me] = r.votes[me] || { p: [], second: null, bet: 1, at: Date.now(), locked: false, nature: null };
      if (type === "vote") {
        if (v.locked) return;
        const part = payload.part === 1 && r.parts.length > 1 ? 1 : 0;
        const t = payload.target;
        if (t === me || !suspects(s, r.parts[part].owner).includes(t)) return;
        if (payload.slot === "second") { if (duoOn(s) && t !== v.p[0]) v.second = t; }
        else { v.p[part] = t; v.at = Date.now(); if (v.second === t) v.second = null; }
        return afterVote(api, room);
      }
      if (type === "setBet" && s.settings.bets && !v.locked) {
        v.bet = Math.max(1, Math.min(3, parseInt(payload.bet, 10) || 1)); return broadcastSoon(api, room);
      }
      if (type === "lock" && voteComplete(s, v)) { v.locked = true; return broadcast(api, room); }
      if (type === "setNature" && s.settings.mode === "truebluff" && !v.locked) {
        v.nature = payload.nature === "bluff" ? "bluff" : "sincere"; return broadcastSoon(api, room);
      }
      if (type === "guess" && s.settings.blind) {
        if (r.parts[0].owner === me) return; // no guessing your own song (the guess is about excerpt 1)
        const g = r.guesses[me] = r.guesses[me] || { title: false, artist: false };
        const tr = r.parts[0].track;
        if (!g.title && payload.title && fuzzyEq(payload.title, tr.title)) g.title = true;
        if (!g.artist && payload.artist && artistMatch(payload.artist, tr.artist)) g.artist = true;
        tell(api, me, "kkt:guessResult", g);
        return broadcast(api, room);
      }
      if (type === "joker" && s.settings.jokers) {
        const used = s.jokersUsed[me] = s.jokersUsed[me] || {};
        const kind = payload.kind;
        if (!JOKERS.includes(kind) || used[kind]) return;
        if (kind === "double") { used.double = true; r.doubles[me] = true; toast(api, me, "Joker ×2 activé pour cette manche !"); }
        else if (kind === "spy") {
          const t = payload.target;
          if (!t || t === me || !active(s).includes(t)) return;
          used.spy = true;
          const tv = r.votes[t];
          const voted = tv && tv.p[0] ? s.names[tv.p[0]] : null;
          tell(api, me, "kkt:spy", { name: s.names[t], vote: voted });
        } else if (kind === "scramble") {
          used.scramble = true; r.scrambled = true;
          api.toAll("kkt:toast", { msg: "🌀 " + s.names[me] + " a brouillé la pochette !" });
        }
        return broadcast(api, room);
      }
      return;
    }

    // ----- reveal: ratings + next -----
    if (s.phase === "reveal") {
      if (type === "rate" && amIn) {
        const part = s.result.parts[payload.part === 1 ? 1 : 0];
        if (part && part.ownerId !== me) { rate(s, part.track, me, payload.v); broadcastSoon(api, room); }
        return;
      }
      if (host && type === "next") nextRound(api, room);
      return;
    }

    // ----- ended: replay (same settings), optionally keeping a tournament -----
    if (s.phase === "ended" && host && type === "replay") {
      clearTimers(s);
      room.gameState = newState(api, room, s, !!payload.keep);
      broadcast(api, room);
    }
  },

  onCheat(api, room, cheatId) {
    const s = room.gameState;
    if (!s || s.phase !== "playing") return;
    if (cheatId === "reveal-owner") {
      api.toHost("kkt:cheatReveal", { name: s.round.parts.map((p) => s.names[p.owner]).join(" + ") });
    } else if (cheatId === "skip-track") {
      endRound(api, room);
    } else if (cheatId === "add-time") {
      s.endsAt += 15000;
      scheduleRoundTimers(api, room);
      broadcast(api, room);
    }
  },

  // A player (or the host) changed their avatar in the engine's creator.
  onAvatarChange(api, room, seatId) {
    const s = room.gameState;
    if (!s || !(seatId in s.avatars)) return;
    s.avatars[seatId] = seatId === HOST_SEAT ? hostAvatar(api) : ((api.players().find((p) => p.id === seatId) || {}).avatar || null);
    broadcastSoon(api, room);
  },

  onReconnect(api, room) {
    if (!room.gameState) return;
    sendStatic(api);
    broadcast(api, room, true);
  },

  // A player left for good: their FUTURE songs are removed from the queue; if
  // the CURRENT song is theirs it stays solvable (they remain a "ghost" suspect).
  onPlayerLeave(api, room, seatId) {
    const s = room.gameState;
    if (!s || !s.players.includes(seatId)) return;
    s.left[seatId] = true;
    delete s.modeVotes[seatId];
    if (s.round && s.round.votes) delete s.round.votes[seatId];
    if (s.phase === "submit") delete s.subs[seatId];
    if (s.queue.length) {
      const keep = s.queue.slice(0, s.idx + 1);
      const rest = s.queue.slice(s.idx + 1)
        .map((it) => ({ parts: it.parts.filter((p) => p.owner !== seatId) }))
        .filter((it) => it.parts.length);
      s.queue = keep.concat(rest);
    }
    if (active(s).length < 2 && s.phase !== "settings" && s.phase !== "ended") {
      clearTimers(s);
      s.phase = "ended"; s.endReason = "Plus assez de joueurs.";
      computeFinal(s);
    } else if (s.phase === "playing") {
      return afterVote(api, room); // maybe everyone left has voted now
    }
    broadcast(api, room);
  },
};
