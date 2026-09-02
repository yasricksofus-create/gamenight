// game-loader.js -- Loads ONLY the active game's browser code, on demand.
//
// Before, host.html / player.html hard-loaded every game's scripts. Now each
// game lives in its own folder (games/<id>/client/) and we inject just the one
// that's actually being played, as soon as we know which game it is:
//   common.js  (shared helpers for that game)  THEN  host.js / player.js.
//
// Adding a game no longer means editing the HTML: the engine finds the folder,
// and this loader pulls its client code by id.
window.GameClient = (function () {
  const loaded = {}; // key "id:role" -> true once its bundle is in the page

  function inject(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error("Echec de chargement : " + src));
      document.body.appendChild(s);
    });
  }

  async function load(gameId, role) { // role: "host" | "player"
    if (!gameId || !role) return;
    const key = gameId + ":" + role;
    if (loaded[key]) return;
    loaded[key] = true;
    const base = "/games/" + encodeURIComponent(gameId) + "/client/";
    try {
      await inject(base + "common.js"); // helpers first
      await inject(base + role + ".js"); // then the host or player view
      // The bundle's listeners are attached now: ask the server to (re)send the
      // current game state, so nothing is missed if a broadcast already happened.
      if (window.socket && window.socket.connected) window.socket.emit("game:sync");
    } catch (e) {
      loaded[key] = false;
      console.error("[game-loader]", e);
    }
  }

  return { load };
})();
