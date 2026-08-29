// volume-control.js -- Small master-volume slider, fixed at the bottom-right of
// the host screen. Lets the host raise/lower ALL sounds live. Value is kept in
// the browser (localStorage) so it sticks between sessions.
(function () {
  if (!window.Sound) return;

  const wrap = document.createElement("div");
  wrap.id = "gn-volume";
  wrap.innerHTML =
    '<button id="gn-vol-ico" title="Son" aria-label="Volume">🔊</button>' +
    '<input id="gn-vol-range" type="range" min="0" max="100" step="1" />';
  document.body.appendChild(wrap);

  const range = wrap.querySelector("#gn-vol-range");
  const ico = wrap.querySelector("#gn-vol-ico");
  range.value = Math.round(Sound.getMaster() * 100);

  function refreshIcon() {
    const v = Sound.getMaster();
    ico.textContent = v === 0 ? "🔇" : v < 0.5 ? "🔉" : "🔊";
  }
  refreshIcon();

  range.addEventListener("input", () => {
    Sound.setMaster(range.value / 100);
    refreshIcon();
  });
  // Click the icon to mute / unmute (remembers the previous level).
  let prev = Sound.getMaster() || 0.5;
  ico.addEventListener("click", () => {
    if (Sound.getMaster() > 0) { prev = Sound.getMaster(); Sound.setMaster(0); }
    else { Sound.setMaster(prev || 0.5); }
    range.value = Math.round(Sound.getMaster() * 100);
    refreshIcon();
  });
})();
