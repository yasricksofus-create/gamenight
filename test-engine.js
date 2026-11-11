// test-engine.js -- Tests of the GENERIC engine through real connections
// (a host and phones talking to the server like browsers do). Run: node test-engine.js
process.env.PORT = process.env.PORT || "3990";
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
