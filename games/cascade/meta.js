// meta.js -- Registry entry for "Cascade" (original shedding card game).
// Logic in server.js (same folder), client in client/.
module.exports = {
  id: "cascade",
  order: 6,
  name: "Cascade",
  tagline: "Vide ta main avant les autres !",
  emoji: "🎴",
  theme: { primary: "#4C46F0", secondary: "#F04646", background: "#0b132b", text: "#eaf0ff" },
  cheats: [
    { id: "reveal-hands", label: "Voir les mains", emoji: "👁️" },
    { id: "skip-turn", label: "Sauter le tour actuel", emoji: "⏭️" },
    { id: "redeal", label: "Redistribuer", emoji: "🔄" },
  ],
};
