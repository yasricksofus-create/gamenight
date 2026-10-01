// games/kietkoutsa/server.js -- "Kietkoutsa Reborn" ("qui ecoute ca").
//
// Players secretly submit songs (via the engine's /api/music/search). Each round
// one song plays for the length of its 30s preview while everyone votes for WHO
// they think chose it. Scoring: +1 per correct guess; the owner earns
// (nbPlayers - 1) - (nb who found them) -> the more discreet, the more points.
//
// Players are identified by their stable seatId. The chosen songs are secret:
// the public state never reveals an owner until the round's reveal.

const MIN_PLAYERS = 3;
const ROUND_MS = 30000; // a round lasts the length of the 30s preview

// Reused auto-avatars (emoji + colour) for the host display.
const AV_COLORS = ["#F04646", "#F0A020", "#F0E246", "#5DF046", "#2ED0C0",
  "#4C46F0", "#9B5DE5", "#F15BB5", "#00BBF9", "#FF7B54", "#8AC926", "#E86AF0"];
const AV_EMOJIS = ["🦊", "🐼", "🐧", "🐸", "🐙", "🦄", "🐯", "🐨", "🦁", "🐵",
  "🐰", "🐳", "🦉", "🐝", "🦖", "🐢"];

function shuffle(a) {
  a = a.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---------- BOTS (dev/solo testing) ----------
// A bot is a seat flagged isBot in room.players. Bots auto-submit a real track
// (fetched from Deezer, like a player would) and auto-vote during each round.
const BOT_QUERIES = ["lofi", "rock", "pop", "jazz", "electro", "rap", "classique", "metal", "reggae", "funk"];
function botIds(room) {
  const s = room.gameState;
  return (s ? s.players : []).filter((id) => {
    const p = (room.players || []).find((x) => x.seatId === id);
    return p && p.isBot;
  });
}
async function botTrackFor(i) {
  const q = BOT_QUERIES[i % BOT_QUERIES.length];
  try {
    if (typeof fetch === "function") {
      const r = await fetch("https://api.deezer.com/search?limit=5&q=" + encodeURIComponent(q));
      const j = await r.json();
      const t = (j.data || []).find((x) => x && x.preview);
      if (t) return { id: String(t.id), title: t.title, artist: (t.artist && t.artist.name) || "Bot", cover: (t.album && t.album.cover_medium) || "", preview: t.preview };
    }
  } catch (e) {}
  return { id: "bot" + i + "_" + Date.now(), title: "Morceau du Bot", artist: "Bot", cover: "", preview: "" };
}
function fillBots(api, room) {
  const s = room.gameState;
  const bots = botIds(room);
  if (!bots.length) return;
  let c = Math.floor(Math.random() * 10);
  (async () => {
    for (const id of bots) {
      s.subs[id] = [];
      for (let n = 0; n < s.settings.perPlayer; n++) s.subs[id].push(await botTrackFor(c++));
    }
    if (room.gameState === s && s.phase === "submit") broadcast(api, room);
  })();
}
function scheduleBotVotes(api, room) {
  const s = room.gameState;
  s.botTimers = s.botTimers || [];
  botIds(room).forEach((id) => {
    const delay = 1500 + Math.floor(Math.random() * Math.max(1000, ROUND_MS - 5000));
    const to = setTimeout(() => {
      if (room.gameState !== s || s.phase !== "playing") return;
      const opts = s.players.filter((x) => x !== id);
      if (opts.length) { s.votes[id] = opts[Math.floor(Math.random() * opts.length)]; broadcast(api, room); }
    }, delay);
    s.botTimers.push(to);
  });
}

// ---------- broadcasting ----------
function leaderboard(s) {
  return s.players
    .map((id) => ({ id, name: s.names[id], avatar: s.avatars[id], score: s.scores[id] || 0 }))
    .sort((a, b) => b.score - a.score);
}

function broadcast(api, room) {
  const s = room.gameState;
  if (!s) return;
  const base = { phase: s.phase, settings: s.settings };

  if (s.phase === "settings") {
    api.toAll("kkt:state", Object.assign(base, {
      players: s.players.map((id) => ({ id, name: s.names[id], avatar: s.avatars[id] })),
    }));
    return;
  }

  if (s.phase === "submit") {
    // Everyone sees who has (not) finished submitting all their songs.
    api.toAll("kkt:state", Object.assign(base, {
      perPlayer: s.settings.perPlayer,
      players: s.players.map((id) => ({
        id, name: s.names[id], avatar: s.avatars[id],
        connected: api.connected(id),
        done: (s.subs[id] || []).length, // how many songs submitted so far
      })),
    }));
  } else if (s.phase === "playing") {
    const t = s.current.track;
    api.toAll("kkt:state", Object.assign(base, {
      round: s.idx + 1, total: s.queue.length,
      track: { title: t.title, artist: t.artist, cover: t.cover, preview: t.preview }, // owner hidden!
      endsAt: s.endsAt,
      votedCount: Object.keys(s.votes).length,
      players: s.players.map((id) => ({
        id, name: s.names[id], avatar: s.avatars[id],
        connected: api.connected(id), voted: s.votes[id] != null, score: s.scores[id] || 0,
      })),
    }));
  } else if (s.phase === "reveal") {
    api.toAll("kkt:state", Object.assign(base, {
      round: s.idx + 1, total: s.queue.length,
      result: s.result, leaderboard: leaderboard(s), last: s.idx + 1 >= s.queue.length,
    }));
  } else if (s.phase === "ended") {
    api.toAll("kkt:state", Object.assign(base, {
      leaderboard: leaderboard(s),
      tracks: s.trackScores.map((x) => ({
        title: x.track.title, artist: x.track.artist, cover: x.track.cover,
        ownerName: s.names[x.owner] || "?", points: x.points, found: x.found,
      })),
      trackRanking: s.trackScores
        .map((x) => ({ title: x.track.title, artist: x.track.artist, cover: x.track.cover,
          ownerName: s.names[x.owner] || "?", points: x.points }))
        .sort((a, b) => b.points - a.points),
    }));
  }

  // Private per-player info (their own submissions + their current vote).
  s.players.forEach((id) => {
    api.toPlayer(id, "kkt:you", {
      subs: s.subs[id] || [],
      perPlayer: s.settings.perPlayer,
      vote: s.votes[id] || null,
      isOwner: s.phase === "playing" && s.current && s.current.owner === id,
    });
  });
}

// ---------- rounds ----------
function startRound(api, room) {
  const s = room.gameState;
  s.current = s.queue[s.idx];
  s.votes = {};
  s.phase = "playing";
  s.endsAt = Date.now() + ROUND_MS;
  clearTimeout(s.timer);
  s.timer = setTimeout(() => endRound(api, room), ROUND_MS);
  scheduleBotVotes(api, room);
  broadcast(api, room);
}

function endRound(api, room) {
  const s = room.gameState;
  if (!s || s.phase !== "playing") return;
  clearTimeout(s.timer); s.timer = null;
  (s.botTimers || []).forEach(clearTimeout); s.botTimers = [];
  const owner = s.current.owner;
  const N = s.players.length;
  let found = 0; const foundNames = [];
  Object.keys(s.votes).forEach((voter) => {
    if (voter === owner) return;               // the owner's decoy vote never scores
    if (s.votes[voter] === owner) {
      found++; s.scores[voter] = (s.scores[voter] || 0) + 1;
      foundNames.push(s.names[voter]);
    }
  });
  let ownerPts = 0;
  if (s.players.includes(owner)) {
    ownerPts = Math.max(0, (N - 1) - found);
    s.scores[owner] = (s.scores[owner] || 0) + ownerPts;
  }
  s.trackScores.push({ owner, track: s.current.track, points: ownerPts, found });
  s.result = {
    track: s.current.track, ownerId: owner, ownerName: s.names[owner] || "?",
    ownerAvatar: s.avatars[owner], foundNames, ownerPts, found,
  };
  s.phase = "reveal";
  broadcast(api, room);
}

function nextRound(api, room) {
  const s = room.gameState;
  s.idx++;
  if (s.idx < s.queue.length) startRound(api, room);
  else { s.phase = "ended"; broadcast(api, room); }
}

// ---------- module ----------
function assignAvatars(s, players) {
  const cols = shuffle(AV_COLORS), emos = shuffle(AV_EMOJIS);
  s.avatars = {};
  players.forEach((p, i) => (s.avatars[p.id] = { color: cols[i % cols.length], emoji: emos[i % emos.length] }));
}

module.exports = {
  id: "kietkoutsa",
  minPlayers: MIN_PLAYERS,

  start(api, room) {
    const players = api.players();
    const s = {
      phase: "settings",
      settings: { perPlayer: 1, playback: "all" }, // host adjusts
      players: players.map((p) => p.id),
      names: {}, avatars: {}, scores: {},
      subs: {}, queue: [], idx: -1, current: null, votes: {},
      endsAt: 0, timer: null, botTimers: [], trackScores: [], result: null,
    };
    players.forEach((p) => { s.names[p.id] = p.name; s.scores[p.id] = 0; });
    assignAvatars(s, players);
    room.gameState = s;
    broadcast(api, room);
  },

  handle(api, actor, room, type, payload) {
    const s = room.gameState;
    if (!s) return;
    const me = actor.seatId;
    const host = actor.isHost;
    payload = payload || {};

    // ----- settings (host only) -----
    if (s.phase === "settings") {
      if (host && type === "setPerPlayer") {
        s.settings.perPlayer = Math.max(1, Math.min(5, parseInt(payload.n, 10) || 1));
        broadcast(api, room);
      } else if (host && type === "setPlayback") {
        s.settings.playback = payload.mode === "host" ? "host" : "all";
        broadcast(api, room);
      } else if (host && type === "beginSubmit") {
        s.phase = "submit";
        s.players.forEach((id) => (s.subs[id] = []));
        broadcast(api, room);
        fillBots(api, room); // bots auto-submit their songs
      }
      return;
    }

    // ----- submissions -----
    if (s.phase === "submit") {
      if (!host && type === "submitTrack") {
        const t = payload.track;
        if (t && t.preview && (s.subs[me] || []).length < s.settings.perPlayer) {
          s.subs[me] = s.subs[me] || [];
          s.subs[me].push({ id: String(t.id || ""), title: t.title || "?", artist: t.artist || "", cover: t.cover || "", preview: t.preview });
          broadcast(api, room);
        }
      } else if (!host && type === "removeTrack") {
        s.subs[me] = (s.subs[me] || []).filter((x) => x.id !== payload.trackId);
        broadcast(api, room);
      } else if (host && type === "startRounds") {
        // Need every CONNECTED player to have submitted all their songs.
        const ready = s.players.every((id) => !api.connected(id) || (s.subs[id] || []).length >= s.settings.perPlayer);
        const items = [];
        s.players.forEach((id) => (s.subs[id] || []).forEach((tr) => items.push({ owner: id, track: tr })));
        if (ready && items.length >= 1) {
          s.queue = shuffle(items);
          s.idx = 0;
          startRound(api, room);
        }
      }
      return;
    }

    // ----- voting -----
    if (s.phase === "playing") {
      if (type === "vote") {
        const t = payload.target;
        if (s.players.includes(t) && t !== me) { s.votes[me] = t; broadcast(api, room); }
      }
      return;
    }

    // ----- reveal -> next -----
    if (s.phase === "reveal" && host && type === "next") { nextRound(api, room); return; }

    // ----- replay -----
    if (s.phase === "ended" && host && type === "replay") { this.start(api, room); return; }
  },

  onCheat(api, room, cheatId) {
    const s = room.gameState;
    if (!s) return;
    if (cheatId === "reveal-owner" && s.phase === "playing") {
      api.toHost("kkt:cheatReveal", { name: s.names[s.current.owner] });
    } else if (cheatId === "skip-track" && s.phase === "playing") {
      endRound(api, room);
    } else if (cheatId === "add-time" && s.phase === "playing") {
      s.endsAt += 15000;
      clearTimeout(s.timer);
      s.timer = setTimeout(() => endRound(api, room), Math.max(0, s.endsAt - Date.now()));
      broadcast(api, room);
    }
  },

  onReconnect(api, room, who) {
    if (room.gameState) broadcast(api, room);
  },

  onPlayerLeave(api, room, seatId) {
    const s = room.gameState;
    if (!s || !s.players.includes(seatId)) return;
    s.players = s.players.filter((id) => id !== seatId);
    delete s.votes[seatId];
    if (s.players.length < 1) { s.phase = "ended"; }
    broadcast(api, room);
  },
};
