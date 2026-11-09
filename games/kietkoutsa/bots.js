// bots.js -- Bots for solo / dev testing (a bot is a seat flagged isBot).
// They pick real songs, vote (mostly following the trend), bet, lock and rate.
// ctx = the few game functions they need, given by server.js.
const D = require("./data");
const { pick, sameTrack } = require("./util");
const { CFG } = require("./config");

module.exports = function makeBots(ctx) {
  const { owners, voters, suspects, duoOn, isBot, allSubs, afterVote, rate, broadcast } = ctx;
async function botTrack(api, s, i) {
  const q = D.BOT_QUERIES[i % D.BOT_QUERIES.length];
  try {
    const list = await api.music.search(q);
    const free = list.filter((t) => !(s.settings.noExplicit && t.explicit) && !allSubs(s).some((x) => sameTrack(x, t)));
    if (free.length) return Object.assign({}, pick(free.slice(0, 6)));
  } catch (e) {}
  return { id: "bot" + i + "_" + Date.now(), title: "Morceau du Bot " + (i + 1), artist: "Bot", cover: "", preview: "", link: "", explicit: false, source: "deezer" };
}
function fillBots(api, room, onlyId) {
  const s = room.gameState;
  const bots = onlyId ? [onlyId] : owners(s).filter((id) => isBot(room, id));
  if (!bots.length) return;
  let c = Math.floor(Math.random() * 10);
  // every bot song is searched AT THE SAME TIME (each with its own genre), then
  // added one by one, skipping any accidental duplicate
  const jobs = [];
  bots.forEach((id) => {
    s.subs[id] = [];
    for (let n = 0; n < s.settings.perPlayer; n++) jobs.push({ id, n, p: botTrack(api, s, c++) });
  });
  Promise.all(jobs.map((j) => j.p)).then((tracks) => {
    if (room.gameState !== s) return;
    jobs.forEach((j, i) => {
      const t = tracks[i];
      if (t.preview && allSubs(s).some((x) => sameTrack(x, t))) return;
      t.note = pick(D.BOT_NOTES);
      if (s.settings.mode === "truebluff") t.nature = j.n === 0 ? "sincere" : "bluff";
      s.subs[j.id].push(t);
      if (api.music && api.music.warm && t.preview) api.music.warm(t.preview);
    });
    if (s.phase === "submit") broadcast(api, room);
  });
}
// Smarter bots: most of the time they follow the current trend (like a real
// player would), they avoid greyed-out suspects, and they sometimes bet/lock.
function botVote(s, id) {
  const r = s.round;
  const v = { p: [], second: null, bet: 1, at: Date.now(), locked: false, nature: null };
  r.parts.forEach((part, i) => {
    const opts = suspects(s, part.owner).filter((x) => x !== id && !(r.eliminated[i] || []).includes(x));
    if (!opts.length) return;
    const counts = {};
    Object.values(r.votes).forEach((o) => { const t = o.p[i]; if (t && opts.includes(t)) counts[t] = (counts[t] || 0) + 1; });
    const top = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
    v.p[i] = top && Math.random() < 0.55 ? top : pick(opts);
  });
  if (duoOn(s)) {
    const rest = suspects(s, r.parts[0].owner).filter((x) => x !== id && x !== v.p[0]);
    if (rest.length) v.second = pick(rest);
  }
  if (s.settings.bets) v.bet = 1 + Math.floor(Math.random() * 3);
  if (s.settings.mode === "truebluff") v.nature = Math.random() < 0.5 ? "sincere" : "bluff";
  v.locked = Math.random() < 0.2;
  return v;
}
function scheduleBotVotes(api, room) {
  const s = room.gameState;
  const roundNo = s.roundNo;
  voters(s).filter((id) => isBot(room, id)).forEach((id) => {
    const span = Math.max(1000, s.roundMs - 5000);
    const delay = CFG.LEAD_MS + CFG.BOT_MIN_MS + Math.floor(Math.random() * span);
    s.botTimers.push(setTimeout(() => {
      if (room.gameState !== s || s.phase !== "playing" || s.roundNo !== roundNo) return;
      s.round.votes[id] = botVote(s, id);
      afterVote(api, room);
    }, delay));
  });
}
function botRatings(room) {
  const s = room.gameState;
  voters(s).filter((id) => isBot(room, id)).forEach((id) => {
    s.round.parts.forEach((part) => {
      if (part.owner !== id && Math.random() < 0.7) rate(s, part.track, id, Math.random() < 0.75 ? 1 : -1);
    });
  });
}


  return { fillBots, scheduleBotVotes, botRatings };
};
