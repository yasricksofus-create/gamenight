// feedback.js -- In-game "Feedback" button (host + players).
//
// Shows a floating "💬 Feedback" button ONLY while a game is running (i.e. while
// #game-root is visible). Clicking it opens a little box; the text is sent to the
// server, which forwards it to the shared Discord channel (see server.js).
(function () {
  function init() {
    if (!window.socket) return setTimeout(init, 300); // wait until the socket exists
    const socket = window.socket;

    const st = document.createElement("style");
    st.textContent = `
      .gn-fb-btn{position:fixed;top:10px;right:14px;z-index:60;font:700 14px system-ui,sans-serif;
        cursor:pointer;color:#fff;border:none;border-radius:999px;padding:8px 15px;
        background:linear-gradient(135deg,var(--primary,#6366f1),var(--secondary,#a855f7));
        box-shadow:0 4px 12px rgba(0,0,0,.35);}
      .gn-fb-btn:active{transform:translateY(1px);}
      .gn-fb-ov{position:fixed;inset:0;background:rgba(0,0,0,.55);display:none;z-index:100;
        align-items:center;justify-content:center;padding:16px;}
      .gn-fb-ov.show{display:flex;}
      .gn-fb-card{background:#141a2e;color:#eaf0ff;border:1px solid rgba(255,255,255,.15);
        border-radius:16px;padding:20px;max-width:440px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,.5);}
      .gn-fb-card h3{margin:0 0 4px;font-size:1.25rem;}
      .gn-fb-sub{opacity:.75;font-size:.86rem;margin:0 0 10px;}
      #gn-fb-text{width:100%;min-height:110px;border-radius:10px;border:1px solid rgba(255,255,255,.2);
        background:rgba(255,255,255,.06);color:inherit;padding:10px;font:inherit;resize:vertical;}
      .gn-fb-row{display:flex;gap:10px;justify-content:flex-end;margin-top:12px;}
      .gn-fb-row button{font:700 14px system-ui,sans-serif;cursor:pointer;border:none;border-radius:10px;padding:9px 16px;}
      .gn-fb-cancel{background:rgba(255,255,255,.12);color:#eaf0ff;}
      .gn-fb-send{background:linear-gradient(135deg,#4C46F0,#9B5DE5);color:#fff;}
      .gn-fb-send:disabled{opacity:.5;cursor:default;}
      .gn-fb-ok{color:#7CFC7C;margin:10px 0 0;text-align:center;font-weight:700;}`;
    document.head.appendChild(st);

    const btn = document.createElement("button");
    btn.className = "gn-fb-btn"; btn.type = "button";
    btn.textContent = "💬 Feedback"; btn.hidden = true;
    document.body.appendChild(btn);

    const ov = document.createElement("div");
    ov.className = "gn-fb-ov";
    ov.innerHTML = `<div class="gn-fb-card">
      <h3>Ton retour</h3>
      <p class="gn-fb-sub">Un bug, une idee, une remarque ? Ecris-la, on la recoit direct.</p>
      <textarea id="gn-fb-text" maxlength="1000" placeholder="Ton message…"></textarea>
      <div class="gn-fb-row">
        <button type="button" class="gn-fb-cancel">Annuler</button>
        <button type="button" class="gn-fb-send">Envoyer</button>
      </div>
      <p class="gn-fb-ok" hidden>Merci ! Retour envoye ✅</p>
    </div>`;
    document.body.appendChild(ov);

    const ta = ov.querySelector("#gn-fb-text");
    const ok = ov.querySelector(".gn-fb-ok");
    const sendBtn = ov.querySelector(".gn-fb-send");
    const open = () => { ov.classList.add("show"); ta.value = ""; ok.hidden = true; sendBtn.disabled = false; setTimeout(() => ta.focus(), 50); };
    const close = () => ov.classList.remove("show");
    btn.onclick = open;
    ov.querySelector(".gn-fb-cancel").onclick = close;
    ov.addEventListener("click", (e) => { if (e.target === ov) close(); });
    sendBtn.onclick = () => {
      const t = ta.value.trim();
      if (!t) return;
      socket.emit("feedback", { text: t });
      ok.hidden = false; sendBtn.disabled = true;
      setTimeout(close, 1000);
    };

    // Show the button only while a game is on screen (#game-root visible).
    const gr = document.getElementById("game-root");
    const sync = () => { btn.hidden = !gr || gr.classList.contains("hidden"); if (btn.hidden) close(); };
    if (gr) new MutationObserver(sync).observe(gr, { attributes: true, attributeFilter: ["class"] });
    sync();
  }
  init();
})();
