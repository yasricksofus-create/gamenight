// games.js -- The game registry.
//
// This is the ONLY file to touch when adding a new game (for now).
// The engine (server.js) never hard-codes any game: it just reads this list.
//
// Each game carries:
//   - its "DA" (direction artistique) = the visual theme of the room;
//   - its "cheats" = the actions the host can trigger from the cheat console.
//
// IMPORTANT: cheats are declared HERE, per game. The console is generic and
// simply displays whatever the current game declares -- so adding a game (with
// its own cheats) makes them appear in the console automatically, WITHOUT
// touching the engine or the console. That is the "generic platform" promise.
//
// A cheat is: { id, label, emoji }.
//   id    = a short unique key used by the code (no spaces).
//   label = the text shown on the button.
//   emoji = a small icon shown on the button and in the on-screen effect.
// There is still NO gameplay logic: for now a cheat just shows a banner on every
// screen. Later, each game's rules will react to its cheats for real.

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
    cheats: [
      { id: "reveal", label: "Reveler la reponse", emoji: "👁️" },
      { id: "double", label: "Double points", emoji: "✖️" },
      { id: "trap", label: "Question piege", emoji: "🪤" },
    ],
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
    cheats: [
      { id: "hint", label: "Donner un indice", emoji: "💡" },
      { id: "clear", label: "Effacer le dessin", emoji: "🧽" },
      { id: "add-time", label: "+30 secondes", emoji: "⏱️" },
    ],
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
    cheats: [
      { id: "unmask", label: "Demasquer un menteur", emoji: "🔍" },
      { id: "swap", label: "Echanger les roles", emoji: "🔄" },
    ],
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
    cheats: [
      { id: "freeze", label: "Geler un joueur", emoji: "❄️" },
      { id: "bonus", label: "Lettre bonus", emoji: "🎁" },
    ],
  },
  {
    // First game with REAL rules. Its logic lives in game-modules/undercover.js.
    id: "undercover",
    name: "Undercover",
    tagline: "Demasque l'imposteur... ou fais-toi passer pour un civil",
    emoji: "🕵️", // detective
    theme: {
      primary: "#B4872E", // gold, from the "dossier confidentiel" look
      secondary: "#9E2B1E",
      background: "#12100D",
      text: "#F1E6C9",
    },
    cheats: [
      { id: "reveal-role", label: "Reveler les roles", emoji: "👁️" },
      { id: "redeal", label: "Relancer la distribution", emoji: "🔄" },
      { id: "cancel-elim", label: "Annuler l'elimination", emoji: "↩️" },
      { id: "revote", label: "Relancer le vote", emoji: "🗳️" },
    ],
  },
];

// Small helper used by the engine and the API to look up one game by its id.
function getGameById(id) {
  return games.find((game) => game.id === id) || null;
}

module.exports = { games, getGameById };
