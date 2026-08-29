// home.js -- Homepage logic: show the games grid and handle "join a room".

// 1) Load the list of games from the server and build the grid of cards.
async function loadGames() {
  const grid = document.getElementById("game-grid");
  try {
    const res = await fetch("/api/games");
    const games = await res.json();
    grid.innerHTML = "";
    games.forEach((game) => {
      const card = document.createElement("button");
      card.className = "game-card";
      // Each card uses the game's own art direction (its two theme colors).
      card.style.background =
        `linear-gradient(135deg, ${game.theme.primary}, ${game.theme.secondary})`;
      card.innerHTML =
        `<span class="game-emoji">${game.emoji}</span>` +
        `<span class="game-name">${game.name}</span>` +
        `<span class="game-tagline">${game.tagline}</span>`;
      // Clicking a game = become the host of a NEW room for that game.
      card.addEventListener("click", () => {
        window.location.href = `/host.html?game=${encodeURIComponent(game.id)}`;
      });
      grid.appendChild(card);
    });
  } catch (err) {
    grid.textContent = "Impossible de charger les jeux. Le serveur est-il lance ?";
  }
}

// 2) Handle the join form (a player entering a room code + a name).
const joinForm = document.getElementById("join-form");
joinForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const code = document.getElementById("join-code").value.toUpperCase().trim();
  const name = document.getElementById("join-name").value.trim();
  const hint = document.getElementById("join-hint");

  if (code.length !== 4) {
    hint.textContent = "Le code fait 4 lettres.";
    return;
  }
  if (!name) {
    hint.textContent = "Choisis un pseudo.";
    return;
  }
  // Go to the player page, which will actually connect to the room.
  window.location.href =
    `/player.html?room=${encodeURIComponent(code)}&name=${encodeURIComponent(name)}`;
});

loadGames();
