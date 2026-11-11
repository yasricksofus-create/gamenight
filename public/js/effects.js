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

// Player list of the lobby (host screen and phones), with pixel-art avatars.
// opts.host = true on the host screen: each line gets "remove" (✕) and, for a
// connected human, "give the screen" (👑) buttons, handled by opts.onKick /
// opts.onTransfer. A ✓ marks the players who pressed "Prêt".
function renderPlayerList(players, opts) {
  opts = opts || {};
  const list = document.getElementById("player-list");
  const count = document.getElementById("player-count");
  const playing = players.filter((p) => !p.spectator);
  if (count) count.textContent = playing.length;
  if (!list) return;
  if (!players.length) { list.innerHTML = '<li class="empty">En attente de joueurs…</li>'; return; }
  list.innerHTML = "";
  players.forEach((p) => {
    const li = document.createElement("li");
    li.className = "player-li" + (p.connected === false ? " empty" : "") + (p.ready ? " ready" : "");
    if (window.PixelAvatar && p.avatar) {
      const img = document.createElement("img");
      img.className = "px-av"; img.width = img.height = 32; img.alt = "";
      img.src = PixelAvatar.url(p.avatar);
      li.appendChild(img);
    }
    const label = document.createElement("span");
    label.className = "pl-name";
    label.textContent = p.name + (p.isBot ? " (bot)" : "") + (p.spectator ? " (regarde)" : "") + (p.connected === false ? " (déconnecté…)" : "");
    li.appendChild(label);
    if (p.ready) { const r = document.createElement("span"); r.className = "pl-ready"; r.textContent = "✓ prêt"; li.appendChild(r); }
    if (opts.host) {
      const tools = document.createElement("span");
      tools.className = "pl-tools";
      if (!p.isBot && p.connected !== false && opts.onTransfer) {
        const t = document.createElement("button");
        t.type = "button"; t.className = "pl-btn"; t.textContent = "👑";
        t.title = "Donner l'écran host à " + p.name; t.setAttribute("aria-label", t.title);
        t.onclick = () => opts.onTransfer(p);
        tools.appendChild(t);
      }
      if (opts.onKick) {
        const k = document.createElement("button");
        k.type = "button"; k.className = "pl-btn"; k.textContent = "✕";
        k.title = (p.isBot ? "Retirer " : "Exclure ") + p.name; k.setAttribute("aria-label", k.title);
        k.onclick = () => opts.onKick(p, k);
        tools.appendChild(k);
      }
      li.appendChild(tools);
    }
    list.appendChild(li);
  });
}
