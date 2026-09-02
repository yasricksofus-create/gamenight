// meta.js -- Registry entry for Undercover. Its logic is in server.js (same
// folder), its client in client/, its word/character data in data.js.
module.exports = {
  id: "undercover",
  order: 5,
  name: "Undercover",
  tagline: "Demasque l'imposteur... ou fais-toi passer pour un civil",
  emoji: "🕵️",
  theme: { primary: "#B4872E", secondary: "#9E2B1E", background: "#12100D", text: "#F1E6C9" },
  cheats: [
    { id: "reveal-role", label: "Reveler les roles", emoji: "👁️" },
    { id: "redeal", label: "Relancer la distribution", emoji: "🔄" },
    { id: "cancel-elim", label: "Annuler l'elimination", emoji: "↩️" },
    { id: "revote", label: "Relancer le vote", emoji: "🗳️" },
  ],
};
