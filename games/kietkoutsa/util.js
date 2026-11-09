// util.js -- Small pure helpers of Kietkoutsa Reborn (no game state here).
function shuffle(a) {
  a = a.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
const pick = (a) => a[Math.floor(Math.random() * a.length)];

// Fuzzy text match for the blind test: ignores case, accents, punctuation,
// "(Remastered)", "feat. X"... and tolerates ~25% typos.
function norm(str) {
  return String(str || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/\(.*?\)|\[.*?\]/g, " ").replace(/\s-\s.*$/, " ")
    .replace(/\b(feat|ft)\b.*$/, " ").replace(/[^a-z0-9]+/g, " ").trim();
}
function lev(a, b) { // Levenshtein distance = number of letter edits between a and b
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}
function fuzzyEq(guess, truth) {
  const g = norm(guess), t = norm(truth);
  if (g.length < 2 || !t) return false;
  if (g === t) return true;
  if (t.includes(g) && g.length >= Math.max(3, t.length * 0.6)) return true;
  return lev(g, t) <= Math.floor(t.length * 0.25);
}
function artistMatch(guess, artist) {
  const parts = String(artist || "").split(/,|&|\bfeat\.?|\bft\.?|\bx\b/i).map((x) => x.trim()).filter(Boolean);
  return fuzzyEq(guess, artist) || parts.some((p) => fuzzyEq(guess, p));
}
const trackKey = (t) => (t.id || "") + "|" + norm(t.title) + "|" + norm(t.artist);
const sameTrack = (a, b) => (a.id && a.id === b.id) || (norm(a.title) === norm(b.title) && norm(a.artist) === norm(b.artist));

module.exports = { shuffle, pick, norm, lev, fuzzyEq, artistMatch, trackKey, sameTrack };
