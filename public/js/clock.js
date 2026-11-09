// clock.js -- Generic "server clock" for every game (engine side).
//
// Each computer/phone has its own clock, often a few seconds off. To start a
// song at the SAME moment everywhere, the server says "start at 12:00:03.500
// server time", and every browser converts that to its own clock.
//
// How: we ask the server its time a few times ("ping"), measure the round trip,
// keep the fastest sample (the least delayed), and compute an OFFSET:
//   serverTime ~= Date.now() + offset
// ServerClock.now() then gives the server time from any browser.
window.ServerClock = (function () {
  let offset = 0;
  let ready = false;

  function sample() {
    return new Promise((resolve) => {
      const s = window.socket;
      if (!s || !s.connected) return resolve(null);
      const t0 = Date.now();
      let done = false;
      const to = setTimeout(() => { if (!done) { done = true; resolve(null); } }, 3000);
      s.emit("clock:ping", (serverNow) => {
        if (done) return;
        done = true; clearTimeout(to);
        const t1 = Date.now();
        const rtt = t1 - t0; // round-trip time
        // The server answered roughly in the middle of the round trip.
        resolve({ rtt, offset: serverNow + rtt / 2 - t1 });
      });
    });
  }

  async function sync() {
    const samples = [];
    const n = ready ? 2 : 5; // first calibration: 5 samples; later checks: 2 are enough
    for (let i = 0; i < n; i++) {
      const r = await sample();
      if (r) samples.push(r);
    }
    if (!samples.length) return;
    samples.sort((a, b) => a.rtt - b.rtt);
    offset = samples[0].offset;
    ready = true;
  }

  function start() {
    if (!window.socket) return setTimeout(start, 200);
    window.socket.on("connect", sync);
    if (window.socket.connected) sync();
    setInterval(sync, 60000); // clocks drift a little: resync every minute
  }
  start();

  return {
    now: () => Date.now() + offset,
    get offset() { return offset; },
    get ready() { return ready; },
    sync,
  };
})();
