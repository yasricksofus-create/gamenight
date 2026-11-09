// connection.js -- Generic connection helpers for every page (engine side).
//
// 1. Phone wakes up: when a phone comes back from sleep or the tab comes back to
//    the front, the connection may be dead without the page knowing yet. We
//    reconnect RIGHT AWAY instead of waiting for the automatic detection
//    (which can take ~20 s), so the player is back in the room instantly.
// 2. Server restarting: when the site is being updated, the server warns
//    everyone; we show a clear banner instead of a frozen game.
(function () {
  function start() {
    const s = window.socket;
    if (!s) return setTimeout(start, 200);

    function wake() {
      if (document.visibilityState !== "visible") return;
      if (!s.connected) s.connect();
    }
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("online", wake);
    window.addEventListener("pageshow", wake);

    s.on("server:restarting", ({ message } = {}) => {
      let b = document.getElementById("gn-restart");
      if (!b) {
        b = document.createElement("div");
        b.id = "gn-restart";
        b.setAttribute("role", "alert");
        b.style.cssText = "position:fixed;left:0;right:0;top:0;z-index:200;padding:14px 18px;text-align:center;" +
          "font:600 15px system-ui,sans-serif;background:#ffd54a;color:#1a1030;box-shadow:0 4px 20px rgba(0,0,0,.4)";
        document.body.appendChild(b);
      }
      b.textContent = "🔧 " + (message || "Le site redemarre pour une mise a jour.");
    });
  }
  start();
})();
