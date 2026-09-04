// sound.js -- Generic sound manager, shared by all games.
//
// Each game passes its OWN sounds folder via opts.dir (so two games never share
// the same music). Undercover uses /sounds/ ; Cascade uses /games/cascade/sounds/.
//
// Two kinds of sounds:
//   MUSIC (reglages, ambiance, vote, victoire): only one plays at a time.
//     Switching does a CROSS-FADE (old fades down while new fades up).
//   SFX (distribution, elimination-*, mrwhite): plays OVER the music. The music
//     ducks from its level down to 20% (=10% when master is 50%) over 2s, the
//     effect plays, then the music climbs back over 2s.
//
// A MASTER volume (0..1, default 50%) multiplies every sound and is controlled
// by the host's volume bar (saved in the browser). Several files can be given
// for one key: a random variant (never the same twice) is chosen each time.
// Audio is unlocked on the first user interaction; missing files stay silent.
window.Sound = (function () {
  const MUSIC_FADE = 400;    // cross-fade duration (ms) -- short, minimal overlap
  const DUCK_MS = 2000;      // music down / up duration around an effect (ms)
  const DUCK_RATIO = 0.2;    // music drops to 20% of its level (50% -> 10%)

  const reg = {};            // key -> track record
  let currentMusic = null;   // key of the music currently playing
  const musicKeys = new Set(); // every key ever used as MUSIC (to hand off cleanly)
  let unlocked = false;
  const pending = [];

  // ----- master volume -----
  let master = 0.5;
  try {
    const v = parseFloat(localStorage.getItem("gn_volume"));
    if (!isNaN(v)) master = clamp(v);
  } catch (e) {}
  function clamp(v) { return Math.max(0, Math.min(1, v)); }
  function getMaster() { return master; }
  function setMaster(v) {
    master = clamp(v);
    try { localStorage.setItem("gn_volume", String(master)); } catch (e) {}
    // Update anything currently playing so the change is heard immediately.
    Object.values(reg).forEach((r) => {
      const a = r.current;
      if (a && !a.paused) { clearInterval(a._fade); a.volume = level(r); }
    });
  }
  function level(r) { return r.volume * master; } // effective volume of a track

  // ----- unlock on first interaction -----
  function unlock() {
    if (unlocked) return;
    unlocked = true;
    pending.splice(0).forEach((fn) => fn());
  }
  ["click", "touchstart", "keydown"].forEach((e) =>
    window.addEventListener(e, unlock, { passive: true }));

  // ----- registration -----
  function register(key, urls, opts) {
    opts = opts || {};
    const list = Array.isArray(urls) ? urls : [urls];
    reg[key] = {
      loop: !!opts.loop,
      volume: opts.volume != null ? opts.volume : 1,
      lastIdx: -1,
      current: null,
      audios: list.map((u) => {
        const a = new Audio(u);
        a.preload = "auto";
        a.loop = !!opts.loop;
        return a;
      }),
    };
  }

  // Register a key from a base filename AND auto-discover its variants: it uses
  // /sounds/<base>.mp3 right away, then probes /sounds/<base>2.mp3 .. <base>8.mp3
  // and adds the ones that exist. So dropping ambiance3.mp3, vote3.mp3, etc. in
  // the sounds folder is enough -- NO code change needed to add sounds.
  function registerAuto(key, base, opts) {
    opts = opts || {};
    const dir = opts.dir || "/sounds/"; // each game can point at its OWN folder
    const baseUrl = dir + base + ".mp3";
    const found = [baseUrl];
    register(key, found, opts); // available immediately with the base file
    // Discover variants (<base>2..8.mp3) ONLY if the base file exists. This
    // avoids a burst of 404 HEAD requests on every load for games that have no
    // sound files yet (7 probes/key -> 1).
    fetch(baseUrl, { method: "HEAD" }).then((r) => {
      if (!r.ok) return;
      const probes = [];
      for (let i = 2; i <= 8; i++) probes.push(dir + base + i + ".mp3");
      return Promise.all(
        probes.map((u) => fetch(u, { method: "HEAD" }).then((x) => (x.ok ? u : null)).catch(() => null))
      ).then((results) => {
        results.forEach((u) => { if (u) found.push(u); });
        if (found.length > 1) register(key, found, opts); // re-register with variants
      });
    }).catch(() => {});
  }

  function pickIndex(r) {
    if (r.audios.length === 1) return 0;
    let i;
    do { i = Math.floor(Math.random() * r.audios.length); } while (i === r.lastIdx);
    r.lastIdx = i;
    return i;
  }

  // Ramp an audio element's volume to a target over ms, then run done().
  function fadeTo(a, target, ms, done) {
    if (!a) { if (done) done(); return; }
    clearInterval(a._fade);
    const start = a.volume;
    const steps = Math.max(1, Math.round(ms / 40));
    let n = 0;
    a._fade = setInterval(() => {
      n++;
      a.volume = clamp(start + (target - start) * (n / steps));
      if (n >= steps) { clearInterval(a._fade); if (done) done(); }
    }, 40);
  }
  function fadeOutAudio(a, ms) {
    if (!a) return;
    fadeTo(a, 0, ms, () => { try { a.pause(); a.currentTime = 0; } catch (e) {} });
  }

  // ----- MUSIC: exclusive, cross-faded -----
  function music(key) {
    const r = reg[key];
    if (!r) return;
    const run = () => {
      if (currentMusic === key && r.current && !r.current.paused) return; // already on
      musicKeys.add(key);
      // Fade out EVERY other music track that is still playing -- not just the
      // "current" one -- so nothing (e.g. reglages) can linger under the game.
      musicKeys.forEach((mk) => {
        if (mk === key) return;
        const o = reg[mk];
        if (o && o.current) fadeOutAudio(o.current, MUSIC_FADE);
      });
      currentMusic = key;
      r.audios.forEach((a) => { try { a.pause(); } catch (e) {} });
      const a = r.audios[pickIndex(r)];
      r.current = a;
      try {
        a.currentTime = 0;
        a.volume = 0;
        a.play().catch(() => {});
        fadeTo(a, level(r), MUSIC_FADE);
      } catch (e) {}
    };
    unlocked ? run() : pending.push(run);
  }

  // ----- SFX: plays over the music, which ducks 2s down / 2s up -----
  function sfx(key) {
    const r = reg[key];
    if (!r) return;
    const run = () => {
      const m = currentMusic ? reg[currentMusic] : null;
      const ma = m && m.current && !m.current.paused ? m.current : null;
      const a = r.audios[pickIndex(r)];
      r.current = a;

      const playEffect = () => {
        try { a.currentTime = 0; a.volume = level(r); a.play().catch(() => {}); } catch (e) {}
        const bringBack = () => { if (ma && !ma.paused) fadeTo(ma, level(m), DUCK_MS); };
        a.onended = bringBack;                       // ramp music back up when done
        clearTimeout(a._upT);
        a._upT = setTimeout(bringBack, 8000);        // safety net if 'ended' never fires
      };

      if (ma) fadeTo(ma, level(m) * DUCK_RATIO, DUCK_MS, playEffect); // 2s down, THEN effect
      else playEffect();
    };
    unlocked ? run() : pending.push(run);
  }

  function stop(key) {
    const r = reg[key];
    if (!r) return;
    if (currentMusic === key) currentMusic = null;
    r.audios.forEach((a) => { try { clearInterval(a._fade); a.pause(); a.currentTime = 0; } catch (e) {} });
  }

  return { register, registerAuto, music, sfx, stop, setMaster, getMaster };
})();
