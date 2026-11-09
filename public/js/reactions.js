// reactions.js -- Generic live emoji reactions (engine side, opt-in per game).
//
// A game enables them with `reactions: true` in its meta.js. Then, during the
// game (while #game-root is visible):
//   - on PHONES: a small bar of emojis at the bottom; tap = send a reaction,
//   - on the HOST screen: received emojis float up from the bottom with the name.
// Both host.js and player.js call Reactions.enable(game, role) once they know
// the game. Nothing here knows any game rule.
window.Reactions = (function () {
  const EMOJIS = ["🔥", "😂", "😍", "🤯", "💀", "🤮", "👏", "🥱"]; // = server list
  let enabled = false, role = null, bar = null, styled = false;

  function style() {
    if (styled) return; styled = true;
    const st = document.createElement("style");
    st.textContent = `
      .gn-rx-bar{position:fixed;left:50%;bottom:10px;transform:translateX(-50%);z-index:55;display:flex;gap:4px;
        background:rgba(0,0,0,.55);border:1px solid rgba(255,255,255,.18);border-radius:999px;padding:4px 8px;
        backdrop-filter:blur(6px);max-width:calc(100vw - 24px);}
      .gn-rx-bar button{border:none;background:transparent;font-size:22px;line-height:1;padding:6px 5px;cursor:pointer;border-radius:50%;}
      .gn-rx-bar button:active{transform:scale(1.3);}
      .gn-rx-fly{position:fixed;bottom:-60px;z-index:58;pointer-events:none;display:flex;flex-direction:column;align-items:center;
        animation:gn-rx-up 3.2s ease-out forwards;}
      .gn-rx-fly .e{font-size:54px;filter:drop-shadow(0 4px 10px rgba(0,0,0,.5));}
      .gn-rx-fly .n{font:700 13px system-ui,sans-serif;color:#fff;background:rgba(0,0,0,.55);border-radius:999px;padding:2px 8px;}
      @keyframes gn-rx-up{0%{transform:translateY(0) scale(.6);opacity:0}10%{opacity:1}
        100%{transform:translateY(-75vh) scale(1.1);opacity:0}}
      .gn-rx-mini{position:fixed;bottom:64px;z-index:58;pointer-events:none;font-size:30px;animation:gn-rx-up 2.2s ease-out forwards;}
      @media (prefers-reduced-motion: reduce){.gn-rx-fly,.gn-rx-mini{animation-duration:1.2s}}`;
    document.head.appendChild(st);
  }

  function gameVisible() {
    const r = document.getElementById("game-root");
    return r && !r.classList.contains("hidden");
  }

  function buildBar() {
    bar = document.createElement("div");
    bar.className = "gn-rx-bar"; bar.hidden = true;
    bar.innerHTML = EMOJIS.map((e) => `<button type="button" data-emoji="${e}" aria-label="Réagir ${e}">${e}</button>`).join("");
    // the emoji is read from data-emoji (the visible one is replaced by pixel art)
    bar.querySelectorAll("button").forEach((b) => (b.onclick = () => window.socket.emit("room:react", { emoji: b.getAttribute("data-emoji") })));
    document.body.appendChild(bar);
    setInterval(() => { bar.hidden = !gameVisible(); }, 500);
  }

  function onReaction({ emoji, name }) {
    if (!enabled) return;
    // at most 20 flying emojis at once: a spam wave can't slow the screen down
    if (document.querySelectorAll(".gn-rx-fly,.gn-rx-mini").length >= 20) return;
    if (role === "host") {
      const el = document.createElement("div");
      el.className = "gn-rx-fly";
      el.style.left = (8 + Math.random() * 84) + "vw";
      el.innerHTML = `<span class="e">${emoji}</span><span class="n"></span>`;
      el.querySelector(".n").textContent = name;
      document.body.appendChild(el);
      setTimeout(() => el.remove(), 3300);
    } else {
      // phones: a small echo so you see the room reacting too
      const el = document.createElement("div");
      el.className = "gn-rx-mini";
      el.style.left = (10 + Math.random() * 80) + "vw";
      el.textContent = emoji;
      document.body.appendChild(el);
      setTimeout(() => el.remove(), 2300);
    }
  }

  function enable(game, r) {
    if (!game || !game.reactions || enabled || !window.socket) return;
    enabled = true; role = r; style();
    window.socket.on("room:reaction", onReaction);
    if (role === "player") buildBar();
  }

  return { enable, EMOJIS };
})();
