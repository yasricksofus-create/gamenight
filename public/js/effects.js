// effects.js -- Generic on-screen feedback when a cheat is triggered.
//
// Shared by the host and player pages. For now every cheat shows the same kind
// of banner ("The host activated: <label>"). This is deliberately generic: it
// proves the host -> server -> everyone relay works. Later, each game will give
// its cheats real effects; this banner stays as a nice default notification.
function showCheatEffect(cheat) {
  // Create the banner once, then reuse it.
  let banner = document.getElementById("cheat-banner");
  if (!banner) {
    banner = document.createElement("div");
    banner.id = "cheat-banner";
    banner.className = "cheat-banner";
    document.body.appendChild(banner);
  }

  banner.innerHTML =
    `<span class="cheat-banner-emoji">${cheat.emoji || "✨"}</span>` +
    `<span>L'host a active : <strong>${cheat.label}</strong></span>`;

  // Restart the show animation even if a cheat is fired twice in a row.
  banner.classList.remove("show");
  void banner.offsetWidth; // force the browser to notice the reset
  banner.classList.add("show");

  clearTimeout(banner._hideTimer);
  banner._hideTimer = setTimeout(() => banner.classList.remove("show"), 3000);
}
