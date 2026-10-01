// meta.js -- Registry entry for "Kietkoutsa Reborn" (a music guessing game).
// Logic in server.js (same folder), client in client/. No cards: just music.
module.exports = {
  id: "kietkoutsa",
  order: 7,
  name: "Kietkoutsa Reborn",
  tagline: "Qui ecoute ca ? Devine qui a mis le son.",
  emoji: "🎧",
  theme: { primary: "#8B2FE0", secondary: "#E92EC0", background: "#120a24", text: "#f3e9ff" },
  cheats: [
    { id: "reveal-owner", label: "Reveler qui a mis", emoji: "👁️" },
    { id: "skip-track", label: "Passer ce morceau", emoji: "⏭️" },
    { id: "add-time", label: "+15 secondes", emoji: "⏱️" },
  ],
};
