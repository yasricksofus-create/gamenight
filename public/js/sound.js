// sound.js -- Sound manager (used ONLY by the Undercover game today).
//
// Features:
//  - several VARIANTS per key: play() picks one at random, never the same twice
//    in a row, so a repeated moment doesn't get boring;
//  - smooth transitions: looping music fades IN, fades OUT, and automatically
//    "ducks" (drops in volume) while a short sound effect plays, then recovers;
//  - browsers block audio until the first interaction, so we unlock on the first
//    click/touch/key and queue anything asked for before that;
//  - a missing file just fails silently (no error).
window.Sound = (function () {
  const reg = {}; // key -> { audios:[], loop, volume, lastIdx, current, _restore }
  let unlocked = false;
  const pending = [];

  function unlock() {
    if (unlocked) return;
    unlocked = true;
    pending.splice(0).forEach((fn) => fn());
  }
  ["click", "touchstart", "keydown"].forEach((e) =>
    window.addEventListener(e, unlock, { passive: true }));

  // urls can be a single string or an array of variant URLs.
  function register(key, urls, opts) {
    opts = opts || {};
    const list = Array.isArray(urls) ? urls : [urls];
    reg[key] = {
      loop: !!opts.loop,
      volume: opts.volume != null ? opts.volume : 1,
      lastIdx: -1,
      current: null,
      _restore: null,
      audios: list.map((u) => {
        const a = new Audio(u);
        a.preload = "auto";
        a.loop = !!opts.loop;
        return a;
      }),
    };
  }

  function pickIndex(r) {
    if (r.audios.length === 1) return 0;
    let i;
    do { i = Math.floor(Math.random() * r.audios.length); } while (i === r.lastIdx);
    r.lastIdx = i;
    return i;
  }

  function fadeTo(a, target, ms, done) {
    const start = a.volume;
    const steps = Math.max(1, Math.round(ms / 40));
    let n = 0;
    clearInterval(a._fade);
    a._fade = setInterval(() => {
      n++;
      a.volume = Math.max(0, Math.min(1, start + (target - start) * (n / steps)));
      if (n >= steps) { clearInterval(a._fade); if (done) done(); }
    }, 40);
  }

  // Lower the ambience briefly so a sound effect stands out, then bring it back.
  function duckAmbience() {
    const amb = reg["ambiance"];
    if (!amb || !amb.current || amb.current.paused) return;
    const a = amb.current;
    fadeTo(a, amb.volume * 0.25, 200);
    clearTimeout(amb._restore);
    amb._restore = setTimeout(() => fadeTo(a, amb.volume, 700), 1500);
  }

  function play(key) {
    const r = reg[key];
    if (!r) return;
    const run = () => {
      if (r.loop) {
        // Never stack two ambience tracks: stop the others first.
        r.audios.forEach((a) => { try { a.pause(); } catch (e) {} });
      }
      const a = r.audios[pickIndex(r)];
      r.current = a;
      try {
        a.currentTime = 0;
        if (r.loop) { a.volume = 0; a.play().catch(() => {}); fadeTo(a, r.volume, 900); }
        else { a.volume = r.volume; a.play().catch(() => {}); duckAmbience(); }
      } catch (e) {}
    };
    unlocked ? run() : pending.push(run);
  }

  function stop(key) {
    const r = reg[key];
    if (!r) return;
    r.audios.forEach((a) => { try { a.pause(); a.currentTime = 0; } catch (e) {} });
  }

  // Smoothly fade a (looping) sound out, then stop it.
  function fadeOut(key, ms) {
    const r = reg[key];
    if (!r || !r.current) return;
    const a = r.current;
    fadeTo(a, 0, ms || 600, () => { try { a.pause(); a.currentTime = 0; } catch (e) {} });
  }

  return { register, play, stop, fadeOut };
})();
