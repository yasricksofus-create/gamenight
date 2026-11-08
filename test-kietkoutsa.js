// test-kietkoutsa.js -- Automated tests of the Kietkoutsa Reborn RULES (no browser).
// Run:  node test-kietkoutsa.js
// It drives the game module with a fake "api" (fake players, fake music service)
// and checks scores, modes, leaving players, late joins, etc.

const assert = require("assert");
const music = require("./engine/music");
const K = require("./games/kietkoutsa/server.js");

// Shorten every delay so the tests run fast.
Object.assign(K._cfg, { LEAD_MS: 0, EARLY_END_MS: 30, HINT_BEFORE_MS: 0, TREND_BEFORE_MS: 0, REVEAL_BASE_MS: 40, REVEAL_PER_VOTE_MS: 0, BOT_MIN_MS: 5 });

let trackN = 0;
const mkTrack = (title, artist) => ({
  id: "dz:" + (++trackN), title: title || "Song " + trackN, artist: artist || "Artist " + trackN,
  cover: "https://e-cdns-images.dzcdn.net/c.jpg", preview: "https://cdnt-preview.dzcdn.net/p" + trackN + ".mp3",
  link: "https://www.deezer.com/track/" + trackN, explicit: false, source: "deezer",
});

function setup(names, opts) {
  opts = opts || {};
  const room = { code: "TEST", players: names.map((n, i) => ({ seatId: "p" + i, name: n, connected: true, isBot: !!(opts.bots && opts.bots.includes(n)) })), gameState: null };
  const log = { host: [], player: {}, all: [] };
  const api = {
    players: () => room.players.map((p) => ({ id: p.seatId, name: p.name })),
    connected: (id) => { const p = room.players.find((x) => x.seatId === id); return !!(p && p.connected); },
    toHost: (e, d) => log.host.push([e, d]),
    toPlayer: (id, e, d) => (log.player[id] = log.player[id] || []).push([e, d]),
    toAll: (e, d) => log.all.push([e, d]),
    music: {
      search: async () => [mkTrack(), mkTrack(), mkTrack()],
      refresh: async () => null,
      sanitizeTrack: music.sanitizeTrack,
    },
    now: () => Date.now(),
  };
  K.start(api, room);
  const H = { isHost: true, seatId: null };
  const P = (i) => ({ isHost: false, seatId: "p" + i });
  const act = (actor, type, payload) => K.handle(api, actor, room, type, payload);
  const last = (e) => { for (let i = log.all.length - 1; i >= 0; i--) if (log.all[i][0] === e) return log.all[i][1]; };
  const lastFor = (id, e) => { const l = log.player[id] || []; for (let i = l.length - 1; i >= 0; i--) if (l[i][0] === e) return l[i][1]; };
  return { room, api, log, H, P, act, last, lastFor, s: () => room.gameState };
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log("  ✓ " + name); }
  catch (e) { console.log("  ✗ " + name + "\n    " + (e && e.stack || e)); process.exitCode = 1; }
}
function submitAll(t, n) { for (let i = 0; i < n; i++) t.act(t.P(i), "submitTrack", { track: mkTrack() }); }
function ownerOfRound(t, part) { return t.s().round.parts[part || 0].owner; }

(async () => {
  console.log("Kietkoutsa Reborn — tests des regles");

  await test("host does not play by default with 3+ phones; plays with fewer", async () => {
    const a = setup(["A", "B", "C"]);
    assert.strictEqual(a.s().settings.hostPlays, false);
    assert.ok(!a.s().players.includes("__host__"));
    const b = setup(["A", "B"]);
    assert.strictEqual(b.s().settings.hostPlays, true);
    assert.ok(b.s().players.includes("__host__"));
  });

  await test("needs 3 participants to begin", async () => {
    const t = setup(["A", "B"]);
    t.act(t.H, "setSetting", { key: "hostPlays", value: false });
    t.act(t.H, "beginSubmit");
    assert.strictEqual(t.s().phase, "settings");
    t.act(t.H, "setSetting", { key: "hostPlays", value: true });
    t.act(t.H, "beginSubmit");
    assert.strictEqual(t.s().phase, "submit");
  });

  await test("settings are validated (bad values ignored)", async () => {
    const t = setup(["A", "B", "C"]);
    t.act(t.H, "setSetting", { key: "roundSec", value: 999 });
    assert.strictEqual(t.s().settings.roundSec, 30);
    t.act(t.H, "setSetting", { key: "roundSec", value: 15 });
    assert.strictEqual(t.s().settings.roundSec, 15);
    t.act(t.H, "setSetting", { key: "nope", value: 1 });
    t.act(t.P(0), "setSetting", { key: "roundSec", value: 20 }); // a player cannot
    assert.strictEqual(t.s().settings.roundSec, 15);
  });

  await test("phone mode vote + apply", async () => {
    const t = setup(["A", "B", "C"]);
    t.act(t.P(0), "voteMode", { mode: "usurp" });
    t.act(t.P(1), "voteMode", { mode: "usurp" });
    t.act(t.P(2), "voteMode", { mode: "mashup" });
    t.act(t.H, "applyModeVote");
    assert.strictEqual(t.s().settings.mode, "usurp");
  });

  await test("anti-duplicate + bad preview host refused + explicit filter", async () => {
    const t = setup(["A", "B", "C"]);
    t.act(t.H, "setSetting", { key: "noExplicit", value: true });
    t.act(t.H, "beginSubmit");
    const tr = mkTrack("Same", "Artist");
    t.act(t.P(0), "submitTrack", { track: tr });
    t.act(t.P(1), "submitTrack", { track: Object.assign({}, tr, { id: "dz:other" }) }); // same title+artist
    assert.strictEqual(t.s().subs.p1.length, 0);
    t.act(t.P(1), "submitTrack", { track: Object.assign(mkTrack(), { preview: "https://evil.com/x.mp3" }) });
    assert.strictEqual(t.s().subs.p1.length, 0);
    t.act(t.P(1), "submitTrack", { track: Object.assign(mkTrack(), { explicit: true }) });
    assert.strictEqual(t.s().subs.p1.length, 0);
    assert.ok((t.log.player.p1 || []).some(([e]) => e === "kkt:toast"));
  });

  await test("owner scores only from voters who picked WRONG (AFK give nothing)", async () => {
    const t = setup(["A", "B", "C", "D"]);
    ["speed", "hints", "earlyEnd", "finalDouble"].forEach((k) => t.act(t.H, "setSetting", { key: k, value: false }));
    t.act(t.H, "beginSubmit"); submitAll(t, 4);
    t.act(t.H, "startRounds");
    assert.strictEqual(t.s().phase, "playing");
    const o = ownerOfRound(t);
    const others = ["p0", "p1", "p2", "p3"].filter((x) => x !== o);
    // one finds, one is wrong, one does not vote at all
    t.act({ seatId: others[0] }, "vote", { target: o });
    t.act({ seatId: others[1] }, "vote", { target: others[0] });
    K.onCheat(t.api, t.room, "skip-track");
    assert.strictEqual(t.s().phase, "reveal");
    assert.strictEqual(t.s().scores[others[0]], 1);
    assert.strictEqual(t.s().scores[o], 1, "1 wrong voter -> 1 point (the AFK gives 0)");
    assert.strictEqual(t.s().scores[others[2]], 0);
  });

  await test("speed bonus + lock bonus + final round x2", async () => {
    const t = setup(["A", "B", "C"]);
    t.act(t.H, "setSetting", { key: "hints", value: false });
    t.act(t.H, "setSetting", { key: "earlyEnd", value: false });
    t.act(t.H, "beginSubmit"); submitAll(t, 3);
    t.act(t.H, "startRounds");
    assert.strictEqual(t.s().queue.length, 3);
    // go to the last round
    K.onCheat(t.api, t.room, "skip-track"); t.act(t.H, "next");
    K.onCheat(t.api, t.room, "skip-track"); t.act(t.H, "next");
    const o = ownerOfRound(t);
    const v = ["p0", "p1", "p2"].find((x) => x !== o);
    const before = t.s().scores[v];
    t.act({ seatId: v }, "vote", { target: o });
    t.act({ seatId: v }, "lock");
    K.onCheat(t.api, t.room, "skip-track");
    // 1 right + 1 speed + 1 lock = 3, x2 final = 6
    assert.strictEqual(t.s().scores[v] - before, 6);
    t.act(t.H, "next");
    assert.strictEqual(t.s().phase, "ended");
    assert.ok(t.s().final.tracks.length === 3);
  });

  await test("bets: right x bet, wrong loses bet-1, score never below 0", async () => {
    const t = setup(["A", "B", "C"]);
    ["speed", "hints", "earlyEnd", "finalDouble"].forEach((k) => t.act(t.H, "setSetting", { key: k, value: false }));
    t.act(t.H, "setSetting", { key: "bets", value: true });
    t.act(t.H, "beginSubmit"); submitAll(t, 3);
    t.act(t.H, "startRounds");
    const o = ownerOfRound(t);
    const [v1, v2] = ["p0", "p1", "p2"].filter((x) => x !== o);
    t.act({ seatId: v1 }, "vote", { target: o }); t.act({ seatId: v1 }, "setBet", { bet: 3 });
    t.act({ seatId: v2 }, "vote", { target: v1 }); t.act({ seatId: v2 }, "setBet", { bet: 3 });
    K.onCheat(t.api, t.room, "skip-track");
    assert.strictEqual(t.s().scores[v1], 3);
    assert.strictEqual(t.s().scores[v2], 0); // -2 clamped at 0
    assert.strictEqual(t.s().result.gains[v2], -2);
  });

  await test("2-suspect vote (duo on): 1st right = 2, 2nd right = 1", async () => {
    const t = setup(["A", "B", "C", "D"]);
    ["speed", "hints", "earlyEnd", "finalDouble"].forEach((k) => t.act(t.H, "setSetting", { key: k, value: false }));
    t.act(t.H, "setSetting", { key: "duo", value: "on" });
    t.act(t.H, "beginSubmit"); submitAll(t, 4);
    t.act(t.H, "startRounds");
    const o = ownerOfRound(t);
    const [a, b] = ["p0", "p1", "p2", "p3"].filter((x) => x !== o);
    t.act({ seatId: a }, "vote", { target: o });
    t.act({ seatId: b }, "vote", { target: a });
    t.act({ seatId: b }, "vote", { target: o, slot: "second" });
    K.onCheat(t.api, t.room, "skip-track");
    assert.strictEqual(t.s().scores[a], 2);
    assert.strictEqual(t.s().scores[b], 1);
  });

  await test("combo: 3 right rounds in a row = +2", async () => {
    const t = setup(["A", "B", "C", "D", "E"]);
    ["speed", "hints", "earlyEnd", "finalDouble"].forEach((k) => t.act(t.H, "setSetting", { key: k, value: false }));
    t.act(t.H, "beginSubmit"); submitAll(t, 5);
    t.act(t.H, "startRounds");
    // pick a detective who will not own any of the first 3 rounds
    const firstOwners = t.s().queue.slice(0, 3).map((q) => q.parts[0].owner);
    const det = ["p0", "p1", "p2", "p3", "p4"].find((x) => !firstOwners.includes(x));
    for (let i = 0; i < 3; i++) {
      t.act({ seatId: det }, "vote", { target: ownerOfRound(t) });
      K.onCheat(t.api, t.room, "skip-track");
      if (i < 2) t.act(t.H, "next");
    }
    assert.strictEqual(t.s().scores[det], 5); // 3 right + 2 combo
    assert.ok(t.s().result.combos.length === 1);
  });

  await test("joker double x2 and spy reveals a vote privately", async () => {
    const t = setup(["A", "B", "C"]);
    ["speed", "hints", "earlyEnd", "finalDouble"].forEach((k) => t.act(t.H, "setSetting", { key: k, value: false }));
    t.act(t.H, "beginSubmit"); submitAll(t, 3);
    t.act(t.H, "startRounds");
    const o = ownerOfRound(t);
    const [a, b] = ["p0", "p1", "p2"].filter((x) => x !== o);
    t.act({ seatId: b }, "vote", { target: a });
    t.act({ seatId: a }, "joker", { kind: "spy", target: b });
    const spy = t.lastFor(a, "kkt:spy");
    assert.ok(spy && spy.vote === t.s().names[a]);
    t.act({ seatId: a }, "joker", { kind: "double" });
    t.act({ seatId: a }, "vote", { target: o });
    K.onCheat(t.api, t.room, "skip-track");
    assert.strictEqual(t.s().scores[a], 2);
    // each joker only once
    t.act(t.H, "next");
    t.act({ seatId: a }, "joker", { kind: "double" });
    assert.ok(!t.s().round.doubles[a]);
  });

  await test("hint never greys the real owner; trend counts votes", async () => {
    const t = setup(["A", "B", "C", "D", "E"]);
    t.act(t.H, "setSetting", { key: "roundSec", value: 15 });
    t.act(t.H, "setSetting", { key: "earlyEnd", value: false });
    K._cfg.HINT_BEFORE_MS = 14900; K._cfg.TREND_BEFORE_MS = 14900; // fire right away
    t.act(t.H, "beginSubmit"); submitAll(t, 5);
    t.act(t.H, "startRounds");
    const o = ownerOfRound(t);
    const v = ["p0", "p1", "p2", "p3", "p4"].find((x) => x !== o);
    t.act({ seatId: v }, "vote", { target: o });
    await wait(150);
    const el = t.s().round.eliminated[0];
    assert.strictEqual(el.length, 1);
    assert.ok(!el.includes(o));
    assert.ok(t.s().round.trend);
    K._cfg.HINT_BEFORE_MS = 0; K._cfg.TREND_BEFORE_MS = 0;
    K.onCheat(t.api, t.room, "skip-track");
  });

  await test("early end when everyone voted; owners stay hidden in public state", async () => {
    const t = setup(["A", "B", "C"]);
    t.act(t.H, "beginSubmit"); submitAll(t, 3);
    t.act(t.H, "startRounds");
    const st = t.last("kkt:state");
    assert.ok(!JSON.stringify(st).includes("owner\":\"p"), "no owner id in the public playing state");
    ["p0", "p1", "p2"].forEach((id) => {
      const target = ["p0", "p1", "p2"].find((x) => x !== id);
      t.act({ seatId: id }, "vote", { target });
    });
    assert.ok(t.s().endsAt - Date.now() <= 40);
    await wait(80);
    assert.strictEqual(t.s().phase, "reveal");
  });

  await test("usurp: everyone gets someone else; votes on the target score", async () => {
    const t = setup(["A", "B", "C", "D"]);
    ["speed", "hints", "earlyEnd", "finalDouble"].forEach((k) => t.act(t.H, "setSetting", { key: k, value: false }));
    t.act(t.H, "setSetting", { key: "mode", value: "usurp" });
    t.act(t.H, "beginSubmit");
    const tg = t.s().targets;
    ["p0", "p1", "p2", "p3"].forEach((id) => assert.ok(tg[id] && tg[id] !== id));
    submitAll(t, 4);
    t.act(t.H, "startRounds");
    const o = ownerOfRound(t);
    const target = tg[o];
    const vs = ["p0", "p1", "p2", "p3"].filter((x) => x !== o && x !== target);
    t.act({ seatId: vs[0] }, "vote", { target });
    K.onCheat(t.api, t.room, "skip-track");
    assert.strictEqual(t.s().scores[o], 2); // 1 wrong + 1 on target
    assert.strictEqual(t.s().result.parts[0].targetName, t.s().names[target]);
  });

  await test("Vrai ou Bluff: 2 songs, one of each nature, nature guess scores", async () => {
    const t = setup(["A", "B", "C"]);
    ["speed", "hints", "earlyEnd", "finalDouble"].forEach((k) => t.act(t.H, "setSetting", { key: k, value: false }));
    t.act(t.H, "setSetting", { key: "mode", value: "truebluff" });
    assert.strictEqual(t.s().settings.perPlayer, 2);
    t.act(t.H, "beginSubmit");
    for (let i = 0; i < 3; i++) { t.act(t.P(i), "submitTrack", { track: mkTrack() }); t.act(t.P(i), "submitTrack", { track: mkTrack() }); }
    const n = t.s().subs.p0.map((x) => x.nature).sort();
    assert.deepStrictEqual(n, ["bluff", "sincere"]);
    t.act(t.P(0), "setNature", { trackId: t.s().subs.p0[1].id, nature: "sincere" });
    assert.deepStrictEqual(t.s().subs.p0.map((x) => x.nature), ["bluff", "sincere"]);
    t.act(t.H, "startRounds");
    const o = ownerOfRound(t);
    const nat = t.s().round.parts[0].track.nature;
    const v = ["p0", "p1", "p2"].find((x) => x !== o);
    t.act({ seatId: v }, "setNature", { nature: nat });
    K.onCheat(t.api, t.room, "skip-track");
    assert.strictEqual(t.s().scores[v], 1);
  });

  await test("Mashup: rounds pair two different owners, both parts score", async () => {
    const t = setup(["A", "B", "C", "D"]);
    ["speed", "hints", "earlyEnd", "finalDouble"].forEach((k) => t.act(t.H, "setSetting", { key: k, value: false }));
    t.act(t.H, "setSetting", { key: "mode", value: "mashup" });
    t.act(t.H, "beginSubmit"); submitAll(t, 4);
    t.act(t.H, "startRounds");
    assert.strictEqual(t.s().queue.length, 2);
    t.s().queue.forEach((q) => assert.ok(q.parts.length === 2 && q.parts[0].owner !== q.parts[1].owner));
    const [o0, o1] = [ownerOfRound(t, 0), ownerOfRound(t, 1)];
    const v = ["p0", "p1", "p2", "p3"].find((x) => x !== o0 && x !== o1);
    t.act({ seatId: v }, "vote", { target: o0, part: 0 });
    t.act({ seatId: v }, "vote", { target: o1, part: 1 });
    K.onCheat(t.api, t.room, "skip-track");
    assert.strictEqual(t.s().scores[v], 2);
  });

  await test("blind test: fuzzy title / artist guesses", async () => {
    const f = K._fuzzy;
    assert.ok(f.fuzzyEq("bohemian rapsody", "Bohemian Rhapsody (Remastered 2011)"));
    assert.ok(f.fuzzyEq("deja vu", "Déjà Vu"));
    assert.ok(!f.fuzzyEq("hello", "Bohemian Rhapsody"));
    assert.ok(f.artistMatch("daft punk", "Daft Punk, Pharrell Williams"));
    const t = setup(["A", "B", "C"]);
    ["speed", "hints", "earlyEnd", "finalDouble"].forEach((k) => t.act(t.H, "setSetting", { key: k, value: false }));
    t.act(t.H, "setSetting", { key: "blind", value: true });
    t.act(t.H, "beginSubmit");
    for (let i = 0; i < 3; i++) t.act(t.P(i), "submitTrack", { track: mkTrack("Titre Numero " + i, "Chanteur " + i) });
    t.act(t.H, "startRounds");
    const st = t.last("kkt:state");
    assert.strictEqual(st.parts[0].title, "???");
    const tr = t.s().round.parts[0].track;
    const v = ["p0", "p1", "p2"].find((x) => x !== ownerOfRound(t));
    t.act({ seatId: v }, "guess", { title: tr.title.toLowerCase(), artist: "nope" });
    assert.deepStrictEqual(t.s().round.guesses[v], { title: true, artist: false });
    K.onCheat(t.api, t.room, "skip-track");
    assert.strictEqual(t.s().scores[v], 1);
  });

  await test("player leaving: future songs removed; current owner stays a ghost suspect", async () => {
    const t = setup(["A", "B", "C", "D"]);
    t.act(t.H, "setSetting", { key: "perPlayer", value: 2 });
    t.act(t.H, "beginSubmit");
    for (let i = 0; i < 4; i++) { t.act(t.P(i), "submitTrack", { track: mkTrack() }); t.act(t.P(i), "submitTrack", { track: mkTrack() }); }
    t.act(t.H, "startRounds");
    const o = ownerOfRound(t);
    t.room.players = t.room.players.filter((p) => p.seatId !== o);
    K.onPlayerLeave(t.api, t.room, o);
    const rest = t.s().queue.slice(t.s().idx + 1);
    assert.ok(rest.every((q) => q.parts.every((p) => p.owner !== o)));
    assert.strictEqual(t.s().queue.length, 7);
    const st = t.last("kkt:state");
    assert.ok(st.suspects[0].includes(o), "the leaver is still votable for their current song");
    const v = ["p0", "p1", "p2", "p3"].find((x) => x !== o);
    t.act({ seatId: v }, "vote", { target: o });
    assert.strictEqual(t.s().round.votes[v].p[0], o);
  });

  await test("late join: allowed, becomes a detective (no songs) during rounds", async () => {
    const t = setup(["A", "B", "C"]);
    t.act(t.H, "beginSubmit"); submitAll(t, 3);
    t.act(t.H, "startRounds");
    assert.ok(K.allowLateJoin(t.room));
    t.room.players.push({ seatId: "p9", name: "Late", connected: true });
    K.onPlayerJoin(t.api, t.room, "p9");
    assert.ok(t.s().late.p9);
    assert.ok(!t.last("kkt:state").suspects[0].includes("p9"), "a late player cannot be a suspect");
    t.act({ seatId: "p9" }, "vote", { target: ownerOfRound(t) });
    assert.ok(t.s().round.votes.p9);
    t.act({ seatId: "p9" }, "submitTrack", { track: mkTrack() }); // ignored (not submit phase anyway)
  });

  await test("submit timer auto-starts with what was submitted", async () => {
    const t = setup(["A", "B", "C"]);
    t.act(t.H, "setSetting", { key: "submitSec", value: 60 });
    t.act(t.H, "beginSubmit");
    t.act(t.P(0), "submitTrack", { track: mkTrack() });
    t.act(t.P(1), "submitTrack", { track: mkTrack() });
    // simulate the timer firing early
    clearTimeout(t.s().timers.submit);
    t.act(t.H, "startRounds");
    assert.strictEqual(t.s().phase, "submit", "not everyone ready -> refused");
    t.act(t.H, "startRounds", { force: true });
    assert.strictEqual(t.s().phase, "playing");
    assert.strictEqual(t.s().queue.length, 2);
  });

  await test("auto-next after the reveal + ratings + wrapped/badges at the end", async () => {
    const t = setup(["A", "B", "C"]);
    t.act(t.H, "setSetting", { key: "autoNext", value: true });
    t.act(t.H, "beginSubmit"); submitAll(t, 3);
    t.act(t.H, "startRounds");
    for (let i = 0; i < 3; i++) {
      const o = ownerOfRound(t);
      const vs = ["p0", "p1", "p2"].filter((x) => x !== o);
      t.act({ seatId: vs[0] }, "vote", { target: o });
      K.onCheat(t.api, t.room, "skip-track");
      t.act({ seatId: vs[0] }, "rate", { v: 1 });
      t.act({ seatId: o }, "rate", { v: 1 }); // own song: ignored
      await wait(90);
    }
    assert.strictEqual(t.s().phase, "ended");
    const f = t.s().final;
    assert.ok(f.badges.length >= 1);
    assert.ok(f.wrapped.bestRated && f.wrapped.bestRated.rating === 1);
    assert.ok(f.tracks.every((x) => x.link));
  });

  await test("tournament replay keeps totals and settings", async () => {
    const t = setup(["A", "B", "C"]);
    t.act(t.H, "setSetting", { key: "roundSec", value: 20 });
    t.act(t.H, "beginSubmit"); submitAll(t, 3);
    t.act(t.H, "startRounds");
    const o = ownerOfRound(t);
    t.act({ seatId: ["p0", "p1", "p2"].find((x) => x !== o) }, "vote", { target: o });
    K.onCheat(t.api, t.room, "skip-track");
    for (let i = 0; i < 2; i++) { t.act(t.H, "next"); K.onCheat(t.api, t.room, "skip-track"); }
    t.act(t.H, "next");
    assert.strictEqual(t.s().phase, "ended");
    const totals = Object.assign({}, t.s().tournament.totals);
    t.act(t.H, "replay", { keep: true });
    assert.strictEqual(t.s().phase, "settings");
    assert.strictEqual(t.s().settings.roundSec, 20);
    assert.strictEqual(t.s().tournament.games, 1);
    assert.deepStrictEqual(t.s().tournament.totals, totals);
    t.act(t.H, "replay", { keep: false }); // not in ended -> ignored
    assert.strictEqual(t.s().tournament.games, 1);
  });

  await test("bots submit, vote on their own and the game finishes", async () => {
    const t = setup(["Moi", "Bot 1", "Bot 2"], { bots: ["Bot 1", "Bot 2"] });
    t.act(t.H, "setSetting", { key: "roundSec", value: 15 });
    t.act(t.H, "beginSubmit");
    t.act(t.P(0), "submitTrack", { track: mkTrack() });
    await wait(50);
    assert.strictEqual(t.s().subs.p1.length, 1);
    t.act(t.H, "startRounds");
    assert.strictEqual(t.s().phase, "playing");
    K._cfg.BOT_MIN_MS = 1;
    t.act({ seatId: "p0" }, "vote", { target: t.s().round.parts[0].owner === "p1" ? "p2" : "p1" });
    // bots are scheduled within [LEAD+BOT_MIN, +roundMs-5000]: just check no crash + skip
    K.onCheat(t.api, t.room, "skip-track");
    assert.strictEqual(t.s().phase, "reveal");
  });

  await test("host name + avatar choice", async () => {
    const t = setup(["A", "B"]);
    t.act(t.H, "setHostName", { name: "Diddy" });
    assert.strictEqual(t.s().names.__host__, "Diddy");
    t.act(t.P(0), "setAvatar", { emoji: "👽", color: "#F04646" });
    assert.deepStrictEqual(t.s().avatars.p0, { emoji: "👽", color: "#F04646" });
    t.act(t.P(0), "setAvatar", { emoji: "<script>", color: "red" }); // refused values
    assert.deepStrictEqual(t.s().avatars.p0, { emoji: "👽", color: "#F04646" });
  });

  console.log(`\n${passed} test(s) OK` + (process.exitCode ? " — DES ECHECS" : ""));
  setTimeout(() => process.exit(process.exitCode || 0), 50);
})();
