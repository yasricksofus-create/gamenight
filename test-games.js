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
    assert.ok(["reveal", "mrwhite", "vote", "defense"].includes(s.phase));
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
    const [x, T, Q] = civ;            // x will leave; most votes go to T; T votes Q
    const others = Object.keys(s.roles).filter((id) => id !== x);
    const forX = others.find((id) => id !== T); // this one votes for x (before x leaves)
    others.forEach((id) => {
      if (id === forX) t.act(id, "vote", { targetId: x });
      else if (id === T) t.act(id, "vote", { targetId: Q });
      else t.act(id, "vote", { targetId: T });
    });
    t.room.players = t.room.players.filter((p) => p.seatId !== x);
    undercover.onPlayerLeave(t.api, t.room, x);
    assert.ok(t.log.some((l) => l[0] === forX && l[1] === "uc:revote"), "whoever voted for the leaver must revote");
    assert.strictEqual(s.phase, "vote");
    t.act(forX, "vote", { targetId: T });
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

  await test("Undercover: host options (category, difficulty) shape the draw", async () => {
    const t = setup(undercover, ["A", "B", "C", "D"], []);
    t.act("host", "setOption", { key: "category", value: "Animaux" });
    t.act("host", "setOption", { key: "difficulty", value: "expert" });
    t.act("host", "setOption", { key: "debateSec", value: 45 }); // not an allowed value
    t.act("p0", "setOption", { key: "votePublic", value: true }); // a player cannot
    assert.strictEqual(t.room.ucMemory.opts.debateSec, 0);
    assert.strictEqual(t.room.ucMemory.opts.votePublic, false);
    const d = require("./games/undercover/data.js");
    const ok = new Set(d.WORD_CATS.Animaux.filter((w) => w[2] === "expert").map((w) => [w[0], w[1]].sort().join(" / ")));
    t.act("host", "finalizeSettings");
    for (let i = 0; i < 6; i++) { assert.ok(ok.has(t.s().pair.key.split(":")[1]), t.s().pair.key); undercover.onCheat(t.api, t.room, "redeal"); }
  });

  await test("Undercover: who speaks, bot clues, debate timer opens the vote", async () => {
    const t = setup(undercover, ["A", "Bot 1", "Bot 2", "Bot 3"], ["Bot 1", "Bot 2", "Bot 3"]);
    t.act("host", "setOption", { key: "debateSec", value: 30 });
    t.act("host", "finalizeSettings");
    const s = t.s();
    s.order = ["p1", "p2", "p0", "p3"]; // bots first
    t.act("host", "beginClues");
    await wait(5000); // 2 bots speak (2.2 s each) then it is A's turn
    assert.strictEqual(s.order.filter((id) => s.alive[id])[s.speakerIdx], "p0");
    assert.ok(s.clues.p1 && s.clues.p2, "bots gave a clue");
    t.act("host", "nextSpeaker");
    s.debateEndsAt = null; t.room.ucMemory.opts.debateSec = 30;
    t.act("host", "startDebate");
    assert.ok(s.debateEndsAt > Date.now());
    clearTimeout(s.debateTimer);
    t.act("host", "toVote");
    assert.strictEqual(s.phase, "vote");
  });

  await test("Undercover: last word, then confirm or revote; recap and evening score", async () => {
    const t = setup(undercover, ["A", "B", "C", "D", "E", "F"], []);
    t.act("host", "setUndercovers", { value: 1 });
    t.act("host", "finalizeSettings"); t.act("host", "beginClues"); t.act("host", "toVote");
    const s = t.s();
    const und = Object.keys(s.roles).find((id) => s.roles[id] === "undercover");
    Object.keys(s.roles).forEach((id) => t.act(id, "vote", { targetId: id === und ? Object.keys(s.roles).find((x) => x !== und) : und }));
    assert.strictEqual(s.phase, "defense");
    t.act("host", "revoteDefense");
    assert.strictEqual(s.phase, "vote");
    Object.keys(s.roles).forEach((id) => t.act(id, "vote", { targetId: id === und ? Object.keys(s.roles).find((x) => x !== und) : und }));
    t.act("host", "confirmElim");
    assert.strictEqual(s.winner, "civils");
    t.act("host", "next");
    assert.strictEqual(s.phase, "ended");
    const st = t.log.filter((x) => x[1] === "uc:state").pop()[2];
    assert.strictEqual(st.voteLog.length, 2);
    assert.ok(st.evening.scores.length >= 5 && st.evening.scores[0].pts === 2);
    assert.ok(st.evening.detective && st.evening.detective.n >= 2);
  });

  await test("Undercover: the eliminated see every card, except on the host's phone", async () => {
    const t = setup(undercover, ["A", "B", "C", "D", "E", "F"], []);
    t.api.players = () => t.room.players.map((p, i) => ({ id: p.seatId, name: p.name, hostDevice: i === 1 }));
    t.act("host", "setOption", { key: "lastWord", value: false });
    t.act("host", "setUndercovers", { value: 1 });
    t.act("host", "finalizeSettings"); t.act("host", "beginClues"); t.act("host", "toVote");
    const s = t.s();
    const civ = Object.keys(s.roles).filter((id) => s.roles[id] === "civil" && id !== "p1");
    const out = civ[0];
    Object.keys(s.roles).forEach((id) => t.act(id, "vote", { targetId: id === out ? civ[1] : out }));
    assert.strictEqual(s.alive[out], false);
    assert.ok(t.log.some((l) => l[0] === out && l[1] === "uc:allCards"));
    // the host's phone (p1) never gets them, even once dead
    s.alive.p1 = false;
    undercover.onReconnect(t.api, t.room, { seatId: "p1" });
    await wait(100);
    assert.ok(!t.log.some((l) => l[0] === "p1" && l[1] === "uc:allCards"));
  });

  await test("Undercover: a proposed pair accepted by the host comes into play", async () => {
    const t = setup(undercover, ["A", "B", "C", "D"], []);
    t.act("p0", "proposePair", { a: "Rhum arrangé", b: "Punch", kind: "word" });
    const pr = t.room.ucMemory.proposals[0];
    assert.ok(pr && pr.by === "A");
    t.act("host", "answerPair", { id: pr.id, ok: true });
    assert.ok(t.log.some((l) => l[0] === "p0" && l[1] === "uc:proposalAnswer" && l[2].ok));
    t.act("host", "setOption", { key: "category", value: "Perso" });
    t.act("host", "finalizeSettings");
    assert.strictEqual(t.s().pair.key, "classique:Punch / Rhum arrangé");
  });

  await test("Undercover: « Anime au hasard » and « Best of » deal", async () => {
    const t = setup(undercover, ["A", "B", "C", "D"], []);
    t.act("p0", "voteSetting", { key: "mode", value: "best_of" });
    t.act("host", "finalizeSettings");
    assert.ok(t.s().pair && t.s().pair.key);
    t.room.ucMemory.ratings.set("anime_saison:Denji / Yuji Itadori", { up: 3, down: 0 });
    t.s().settings.mode = "best_of";
    undercover.onCheat(t.api, t.room, "redeal");
    assert.strictEqual(t.s().pair.key, "anime_saison:Denji / Yuji Itadori");
    t.s().settings.mode = "anime_hasard";
    undercover.onCheat(t.api, t.room, "redeal");
    assert.strictEqual(t.s().pair.kind, "character");
  });

  console.log(`\n${ok} test(s) OK` + (process.exitCode ? " — DES ECHECS" : ""));
  setTimeout(() => process.exit(process.exitCode || 0), 50);
})();
