// games.js -- The game registry.
//
// This is the ONLY file to touch when adding a new game (for now).
// The engine (server.js) never hard-codes any game: it just reads this list.
//
// Each game carries its "DA" (direction artistique) = the visual theme applied
// to the room: colors, emoji, tagline. There is NO gameplay logic here yet.
// Later, each game's rules will live in its own separate module, so that adding
// a game keeps the engine untouched. That is the "generic platform" promise.

const games = [
  {
    id: "quiz-party",
    name: "Quiz Party",
    tagline: "Le quiz survolte a plusieurs",
    emoji: "🧠", // brain
    theme: {
      primary: "#7c3aed",
      secondary: "#ec4899",
      background: "#1e1b4b",
      text: "#f5f3ff",
    },
  },
  {
    id: "draw-guess",
    name: "Dessine & Devine",
    tagline: "Dessine, ils devinent (ou pas)",
    emoji: "🎨", // palette
    theme: {
      primary: "#0d9488",
      secondary: "#84cc16",
      background: "#042f2e",
      text: "#ecfeff",
    },
  },
  {
    id: "bluff-master",
    name: "Bluff Master",
    tagline: "Mens avec panache",
    emoji: "🎭", // masks
    theme: {
      primary: "#dc2626",
      secondary: "#f59e0b",
      background: "#450a0a",
      text: "#fff7ed",
    },
  },
  {
    id: "word-storm",
    name: "Tempete de Mots",
    tagline: "Les mots fusent, sois le plus rapide",
    emoji: "⚡", // zap
    theme: {
      primary: "#2563eb",
      secondary: "#06b6d4",
      background: "#0c1a3d",
      text: "#eff6ff",
    },
  },
];

// Small helper used by the engine and the API to look up one game by its id.
function getGameById(id) {
  return games.find((game) => game.id === id) || null;
}

module.exports = { games, getGameById };
