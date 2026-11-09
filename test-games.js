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

  console.log(`\n${ok} test(s) OK` + (process.exitCode ? " — DES ECHECS" : ""));
  setTimeout(() => process.exit(process.exitCode || 0), 50);
})();
