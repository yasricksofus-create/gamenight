// test-kietkoutsa-browser.js -- Full game of Kietkoutsa Reborn in real browsers
// (Playwright): 1 host screen + 3 phones + 1 late arrival + 1 phone reload.
// The music catalogue is SIMULATED (no internet needed): fetch() is replaced
// before the server starts. Run:  node test-kietkoutsa-browser.js
// Screenshots go to ./test-shots/.

process.env.PORT = process.env.PORT || "3999";
process.env.GRACE_MS = "20000";
const fs = require("fs");
const path = require("path");
const SHOTS = path.join(__dirname, "test-shots");
fs.mkdirSync(SHOTS, { recursive: true });

// ----- a tiny WAV tone, served as the "preview" through our proxy -----
function wav(seconds, freq) {
  const rate = 8000, n = rate * seconds, buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write("WAVEfmt ", 8);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write("data", 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin((2 * Math.PI * freq * i) / rate) * 8000 * (1 + Math.sin(i / 900)) / 2), 44 + i * 2);
  return buf;
}
const TONE = wav(20, 440);
let N = 0;
const fakeTrack = (q) => {
  const id = ++N;
  return { id, title: q + " hit " + id, preview: "https://cdnt-preview.dzcdn.net/api/1/1/a/b/c/0/" + id + ".mp3", link: "https://www.deezer.com/track/" + id,
    explicit_lyrics: id % 5 === 0, artist: { name: "Artiste " + (id % 4) }, album: { cover_medium: "https://e-cdns-images.dzcdn.net/images/cover/" + id + "/250x250.jpg" } };
};
const realFetch = global.fetch;
global.fetch = async (url, opts) => {
  url = String(url);
  if (url.startsWith("http://localhost")) return realFetch(url, opts); // our own server
  const range = opts && opts.headers && opts.headers.Range;
  if (url.includes("api.deezer.com/search")) {
    const q = decodeURIComponent((url.match(/q=([^&]*)/) || [])[1] || "x");
    return new Response(JSON.stringify({ data: [fakeTrack(q), fakeTrack(q), fakeTrack(q), fakeTrack(q)] }));
  }
  if (url.includes("api.deezer.com/chart")) return new Response(JSON.stringify({ data: [fakeTrack("Top"), fakeTrack("Top")] }));
  if (url.includes("api.deezer.com/track/")) return new Response(JSON.stringify({ error: {} }));
  if (url.includes("dzcdn.net")) {
    // behaves like a real CDN: honours "Range" (partial download -> 206)
    const m = range && /bytes=(\d+)-(\d*)/.exec(range);
    if (m) {
      const a = +m[1], b = m[2] ? Math.min(+m[2], TONE.length - 1) : TONE.length - 1;
      return new Response(TONE.subarray(a, b + 1), { status: 206, headers: { "content-type": "audio/wav", "content-length": String(b - a + 1),
        "content-range": `bytes ${a}-${b}/${TONE.length}`, "accept-ranges": "bytes" } });
    }
    return new Response(TONE, { headers: { "content-type": "audio/wav", "content-length": String(TONE.length), "accept-ranges": "bytes" } });
  }
  throw new Error("blocked in test: " + url);
};

require("./server.js");
const K = require("./games/kietkoutsa/server.js");
K._cfg.LEAD_MS = 800;

const { chromium } = require("playwright");
const BASE = "http://localhost:" + process.env.PORT;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  // ----- engine HTTP checks: compression, cache headers, Range on the proxy -----
  await wait(300);
  const js = await fetch(BASE + "/games/kietkoutsa/client/common.js", { headers: { "accept-encoding": "gzip" } });
  console.log("gzip:", js.headers.get("content-encoding"), "| js cache:", js.headers.get("cache-control"));
  const mp3 = await fetch(BASE + "/sounds/README.txt");
  const pv = await fetch(BASE + "/api/music/preview?u=" + encodeURIComponent("https://cdnt-preview.dzcdn.net/x.mp3"), { headers: { range: "bytes=1000-1999" } });
  console.log("proxy range:", pv.status, pv.headers.get("content-range"), (await pv.arrayBuffer()).byteLength + " bytes");
  if (pv.status !== 206 || js.headers.get("content-encoding") !== "gzip") throw new Error("engine HTTP checks failed");
  const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
  const errors = [];
  const watch = (page, who) => {
    page.on("pageerror", (e) => errors.push(who + " pageerror: " + e.message));
    page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|ERR_|net::|qrcode/i.test(m.text())) errors.push(who + " console: " + m.text()); });
  };
  const hostCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const host = await hostCtx.newPage(); watch(host, "host");
  await host.goto(BASE + "/host.html?game=kietkoutsa");
  await host.waitForFunction(() => /^[A-Z]{4}$/.test(document.getElementById("room-code").textContent));
  const code = await host.textContent("#room-code");
  console.log("room", code);

  const phones = [];
  global.__dump = async () => { await host.screenshot({ path: path.join(SHOTS, "err-host.png") }); for (const ph of phones) await ph.p.screenshot({ path: path.join(SHOTS, "err-" + ph.name + ".png") }); };
  for (const name of ["Lea", "Tom", "Zoe"]) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, isMobile: true, hasTouch: true });
    const p = await ctx.newPage(); watch(p, name);
    await p.goto(`${BASE}/player.html?room=${code}&name=${name}`);
    await p.waitForSelector("#connected:not(.hidden)");
    phones.push({ name, p, ctx });
  }
  await host.click("#start-btn");
  await host.waitForSelector("#kkt-begin");

  // phones: avatar + mode vote
  await phones[0].p.waitForSelector("[data-mode=usurp]");
  await phones[0].p.click("[data-av-e='👽']");
  await phones[0].p.click("[data-mode=classic]");
  await phones[1].p.click("[data-mode=classic]");
  // host: toggle a few options
  await host.click("[data-set=bets]");
  await host.click("[data-set=theme]");
  await host.click("[data-set=roundSec][data-val='15']");
  await host.waitForSelector("#kkt-apply-vote");
  await host.click("#kkt-apply-vote");
  await wait(300);
  await host.screenshot({ path: path.join(SHOTS, "1-host-settings.png"), fullPage: true });
  await phones[0].p.screenshot({ path: path.join(SHOTS, "1-phone-settings.png"), fullPage: true });
  await host.click("#kkt-begin");

  // submissions
  for (const ph of phones) {
    await ph.p.waitForSelector(".kkt-search");
    await ph.p.fill(".kkt-search", ph.name + " song");
    await ph.p.waitForSelector("[data-pick]");
    if (process.env.DBG) console.log(await ph.p.evaluate(() => { const b = document.querySelector("[data-pick='0']").getBoundingClientRect();
      const e = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
      const wide = [...document.querySelectorAll("body *")].filter((x) => x.getBoundingClientRect().right > 392).slice(0, 6).map((x) => x.tagName + "." + x.className + ":" + Math.round(x.getBoundingClientRect().right));
      return JSON.stringify({ wide, sw: document.documentElement.scrollWidth, iw: innerWidth, vv: visualViewport.width, scale: visualViewport.scale, b: [b.x, b.y, b.width], hit: e && e.outerHTML.slice(0, 60) }); }));
    await ph.p.click("[data-pick='0']");
    await ph.p.waitForSelector("[data-note]");
    await ph.p.fill("[data-note]", "Message secret de " + ph.name);
    await ph.p.locator("[data-note]").blur();
  }
  // duplicate: Tom tries Lea's exact track -> refused (title differs per query, so test chips instead)
  await phones[1].p.click("[data-q='@charts']");
  await wait(400);
  await phones[0].p.screenshot({ path: path.join(SHOTS, "2-phone-submit.png"), fullPage: true });
  await host.waitForFunction(() => { const b = document.getElementById("kkt-start"); return b && !b.disabled; });
  await host.screenshot({ path: path.join(SHOTS, "2-host-submit.png") });
  await host.click("#kkt-start");

  // round 1
  await host.waitForSelector("#kkt-p-players");
  await wait(1500);
  const audioOk = await host.evaluate(() => kktAudio.playing);
  console.log("host audio playing:", audioOk);
  // late arrival
  const lateCtx = await browser.newContext({ viewport: { width: 390, height: 800 }, isMobile: true });
  const late = await lateCtx.newPage(); watch(late, "Late");
  await late.goto(`${BASE}/player.html?room=${code}&name=Max`);
  await late.waitForSelector("#game-root:not(.hidden) #kkt-vp", { timeout: 8000 });
  console.log("late player joined mid-game: OK");
  // reload the HOST mid-round: the music must resume at the right second
  await wait(2500);
  await host.reload();
  await host.waitForSelector("#kkt-p-players", { timeout: 10000 });
  await wait(2500);
  const st = await host.evaluate(() => ({ playing: kktAudio.playing, time: kktAudio.time }));
  console.log("host reload mid-round -> playing:", st.playing, "| resumed at", st.time.toFixed(1) + "s");
  if (!st.playing || st.time < 3) throw new Error("music did not resume at the right second");
  // reload one phone mid-round (reconnection)
  await phones[2].p.reload();
  await phones[2].p.waitForSelector("#kkt-vp .kkt-vb", { timeout: 8000 });
  console.log("phone reload mid-round: OK");
  // everybody votes (+ a bet + a reaction)
  for (const ph of phones.concat([{ name: "Max", p: late }])) {
    await ph.p.waitForSelector("#kkt-vp [data-vote]:not([disabled])");
    await ph.p.click("#kkt-vp [data-vote]:not([disabled]) >> nth=0");
    await wait(150);
    if (await ph.p.$("[data-bet='2']:not([disabled])")) await ph.p.click("[data-bet='2']");
  }
  await phones[0].p.click(".gn-rx-bar button >> nth=0");
  await wait(400);
  await host.screenshot({ path: path.join(SHOTS, "3-host-playing.png") });
  await phones[0].p.screenshot({ path: path.join(SHOTS, "3-phone-playing.png"), fullPage: true });

  // reveal (early end ~5s after the last vote)
  await host.waitForSelector("#kkt-arrows", { timeout: 15000 });
  await wait(600);
  await phones[1].p.screenshot({ path: path.join(SHOTS, "4-phone-reveal-wait.png") });
  await wait(4200);
  await host.screenshot({ path: path.join(SHOTS, "4-host-reveal.png"), fullPage: true });
  await phones[1].p.waitForSelector("#kkt-lb .kkt-le", { timeout: 6000 });
  if (await phones[1].p.$("[data-rate='1']")) await phones[1].p.click("[data-rate='1']");
  await wait(300);
  await phones[1].p.screenshot({ path: path.join(SHOTS, "4-phone-reveal.png"), fullPage: true });

  // remaining rounds: skip quickly with the cheat, then next
  for (let i = 0; i < 6; i++) {
    const ph = await host.evaluate(() => document.querySelector("#kkt-next") ? "reveal" : document.querySelector("#kkt-p-players") ? "playing" : "other");
    if (ph === "reveal") { await host.click("#kkt-next"); await wait(500); continue; }
    if (ph === "playing") {
      await host.click("#kkt-drawer-btn");
      await host.click("[data-cheat='skip-track']");
      await wait(400);
      continue;
    }
    break;
  }
  await host.waitForSelector(".kkt-slide", { timeout: 8000 });
  await host.screenshot({ path: path.join(SHOTS, "5-host-wrapped.png") });
  await host.click("#kkt-w-skip");
  await wait(300);
  await host.screenshot({ path: path.join(SHOTS, "6-host-ended.png"), fullPage: true });
  await phones[0].p.screenshot({ path: path.join(SHOTS, "6-phone-ended.png"), fullPage: true });
  await host.click("#kkt-tourney");
  await host.waitForSelector("#kkt-begin");
  console.log("tournament replay: OK");

  // ===== Scenario 2: Mashup + Blind + the host plays through the secret panel =====
  const all = phones.concat([{ name: "Max", p: late }]);
  await host.click("[data-set=hostPlays]");
  await host.click("[data-mode=mashup]");
  await host.click("[data-set=blind]");
  await wait(300);
  await host.click("#kkt-begin");
  await host.waitForSelector("#kkt-secret-btn:not([hidden])");
  await host.click("#kkt-secret-btn");
  await host.fill("#kkt-secret .kkt-search", "host song");
  await host.waitForSelector("#kkt-secret [data-pick]");
  await host.click("#kkt-secret [data-pick='0']");
  await wait(300);
  await host.screenshot({ path: path.join(SHOTS, "7-host-secret-submit.png") });
  await host.click("#kkt-secret-close");
  for (const ph of all) {
    await ph.p.waitForSelector(".kkt-search");
    await ph.p.fill(".kkt-search", ph.name + " two");
    await ph.p.waitForSelector("[data-pick]");
    await ph.p.click("[data-pick='1']");
  }
  await host.waitForFunction(() => { const b = document.getElementById("kkt-start"); return b && !b.disabled; });
  await host.click("#kkt-start");
  await host.waitForSelector("[data-seg='1']");
  await wait(1200);
  await host.screenshot({ path: path.join(SHOTS, "8-host-mashup-blind.png") });
  await host.click("#kkt-secret-btn");
  await host.waitForSelector("#kkt-secret [data-vote][data-part='1']");
  await host.click("#kkt-secret [data-vote][data-part='0'] >> nth=0");
  await wait(200);
  await host.screenshot({ path: path.join(SHOTS, "8-host-secret-vote.png") });
  await wait(1200);
  const secretOpen = await host.evaluate(() => document.getElementById("kkt-secret").classList.contains("open"));
  console.log("secret panel auto-closed after vote:", !secretOpen);
  const guessBox = await phones[0].p.$("#kkt-g-title");
  if (guessBox) { await phones[0].p.fill("#kkt-g-title", "abc"); await phones[0].p.click("#kkt-g-send"); }
  await phones[0].p.screenshot({ path: path.join(SHOTS, "8-phone-mashup.png"), fullPage: true });
  for (let i = 0; i < 8; i++) {
    const ph = await host.evaluate(() => document.querySelector("#kkt-next") ? "reveal" : document.querySelector("#kkt-p-players") ? "playing" : "other");
    if (ph === "reveal") { await host.click("#kkt-next"); await wait(500); continue; }
    if (ph === "playing") { await host.click("#kkt-drawer-btn"); await host.click("[data-cheat='skip-track']"); await wait(400); continue; }
    break;
  }
  await host.waitForSelector(".kkt-slide", { timeout: 8000 });
  console.log("scenario 2 (mashup + blind + host plays): OK");

  console.log(errors.length ? "ERRORS:\n" + errors.join("\n") : "no page errors");
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})().catch(async (e) => { console.error(String(e).slice(0, 400)); try { await global.__dump(); } catch (x) {} process.exit(1); });
