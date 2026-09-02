// meta.js -- Registry entry for this game (read by the engine's games loader).
// A game folder WITHOUT a server.js is a "coming soon" placeholder: it shows on
// the home grid but can't be started yet.
module.exports = {
  id: "quiz-party",
  order: 1,
  name: "Quiz Party",
  tagline: "Le quiz survolte a plusieurs",
  emoji: "🧠",
  theme: { primary: "#7c3aed", secondary: "#ec4899", background: "#1e1b4b", text: "#f5f3ff" },
  cheats: [
    { id: "reveal", label: "Reveler la reponse", emoji: "👁️" },
    { id: "double", label: "Double points", emoji: "✖️" },
    { id: "trap", label: "Question piege", emoji: "🪤" },
  ],
};
