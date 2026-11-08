// wakelock.js -- Generic: keeps the screen ON while a game is shown (engine side).
//
// Phones turn their screen off after ~30s without touch; that cuts the
// connection and the player drops out of the round. The browser's "Wake Lock"
// API asks the phone to stay awake. We request it while #game-root is visible,
// and ask again when the page comes back to the front (the browser releases the
// lock whenever the tab is hidden). Browsers without it simply do nothing.
(function () {
  if (!("wakeLock" in navigator)) return;
  let lock = null;

  function inGame() {
    const r = document.getElementById("game-root");
    return r && !r.classList.contains("hidden");
  }
  async function ensure() {
    if (lock || document.visibilityState !== "visible" || !inGame()) return;
    try {
      lock = await navigator.wakeLock.request("screen");
      lock.addEventListener("release", () => { lock = null; });
    } catch (e) { lock = null; } // refused (battery saver...): no problem
  }
  function release() {
    if (lock && !inGame()) { lock.release().catch(() => {}); lock = null; }
  }
  document.addEventListener("visibilitychange", ensure);
  // the game screen appears/disappears without a page change: check regularly
  setInterval(() => { ensure(); release(); }, 2000);
  // some browsers only grant it after a touch: retry on the first taps
  document.addEventListener("pointerdown", ensure, { passive: true });
})();
