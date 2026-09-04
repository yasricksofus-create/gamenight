// fps-meter.js -- Optional on-screen FPS counter, for diagnosing "it lags".
//
// OFF by default. Turn it on by adding ?fps=1 to any page URL, e.g.
//   .../index.html?fps=1   .../host.html?game=cascade&fps=1
// (or press the "F" key while ?fps is present to hide/show it).
//
// It measures REAL painted frames per second via requestAnimationFrame: a smooth
// page shows ~60; if the number drops well below 60 while something is happening,
// that's genuine jank. On a totally static page the browser may still report ~60
// here because rAF is tied to the display refresh -- that's normal, not a problem.
(function () {
  if (!new URLSearchParams(location.search).has("fps")) return; // opt-in only

  const box = document.createElement("div");
  box.id = "gn-fps";
  box.style.cssText =
    "position:fixed;top:8px;left:8px;z-index:99999;font:700 13px/1.3 system-ui,sans-serif;" +
    "background:rgba(0,0,0,.72);color:#7CFC7C;padding:6px 10px;border-radius:8px;" +
    "pointer-events:none;white-space:pre;border:1px solid rgba(255,255,255,.15)";
  document.addEventListener("DOMContentLoaded", () => document.body.appendChild(box));
  if (document.body) document.body.appendChild(box);

  let frames = 0, last = performance.now(), fps = 0, worst = 999, since = last;
  function tick(now) {
    frames++;
    const dt = now - last;
    if (dt >= 500) {                       // update twice a second
      fps = Math.round((frames * 1000) / dt);
      if (now - since < 10000) worst = Math.min(worst, fps); // worst of the last 10s
      else { worst = fps; since = now; }
      frames = 0; last = now;
      const col = fps >= 50 ? "#7CFC7C" : fps >= 30 ? "#F0E246" : "#F06666";
      box.style.color = col;
      box.textContent = "FPS " + fps + "\nmin " + (worst === 999 ? "…" : worst);
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  // "F" hides/shows the meter.
  window.addEventListener("keydown", (e) => {
    if (e.key === "f" || e.key === "F") box.style.display = box.style.display === "none" ? "" : "none";
  });
})();
