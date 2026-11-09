// final.js -- End of game: badges, "wrapped" recap, playlist, tournament totals.
// Reads the game state, writes s.final. No timers, no sending.
const D = require("./data");

function computeFinal(s, ratingOf) {
  const ids = s.players.filter((id) => s.names[id]);
  const best = (fn, min) => {
    let top = null, val = min == null ? 0 : min;
    ids.forEach((id) => { const x = fn(id); if (x > val) { val = x; top = id; } });
    return top;
  };
  const st = (id) => s.stats[id] || {};
  const djScore = (id) => s.trackScores.filter((x) => x.owner === id).reduce((a, x) => a + ratingOf(s, x.track), 0);
  const badges = [];
  const give = (badge, id) => { if (id) badges.push(Object.assign({ id: badge, playerId: id, name: s.names[id], avatar: s.avatars[id] }, D.BADGES[badge])); };
  give("chameleon", best((id) => s.cam[id] || 0));
  give("profiler", best((id) => st(id).correct || 0));
  give("readable", best((id) => (st(id).ownVoters ? st(id).ownFound / st(id).ownVoters : 0), 0.5));
  give("sheep", best((id) => (st(id).voted >= 3 ? st(id).sheep / st(id).voted : 0), 0.6));
  if (s.settings.speed) give("flash", best((id) => st(id).fast || 0));
  if (s.settings.bets) give("kamikaze", best((id) => st(id).betLoss || 0));
  if (s.settings.blind) give("blindtest", best((id) => st(id).blind || 0));
  give("dj", best(djScore));

  // confusion pairs: "X was taken for Y" (wrong picks), top 3
  const pairs = [];
  Object.keys(s.conf).forEach((o) => Object.keys(s.conf[o]).forEach((g) => {
    if (s.names[o] && s.names[g]) pairs.push({ a: s.names[o], b: s.names[g], n: s.conf[o][g] });
  }));
  pairs.sort((x, y) => y.n - x.n);

  const ts = s.trackScores.map((x) => ({
    title: x.track.title, artist: x.track.artist, cover: x.track.cover, link: x.track.link || "",
    ownerName: s.names[x.owner] || "?", points: x.points, found: x.found, voters: x.voters,
    rating: ratingOf(s, x.track), note: x.track.note || "",
  }));
  const artists = {};
  ts.forEach((t) => { if (t.artist) artists[t.artist] = (artists[t.artist] || 0) + 1; });
  const topArtist = Object.keys(artists).sort((a, b) => artists[b] - artists[a])[0];
  const byPts = ts.slice().sort((a, b) => b.points - a.points);
  const byFound = ts.slice().sort((a, b) => (b.voters ? b.found / b.voters : 0) - (a.voters ? a.found / a.voters : 0));
  const byRating = ts.slice().sort((a, b) => b.rating - a.rating);
  const det = ids.slice().sort((a, b) => (s.det[b] || 0) - (s.det[a] || 0))[0];
  const cam = ids.slice().sort((a, b) => (s.cam[b] || 0) - (s.cam[a] || 0))[0];
  s.final = {
    badges,
    pairs: pairs.slice(0, 3),
    tracks: ts,
    trackRanking: byPts,
    wrapped: {
      tracksPlayed: ts.length,
      mostDeceptive: byPts[0] || null,
      mostObvious: byFound[0] && byFound[0].found ? byFound[0] : null,
      bestRated: byRating[0] && byRating[0].rating > 0 ? byRating[0] : null,
      topArtist: topArtist && artists[topArtist] > 1 ? { name: topArtist, n: artists[topArtist] } : null,
      topDetective: det ? { name: s.names[det], avatar: s.avatars[det], pts: s.det[det] || 0 } : null,
      topChameleon: cam ? { name: s.names[cam], avatar: s.avatars[cam], pts: s.cam[cam] || 0 } : null,
      theme: s.themeText || null,
    },
  };
  // tournament: add this game's scores to the running totals
  if (!s.tournamentAdded) {
    s.tournamentAdded = true;
    s.tournament.games++;
    ids.forEach((id) => { s.tournament.totals[id] = (s.tournament.totals[id] || 0) + (s.scores[id] || 0); });
  }
}

module.exports = { computeFinal };
