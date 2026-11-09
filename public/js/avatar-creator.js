// avatar-creator.js -- GENERIC pixel-art avatar creator (engine side).
//
// Used on the home page, in the lobby and inside games. It edits ONE avatar
// (an object of parts, see pixel-avatar.js), shows a live preview, and calls
// onChange(avatar) at each change. The page decides what to do with it
// (save it on the device, send it to the server...).
//
//   AvatarCreator.mount(element, { value, onChange })   -> inline creator
//   AvatarCreator.open({ value, onSave, title })        -> pop-up window
window.AvatarCreator = (function () {
  const A = window.PixelAvatar;
  const LBL = {
    ears: { none: "Aucune", cat: "Chat", fox: "Renard", bunny: "Lapin", bear: "Ours", mouse: "Souris" },
    hair: { none: "Aucun", short: "Court", fringe: "Frange", spiky: "Pics", long: "Longs", afro: "Afro", bun: "Chignon" },
    eyes: { dot: "Points", big: "Grands", happy: "Joyeux", sleepy: "Endormi", glasses: "Lunettes", shades: "Noires", star: "Étoiles" },
    mouth: { smile: "Sourire", open: "Ouverte", cat: "Chat", tongue: "Langue", flat: "Neutre", fang: "Crocs" },
    acc: { none: "Aucun", headphones: "Casque", crown: "Couronne", cap: "Casquette", beanie: "Bonnet", bow: "Nœud", horns: "Cornes", halo: "Auréole", antenna: "Antenne", mic: "Micro" },
  };
  const PART = { ears: "Oreilles", hair: "Coiffure", eyes: "Yeux", mouth: "Bouche", acc: "Accessoire" };
  const COLS = [["face", "Visage", () => A.SKIN.concat(A.FUR)], ["hairc", "Cheveux", () => A.HAIR], ["bg", "Fond", () => A.BG],
    ["shirt", "Haut", () => A.ACC], ["accc", "Accessoire", () => A.ACC], ["inner", "Oreilles", () => ["#ff8fd0", "#f3e9ff", "#1b1030", "#ffd54a"]]];
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  let styled = false;
  function style() {
    if (styled) return; styled = true;
    const st = document.createElement("style");
    st.textContent = `
      .avc{display:flex;flex-direction:column;gap:10px;color:inherit;text-align:left}
      .avc-top{display:flex;gap:12px;align-items:center;flex-wrap:wrap}
      .avc-prev{width:88px;height:88px;border-radius:50%;image-rendering:pixelated;border:3px solid rgba(255,255,255,.85);background:#0b0618;flex:0 0 auto}
      .avc-btns{display:flex;gap:6px;flex-wrap:wrap}
      .avc button{font:inherit;font-size:.82rem;cursor:pointer;border-radius:8px;padding:6px 10px;border:2px solid rgba(255,255,255,.22);background:rgba(255,255,255,.08);color:inherit}
      .avc button.on{border-color:#ff2fb0;background:rgba(255,47,176,.25)}
      .avc .avc-main{background:linear-gradient(135deg,#22e0ff,#ff2fb0);color:#0a0414;border:none;font-weight:700}
      .avc-presets{display:flex;gap:6px;overflow-x:auto;padding-bottom:4px}
      .avc-presets button{padding:2px;border-radius:50%;line-height:0;flex:0 0 auto}
      .avc-presets img{width:40px;height:40px;border-radius:50%;image-rendering:pixelated}
      .avc-row{display:grid;grid-template-columns:88px minmax(0,1fr);gap:8px;align-items:start}
      .avc-row .l{font-size:.75rem;opacity:.75;padding-top:6px;text-transform:uppercase;letter-spacing:.06em}
      .avc-opts{display:flex;flex-wrap:wrap;gap:4px}
      .avc-opts button{padding:4px 8px;font-size:.78rem}
      .avc-cols{display:flex;flex-wrap:wrap;gap:5px;align-items:center}
      .avc-cols button{width:24px;height:24px;padding:0;border-radius:50%}
      .avc-cols button.on{border-color:#fff;box-shadow:0 0 0 2px #ff2fb0}
      .avc-cols input{width:30px;height:26px;border:none;background:none;padding:0;cursor:pointer}
      .avc-more{display:none;flex-direction:column;gap:8px}
      .avc.open .avc-more{display:flex}
      @media (max-width:420px){.avc-row{grid-template-columns:1fr}.avc-row .l{padding-top:0}}
      .avc-modal{position:fixed;inset:0;z-index:150;background:rgba(5,2,12,.8);display:flex;align-items:center;justify-content:center;padding:16px}
      .avc-box{background:#140c2a;color:#f3e9ff;border:2px solid #2c2050;border-radius:14px;padding:16px;max-width:560px;width:100%;max-height:90vh;overflow:auto;font-family:system-ui,sans-serif}
      .avc-box h3{margin:0 0 10px}
      .avc-foot{display:flex;gap:8px;justify-content:flex-end;margin-top:12px}
      .px-av{border-radius:50%;image-rendering:pixelated;vertical-align:middle;background:#0b0618}
    `;
    document.head.appendChild(st);
  }

  function mount(el, opts) {
    style();
    let av = A.clean(opts && opts.value) || A.mine();
    let blinkT = null;
    el.innerHTML = `<div class="avc">
      <div class="avc-top">
        <img class="avc-prev" alt="Ton avatar">
        <div class="avc-btns">
          <button type="button" class="avc-main" data-act="random">🎲 Au hasard</button>
          <button type="button" data-act="more">Personnaliser</button>
        </div>
      </div>
      <div class="avc-presets" aria-label="Persos tout prêts">${A.presets.map((p, i) =>
        `<button type="button" data-preset="${i}" title="${esc(p.name)}" aria-label="${esc(p.name)}"><img src="${A.url(p.parts)}" alt=""></button>`).join("")}</div>
      <div class="avc-more"></div>
    </div>`;
    const root = el.querySelector(".avc");
    const prev = el.querySelector(".avc-prev");
    const more = el.querySelector(".avc-more");

    function draw() {
      prev.src = A.url(av);
      clearInterval(blinkT);
      blinkT = setInterval(() => { // blink now and then
        if (!prev.isConnected) return clearInterval(blinkT);
        prev.src = A.url(av, { blink: true });
        setTimeout(() => { if (prev.isConnected) prev.src = A.url(av); }, 160);
      }, 3200);
    }
    function parts() {
      let h = "";
      Object.keys(LBL).forEach((k) => {
        h += `<div class="avc-row"><span class="l">${PART[k]}</span><div class="avc-opts">` +
          Object.keys(LBL[k]).map((v) => `<button type="button" data-k="${k}" data-v="${v}" class="${av[k] === v ? "on" : ""}">${LBL[k][v]}</button>`).join("") + `</div></div>`;
      });
      h += `<div class="avc-row"><span class="l">Joues</span><div class="avc-opts"><button type="button" data-cheeks class="${av.cheeks ? "on" : ""}">Joues roses</button></div></div>`;
      COLS.forEach(([k, l, list]) => {
        h += `<div class="avc-row"><span class="l">${l}</span><div class="avc-cols">` +
          list().map((c) => `<button type="button" data-ck="${k}" data-v="${c}" style="background:${c}" class="${av[k] === c ? "on" : ""}" aria-label="${l} ${c}"></button>`).join("") +
          `<input type="color" data-pick="${k}" value="${av[k]}" aria-label="${l} : couleur libre"></div></div>`;
      });
      more.innerHTML = h;
    }
    function set(next, rebuild) {
      av = A.clean(next);
      draw();
      if (rebuild !== false && root.classList.contains("open")) parts();
      if (opts && opts.onChange) opts.onChange(av);
    }
    root.addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      if (b.dataset.act === "random") return set(A.random());
      if (b.dataset.act === "more") { root.classList.toggle("open"); b.classList.toggle("on"); if (root.classList.contains("open")) parts(); return; }
      if (b.dataset.preset != null) return set(A.presets[+b.dataset.preset].parts);
      if (b.dataset.k) return set(Object.assign({}, av, { [b.dataset.k]: b.dataset.v }));
      if (b.hasAttribute("data-cheeks")) return set(Object.assign({}, av, { cheeks: !av.cheeks }));
      if (b.dataset.ck) return set(Object.assign({}, av, { [b.dataset.ck]: b.dataset.v }));
    });
    root.addEventListener("input", (e) => {
      const i = e.target.closest("[data-pick]");
      if (i) set(Object.assign({}, av, { [i.dataset.pick]: i.value }), false);
    });
    draw();
    return { get value() { return av; }, set: (v) => set(v) };
  }

  // Pop-up version: edits a copy, "Enregistrer" calls onSave(avatar).
  function open(opts) {
    style();
    opts = opts || {};
    const m = document.createElement("div");
    m.className = "avc-modal";
    m.innerHTML = `<div class="avc-box" role="dialog" aria-modal="true" aria-label="Mon avatar">
      <h3>${esc(opts.title || "Mon avatar")}</h3><div class="avc-slot"></div>
      <div class="avc-foot"><button type="button" class="avc-cancel" style="font:inherit;padding:8px 14px;border-radius:8px;border:2px solid #2c2050;background:none;color:inherit;cursor:pointer">Annuler</button>
      <button type="button" class="avc-save" style="font:inherit;font-weight:700;padding:8px 14px;border-radius:8px;border:none;background:linear-gradient(135deg,#22e0ff,#ff2fb0);color:#0a0414;cursor:pointer">Enregistrer</button></div></div>`;
    document.body.appendChild(m);
    const c = mount(m.querySelector(".avc-slot"), { value: opts.value });
    const close = () => m.remove();
    m.querySelector(".avc-cancel").onclick = close;
    m.addEventListener("click", (e) => { if (e.target === m) close(); });
    m.querySelector(".avc-save").onclick = () => { if (opts.onSave) opts.onSave(c.value); close(); };
  }

  return { mount, open };
})();
