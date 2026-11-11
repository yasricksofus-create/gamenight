// test-engine.js -- Tests of the GENERIC engine through real connections
// (a host and phones talking to the server like browsers do). Run: node test-engine.js
process.env.PORT = process.env.PORT || "3990";
process.env.GRACE_MS = "400";            // short grace delay for the tests
process.env.FEEDBACK_KEY = process.env.FEEDBACK_KEY_TEST || "";
const assert = require("assert");
require("./server.js");
const { gameModules } = require("./engine/games-loader");
const { io } = require("socket.io-client");
const URL = "http://localhost:" + process.env.PORT;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const once = (s, ev, ms = 3000) => new Promise((res, rej) => { const t = setTimeout(() => rej(new Error("no " + ev)), ms); s.once(ev, (d) => { clearTimeout(t); res(d); }); });
const client = () => io(URL, { transports: ["websocket"], forceNew: true });
let ok = 0;
async function test(name, fn) {
  try { await fn(); ok++; console.log("  ✓ " + name); }
  catch (e) { console.log("  ✗ " + name + "\n    " + (e && e.stack || e)); process.exitCode = 1; }
}
async function room(gameId, names) {
  const h = client();
  h.emit("host:createRoom", { gameId });
  const { code, hostToken } = await once(h, "room:created");
  const ps = [];
  for (const n of names) { const p = client(); p.emit("player:join", { code, name: n }); const j = await once(p, "join:success"); p.seat = j.seatId; ps.push(p); }
  return { h, ps, code, hostToken };
}

(async () => {
  await wait(300);
  console.log("Moteur — tests");

  await test("an action from a phone reaches the game with the right player", async () => {
    const { h, ps } = await room("undercover", ["A", "B", "C"]);
    const seen = [];
    const real = gameModules.undercover.handle;
    gameModules.undercover.handle = function (api, actor, r, type) { seen.push([actor.seatId, type, !!r.code]); return real.apply(this, arguments); };
    h.emit("host:startGame"); await wait(150);
    ps[1].emit("game:action", { type: "voteSetting", payload: { key: "mode", value: "classique" } });
    h.emit("game:action", { type: "finalizeSettings" });
    await wait(200);
    gameModules.undercover.handle = real;
    assert.deepStrictEqual(seen[0], [ps[1].seat, "voteSetting", true]);
    assert.deepStrictEqual(seen[1], [null, "finalizeSettings", true]);
    [h, ...ps].forEach((s) => s.close());
  });

  await test("a bug inside a game does not stop the server", async () => {
    const { h, ps } = await room("cascade", ["A", "B"]);
    const real = gameModules.cascade.handle;
    gameModules.cascade.handle = () => { throw new Error("bug exprès (test)"); };
    h.emit("host:startGame"); await wait(100);
    const warned = once(h, "game:error");
    ps[0].emit("game:action", { type: "play", payload: {} });
    await warned;
    gameModules.cascade.handle = real;
    assert.strictEqual(await fetch(URL + "/healthz").then((r) => r.text()), "ok");
    [h, ...ps].forEach((s) => s.close());
  });

  await test("a second tab takes the place, the first one is told", async () => {
    const { h, ps, code, hostToken } = await room("undercover", ["A"]);
    const h2 = client();
    const told = once(h, "session:replaced");
    h2.emit("host:reconnect", { code, hostToken });
    await once(h2, "host:reconnected"); await told;
    const p2 = client();
    const told2 = once(ps[0], "session:replaced");
    p2.emit("player:reconnect", { code, seatId: ps[0].seat });
    await once(p2, "reconnect:success"); await told2;
    [h, h2, p2, ...ps].forEach((s) => s.close());
  });

  await test("ready button, host removes a player", async () => {
    const { h, ps } = await room("undercover", ["A", "B"]);
    await wait(150); // let the "X joined" updates arrive first
    let up = once(h, "room:playersUpdate");
    ps[0].emit("player:ready", { ready: true });
    assert.ok((await up).players.find((p) => p.name === "A").ready);
    const kicked = once(ps[1], "room:kicked");
    up = once(h, "room:playersUpdate");
    h.emit("host:kick", { seatId: ps[1].seat });
    await kicked;
    assert.deepStrictEqual((await up).players.map((p) => p.name), ["A"]);
    [h, ...ps].forEach((s) => s.close());
  });

  await test("joining during a game = spectator, then plays after « retour au hall »", async () => {
    const { h, ps, code } = await room("undercover", ["A", "B", "C"]);
    h.emit("host:startGame"); await wait(150);
    const late = client();
    late.emit("player:join", { code, name: "Late" });
    const j = await once(late, "join:success");
    assert.strictEqual(j.spectator, true);
    // a spectator's actions are ignored by the engine
    let touched = false;
    const real = gameModules.undercover.handle;
    gameModules.undercover.handle = function (api, actor) { if (actor.seatId === j.seatId) touched = true; return real.apply(this, arguments); };
    late.emit("game:action", { type: "voteSetting", payload: { key: "mode", value: "classique" } });
    await wait(150);
    gameModules.undercover.handle = real;
    assert.strictEqual(touched, false);
    const stopped = once(late, "game:stopped");
    const up = once(h, "room:playersUpdate");
    h.emit("host:backToLobby");
    await stopped;
    assert.ok((await up).players.every((p) => !p.spectator));
    [h, late, ...ps].forEach((s) => s.close());
  });

  await test("a player removed after the delay takes their place back with the same name", async () => {
    const { h, ps, code } = await room("kietkoutsa", ["A", "B", "C"]);
    const seat = ps[2].seat;
    ps[2].close();
    await wait(700); // grace = 400 ms in the tests
    const again = client();
    again.emit("player:join", { code, name: "c" }); // same name, other case
    const j = await once(again, "join:success");
    assert.strictEqual(j.seatId, seat);
    assert.strictEqual(j.back, true);
    [h, again, ...ps.slice(0, 2)].forEach((s) => s.close());
  });

  await test("pause blocks the players' actions; change of game keeps the room", async () => {
    const { h, ps, code } = await room("undercover", ["A", "B", "C"]);
    h.emit("host:startGame"); await wait(150);
    const seen = [];
    const real = gameModules.undercover.handle;
    gameModules.undercover.handle = function (api, actor, r, type) { seen.push(type); return real.apply(this, arguments); };
    const paused = once(ps[0], "room:paused");
    h.emit("host:pause", { paused: true });
    assert.strictEqual((await paused).paused, true);
    ps[0].emit("game:action", { type: "voteSetting", payload: { key: "mode", value: "classique" } });
    await wait(150);
    assert.deepStrictEqual(seen, []);
    h.emit("host:pause", { paused: false }); await wait(100);
    ps[0].emit("game:action", { type: "voteSetting", payload: { key: "mode", value: "classique" } });
    await wait(150);
    gameModules.undercover.handle = real;
    assert.deepStrictEqual(seen, ["voteSetting"]);
    const changed = once(ps[1], "room:gameChanged");
    h.emit("host:changeGame", { gameId: "cascade" });
    assert.strictEqual((await changed).game.id, "cascade");
    const p2 = client(); // still the same room code, still the same players
    p2.emit("player:reconnect", { code, seatId: ps[1].seat });
    const r = await once(p2, "reconnect:success");
    assert.strictEqual(r.game.id, "cascade");
    [h, p2, ...ps].forEach((s) => s.close());
  });

  await test("the host screen can be handed to a player", async () => {
    const { h, ps, code } = await room("undercover", ["A"]);
    const offer = once(ps[0], "host:offer");
    h.emit("host:transfer", { seatId: ps[0].seat });
    const o = await offer;
    assert.strictEqual(o.code, code);
    const newHost = client();
    const told = once(h, "host:transferred");
    newHost.emit("host:reconnect", { code, hostToken: o.token });
    await once(newHost, "host:reconnected"); await told;
    [h, newHost, ...ps].forEach((s) => s.close());
  });

  await test("room creation is limited per address", async () => {
    let refused = null;
    for (let i = 0; i < 12 && !refused; i++) {
      const x = client();
      x.emit("host:createRoom", { gameId: "cascade" });
      refused = await Promise.race([once(x, "room:created").then(() => null), once(x, "room:error").then((m) => m.message)]);
      x.close();
    }
    assert.ok(refused && /Trop de salles/.test(refused));
  });

  await test("feedback page closed without a password setting", async () => {
    assert.strictEqual((await fetch(URL + "/admin/feedback?key=gamenight")).status, 503);
  });

  console.log(`\n${ok} test(s) OK` + (process.exitCode ? " — DES ECHECS" : ""));
  process.exit(process.exitCode || 0);
})();
