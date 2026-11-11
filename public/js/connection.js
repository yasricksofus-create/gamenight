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
      if (document.visibilityState !== "visible" || window.gnReplaced) return;
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
      b.textContent = "🔧 " + (message || "Le site redémarre pour une mise à jour.");
    });

    // 3. Same seat / host screen opened in ANOTHER tab or window: that tab takes
    //    over. This one stops (otherwise both would fight for the place) and
    //    offers to take it back.
    s.on("session:replaced", () => {
      window.gnReplaced = true;
      s.disconnect();
      let o = document.getElementById("gn-replaced");
      if (!o) {
        o = document.createElement("div");
        o.id = "gn-replaced";
        o.setAttribute("role", "alertdialog");
        o.style.cssText = "position:fixed;inset:0;z-index:210;display:flex;align-items:center;justify-content:center;padding:20px;" +
          "background:rgba(8,4,16,.88);color:#fff;font:16px/1.5 system-ui,sans-serif;text-align:center";
        o.innerHTML = '<div style="max-width:420px"><p style="font-size:1.2rem;font-weight:700;margin:0 0 8px">Ouvert dans un autre onglet</p>' +
          '<p style="margin:0 0 16px;opacity:.85">Ta place est maintenant utilisée par une autre fenêtre (ou un autre onglet). Celle-ci est en pause.</p>' +
          '<button id="gn-take-back" style="font:inherit;font-weight:700;padding:10px 18px;border-radius:10px;border:none;cursor:pointer;background:#ffd54a;color:#1a1030">Reprendre ici</button></div>';
        document.body.appendChild(o);
        o.querySelector("#gn-take-back").onclick = () => { window.gnReplaced = false; o.remove(); s.connect(); };
      }
    });
  }
  start();
})();
