// test-games.js -- Automated tests for the bots of Cascade and Undercover, and
// Undercover's tie revote. Run:  node test-games.js
const assert = require("assert");
const cascade = require("./games/cascade/server.js");
const undercover = require("./games/undercover/server.js");

function setup(mod, names, bots) {
  const room = { code: "TEST", players: names.map((n, i) => ({ seatId: "p" + i, name: n, connected: true, isBot: bots.includes(n) })), gameState: null };
  const log = [];
  const api = {
    players: () => room.players.map((p) => ({ id: p.seatId, name: p.name })),
    connected: () => true,
    toHost: (e, d) => log.push(["host", e, d]), toPlayer: (id, e, d) => log.push([id, e, d]), toAll: (e, d) => log.push(["all", e, d]),
  };
  mod.start(api, room);
  return { room, api, log, s: () => room.gameState, act: (id, type, payload) => mod.handle(api, { isHost: id === "host", seatId: id === "host" ? null : id }, room, type, payload) };
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let ok = 0;
async function test(name, fn) {
  try { await fn(); ok++; console.log("  ✓ " + name); }
  catch (e) { console.log("  ✗ " + name + "\n    " + (e && e.stack || e)); process.exitCode = 1; }
}

(async () => {
  console.log("Cascade + Undercover — tests");

  await test("Cascade: 3 bots play on their own, cards are never lost", async () => {
    const t = setup(cascade, ["Bot 1", "Bot 2", "Bot 3"], ["Bot 1", "Bot 2", "Bot 3"]);
    t.act("host", "finalizeSettings");
    assert.strictEqual(t.s().phase, "playing");
    const total = () => t.s().players.reduce((a, id) => a + t.s().hands[id].length, 0) + t.s().drawPile.length + t.s().discard.length;
    const before = total();
    const discardBefore = t.s().discard.length;
    await wait(6000);
    assert.ok(t.s().discard.length > discardBefore || t.s().phase === "ended", "bots played cards");
    // "print" copies a card: the total can only grow, never shrink
    assert.ok(total() >= before, "no card disappeared");
    clearTimeout(t.s()._botSeq);
    t.s().phase = "ended"; // stop the bots
  });

  await test("Cascade: a human turn is NOT played by the bots", async () => {
    const t = setup(cascade, ["Moi", "Bot 1"], ["Bot 1"]);
    t.act("host", "finalizeSettings");
    t.s().turn = 0; t.s().awaiting = null; t.s().pendingDraw = 0;
    const before = JSON.stringify(t.s().hands.p0);
    await wait(1800);
    assert.strictEqual(t.s().players[t.s().turn], "p0");
    assert.strictEqual(JSON.stringify(t.s().hands.p0), before);
    t.s().phase = "ended";
  });

  await test("Undercover: bots vote; a tie gives ONE revote between the tied players", async () => {
    const t = setup(undercover, ["A", "B", "C", "D"], []);
    t.act("host", "finalizeSettings");
    t.act("host", "beginClues");
    t.act("host", "toVote");
    const s = t.s();
    // force a 2-2 tie: A,B -> C ; C,D -> A
    t.act("p0", "vote", { targetId: "p2" }); t.act("p1", "vote", { targetId: "p2" });
    t.act("p2", "vote", { targetId: "p0" }); t.act("p3", "vote", { targetId: "p0" });
    assert.strictEqual(s.phase, "vote", "still voting (revote)");
    assert.deepStrictEqual(s.tieCandidates.slice().sort(), ["p0", "p2"]);
    t.act("p1", "vote", { targetId: "p3" }); // not a tied player -> refused
    assert.ok(!s.votes.p1);
    // second tie -> nobody out
    t.act("p0", "vote", { targetId: "p2" }); t.act("p1", "vote", { targetId: "p2" });
    t.act("p2", "vote", { targetId: "p0" }); t.act("p3", "vote", { targetId: "p0" });
    assert.ok(s.phase === "reveal" || s.phase === "mrwhite");
    assert.strictEqual(s.lastEliminated, null);
    const st = t.log.filter((x) => x[1] === "uc:state").pop()[2];
    assert.ok("voteSeq" in st);
  });

  await test("Undercover: bots vote by themselves", async () => {
    const t = setup(undercover, ["Moi", "Bot 1", "Bot 2", "Bot 3"], ["Bot 1", "Bot 2", "Bot 3"]);
    t.act("host", "finalizeSettings");
    t.act("host", "beginClues");
    t.act("host", "toVote");
    await wait(4000);
    const s = t.s();
    const botVotes = ["p1", "p2", "p3"].filter((id) => !s.alive[id] || s.votes[id] || s.phase !== "vote");
    assert.strictEqual(botVotes.length, 3, "the 3 bots voted");
    if (s.phase === "vote") { t.act("p0", "vote", { targetId: "p1" }); }
    assert.ok(["reveal", "mrwhite", "vote"].includes(s.phase));
  });

  await test("Undercover: every pair is valid (names known, no duplicates, a reason given)", async () => {
    const d = require("./games/undercover/data.js");
    const seen = new Set();
    const check = (list, where) => list.forEach(([a, b, why]) => {
      assert.ok(d.CHARS[a] && d.CHARS[b], where + ": unknown character " + a + " / " + b);
      assert.notStrictEqual(a, b, where + ": same character twice");
      assert.ok(why, where + ": no reason for " + a + " / " + b);
      const k = where + [a, b].sort().join("/");
      assert.ok(!seen.has(k), where + ": duplicate " + k); seen.add(k);
    });
    check(d.CONFONDU, "mélangés"); check(d.SAISON, "récents");
    Object.keys(d.UNIVERS).forEach((u) => { assert.ok(d.UNIVERS[u].length >= 3, u + " needs 3 pairs"); check(d.UNIVERS[u], u); });
    d.WORDS.forEach(([a, b]) => { assert.notStrictEqual(a, b); const k = "w" + [a, b].sort().join("/"); assert.ok(!seen.has(k), "duplicate words " + k); seen.add(k); });
  });

  await test("Undercover: no pair comes back in the same evening; each mode deals", async () => {
    const t = setup(undercover, ["A", "B", "C", "D"], []);
    t.act("host", "finalizeSettings");
    const keys = new Set();
    for (let i = 0; i < 60; i++) { undercover.onCheat(t.api, t.room, "redeal"); keys.add(t.s().pair.key); }
    assert.strictEqual(keys.size, 60, "60 deals = 60 different pairs");
    ["anime_confondu", "anime_saison", "univers"].forEach((m) => {
      t.s().settings.mode = m;
      undercover.onCheat(t.api, t.room, "redeal");
      const p = t.s().pair;
      assert.strictEqual(p.kind, "character");
      assert.ok(p.civil.name && p.civil.desc && p.undercover.desc && p.why);
      if (m === "univers") assert.ok(p.universe);
    });
  });

  await test("Undercover: two 👎 remove the pair for the evening", async () => {
    const t = setup(undercover, ["A", "B", "C", "D"], []);
    t.act("host", "finalizeSettings");
    const key = t.s().pair.key;
    t.s().phase = "ended";
    t.act("p0", "ratePair", { up: false });
    t.act("p1", "ratePair", { up: false });
    t.act("p1", "ratePair", { up: false }); // same vote twice counts once
    const st = t.log.filter((x) => x[1] === "uc:state").pop()[2];
    assert.deepStrictEqual(st.rating, { up: 0, down: 2 });
    assert.strictEqual(t.room.ucMemory.ratings.get(key).down, 2);
    t.room.ucMemory.seen.clear(); // even when everything is "fresh" again...
    for (let i = 0; i < 300; i++) { undercover.onCheat(t.api, t.room, "redeal"); assert.notStrictEqual(t.s().pair.key, key); }
  });

  await test("Undercover: Mr. White can say just the first or last name", async () => {
    const t = setup(undercover, ["A", "B", "C", "D"], []);
    t.act("host", "finalizeSettings");
    const s = t.s();
    s.pair = { kind: "character", key: "x", civil: { name: "Monkey D. Luffy" }, undercover: { name: "Son Goku" } };
    s.roles.p0 = "mrwhite"; s.phase = "mrwhite"; s.mrwhiteGuessing = "p0";
    t.act("p0", "mrwhiteGuess", { word: "luffy" });
    assert.strictEqual(s.mrwhiteGuessResult.correct, true);
    s.phase = "mrwhite"; s.mrwhiteGuessing = "p0";
    t.act("p0", "mrwhiteGuess", { word: "D" }); // too short to count
    assert.strictEqual(s.mrwhiteGuessResult.correct, false);
  });

  await test("Undercover: the host chooses the number of undercovers (capped)", async () => {
    const t = setup(undercover, ["A", "B", "C", "D", "E", "F", "G"], []);
    t.act("host", "setUndercovers", { value: 3 });
    assert.strictEqual(t.s().settings.nbUnder, 3);
    t.act("host", "finalizeSettings");
    assert.strictEqual(Object.values(t.s().roles).filter((r) => r === "undercover").length, 3);
    const t2 = setup(undercover, ["A", "B", "C", "D"], []);
    t2.act("host", "setUndercovers", { value: 3 }); // 4 players: at most 1
    assert.strictEqual(t2.s().settings.nbUnder, 1);
    t2.act("p0", "setUndercovers", { value: "auto" }); // a player cannot
    assert.strictEqual(t2.s().settings.nbUnder, 1);
  });

  await test("Undercover: Mr. White never speaks 1st or 2nd, in every round", async () => {
    for (let k = 0; k < 40; k++) {
      const t = setup(undercover, ["A", "B", "C", "D", "E", "F"], []);
      t.act("p0", "voteSetting", { key: "mrWhite", value: true });
      t.act("host", "finalizeSettings");
      const s = t.s();
      const mr = Object.keys(s.roles).find((id) => s.roles[id] === "mrwhite");
      for (let r = 0; r < 3; r++) {
        const speaking = s.order.filter((id) => s.alive[id]);
        assert.ok(speaking.indexOf(mr) >= 2, "round " + s.round + ": Mr. White at " + speaking.indexOf(mr));
        s.phase = "reveal"; s.winner = null; t.act("host", "next");
      }
    }
  });

  await test("Undercover: leaving never freezes the game (vote, Mr. White's guess)", async () => {
    const t = setup(undercover, ["A", "B", "C", "D", "E", "F"], []);
    t.act("host", "setUndercovers", { value: 1 }); // 1 undercover: a civil leaving does not end the game
    t.act("host", "finalizeSettings"); t.act("host", "beginClues"); t.act("host", "toVote");
    const s = t.s();
    const civ = Object.keys(s.roles).filter((id) => s.roles[id] === "civil");
    const [x, y] = civ;
    // everyone but x votes; one of them votes FOR x; then x leaves
    const others = Object.keys(s.roles).filter((id) => id !== x);
    others.forEach((id, i) => t.act(id, "vote", { targetId: i === 0 ? x : (id === y ? others[1] : y) }));
    t.room.players = t.room.players.filter((p) => p.seatId !== x);
    undercover.onPlayerLeave(t.api, t.room, x);
    assert.ok(t.log.some((l) => l[1] === "uc:revote"), "whoever voted for the leaver must revote");
    assert.strictEqual(s.phase, "vote");
    const again = others.find((id) => !s.votes[id]);
    t.act(again, "vote", { targetId: others.find((o) => o !== again) });
    assert.notStrictEqual(s.phase, "vote", "all remaining votes in -> counted");
    assert.strictEqual(s.lastLeft.name, t.s().names[x]);
    // Mr. White leaves while guessing
    const t2 = setup(undercover, ["A", "B", "C", "D"], []);
    t2.act("host", "finalizeSettings");
    const s2 = t2.s();
    s2.roles.p1 = "mrwhite"; s2.phase = "mrwhite"; s2.mrwhiteGuessing = "p1";
    undercover.onPlayerLeave(t2.api, t2.room, "p1");
    assert.strictEqual(s2.phase, "reveal");
    assert.strictEqual(s2.mrwhiteGuessResult.left, true);
  });

  await test("Undercover: end screen gives each player's id (own result by id)", async () => {
    const t = setup(undercover, ["A", "B", "C", "D"], []);
    t.act("host", "finalizeSettings");
    t.s().phase = "reveal"; t.s().winner = "civils"; t.act("host", "next");
    const st = t.log.filter((x) => x[1] === "uc:state").pop()[2];
    assert.ok(st.finalRoles.every((r) => r.id && r.name && r.role));
  });

  await test("Undercover: every character has a series (right picture)", async () => {
    const d = require("./games/undercover/data.js");
    const missing = Object.keys(d.CHARS).filter((n) => !d.SERIES[n]);
    assert.deepStrictEqual(missing, []);
  });

  console.log(`\n${ok} test(s) OK` + (process.exitCode ? " — DES ECHECS" : ""));
  setTimeout(() => process.exit(process.exitCode || 0), 50);
})();
