// config.js -- Every tunable value of Kietkoutsa Reborn in ONE place:
// durations (server side) and the settings the host can change.
// The client-side animation timings are in client/common.js (KKT_TIMING) and the
// reveal length is computed here and sent to everyone (revealAnimMs).
const D = require("./data");

// Timings. Grouped in one object so the automated tests can shorten them.
const CFG = {
  LEAD_MS: 1800,          // delay before a song starts (lets every device load it)
  EARLY_END_MS: 5000,     // everyone voted -> the round ends this long after
  HINT_BEFORE_MS: 10000,  // a fake suspect is greyed out this long before the end
  TREND_BEFORE_MS: 8000,  // the anonymous vote split appears this long before the end
  REVEAL_BASE_MS: 9000,   // auto-next: reveal duration (+ per vote, for the animation)
  REVEAL_PER_VOTE_MS: 600,
  BOT_MIN_MS: 1500,       // bots vote between these two delays after the start
};

// Settings the host (or the phone vote) can change, with their allowed values.
// Every incoming value is checked against this table (never trust the browser).
const SETTINGS = {
  perPlayer:   { def: 1, type: "int", min: 1, max: 5 },
  playback:    { def: "all", values: ["all", "host"] },
  hostPlays:   { def: false, type: "bool" },
  mode:        { def: "classic", values: Object.keys(D.MODES) },
  blind:       { def: false, type: "bool" },
  theme:       { def: false, type: "bool" },
  roundSec:    { def: 30, values: [15, 20, 30] },
  submitSec:   { def: 0, values: [0, 60, 90, 120, 180] }, // 0 = no limit
  bets:        { def: false, type: "bool" },
  jokers:      { def: true, type: "bool" },
  hints:       { def: true, type: "bool" },
  speed:       { def: true, type: "bool" },
  earlyEnd:    { def: true, type: "bool" },
  autoNext:    { def: false, type: "bool" },
  noExplicit:  { def: false, type: "bool" },
  finalDouble: { def: true, type: "bool" },
  duo:         { def: "auto", values: ["auto", "on", "off"] },
};
const JOKERS = ["double", "spy", "scramble"];

// Reveal animation on the host screen (phones wait the same time before showing
// the answer, so they never spoil it). Sent with each result.
CFG.REVEAL_START_MS = 300;   // first vote arrow
CFG.REVEAL_STEP_MS = 450;    // one more arrow every...
CFG.DRUM_MS = 1600;          // drum roll before the owner appears
function revealAnimMs(votes) { return CFG.REVEAL_START_MS + votes * CFG.REVEAL_STEP_MS + 200 + CFG.DRUM_MS; }

function defaultSettings() {
  const o = {};
  Object.keys(SETTINGS).forEach((k) => (o[k] = SETTINGS[k].def));
  return o;
}
// Returns the cleaned value, or undefined if it is not allowed.
function cleanSetting(key, value) {
  const d = SETTINGS[key];
  if (!d) return undefined;
  if (d.type === "bool") return !!value;
  if (d.type === "int") {
    const n = parseInt(value, 10);
    return isNaN(n) ? undefined : Math.max(d.min, Math.min(d.max, n));
  }
  const v = d.values.find((x) => String(x) === String(value));
  return v === undefined ? undefined : v;
}

module.exports = { CFG, SETTINGS, JOKERS, defaultSettings, cleanSetting, revealAnimMs };
