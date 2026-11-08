// data.js -- Static content for "Kietkoutsa Reborn" (no logic here).
// Add a line to any list to enrich the game: nothing else to change.

// Game modes (id -> label + one-line rule shown in the settings).
const MODES = {
  classic:   { label: "Classique",    emoji: "🎧", rule: "Chacun met ses sons, on devine qui a mis quoi." },
  usurp:     { label: "Usurpation",   emoji: "🎭", rule: "Tu recois un joueur a imiter : mets un son qu'IL aurait mis. +1 par vote qui tombe sur lui." },
  truebluff: { label: "Vrai ou Bluff", emoji: "🃏", rule: "2 sons chacun : un vrai coup de coeur, un piege. On devine aussi sincere ou bluff." },
  mashup:    { label: "Mashup",       emoji: "🔀", rule: "Deux extraits de deux joueurs differents a la suite : trouve les deux." },
};

// Themes drawn at random when "Theme impose" is on.
const THEMES = [
  "Le son de ton enfance",
  "Ton plaisir coupable",
  "Le son que tu chantes sous la douche",
  "Ce que tu ecoutes en cachette",
  "Le son de ton premier crush",
  "Le son parfait pour un road trip",
  "Le son qui te donne envie de danser",
  "Le son de ta pire soiree",
  "Le son qui te met en mode sport",
  "Le son de ton ete preferé",
  "Un son que tes parents ecoutaient",
  "Le son qui te rend nostalgique",
  "Un generique (anime, serie, dessin anime)",
  "Un son de jeu video",
  "Un son qui te fait pleurer (ou presque)",
  "Le son de ta playlist « focus »",
  "Un son que personne ici ne connait",
  "Le son qui te represente le mieux",
  "Un son pour ouvrir un concert",
  "Le son qui t'enerve mais que tu kiffes",
  "Un son en langue etrangere",
  "Le son de ton annee de 3e",
  "Le son de mariage ultime",
  "Un son pour une scene de film d'action",
  "Le son que tu mets pour impressionner",
  "Un son reunionnais / de chez toi",
  "Un son des annees 2000",
  "Un son pour s'endormir",
  "Le son qui passe en boucle chez toi en ce moment",
  "Un son de TikTok",
];

// What bots search for (they pick a real track like a player would).
const BOT_QUERIES = ["lofi", "rock", "pop", "jazz", "electro", "rap", "classique", "metal", "reggae", "funk", "kpop", "zouk", "maloya", "disco"];

// Secret messages bots attach to their songs.
const BOT_NOTES = [
  "Je l'ecoute en boucle depuis 3 semaines.",
  "Mon voisin deteste ce son.",
  "Souvenir de colo.",
  "Choisi au hasard, ne me jugez pas.",
  "Ca me met de bonne humeur.",
  "",
];

// End-of-game badges: id -> label + description (computed in server.js).
const BADGES = {
  chameleon: { emoji: "🦎", label: "Le Cameleon", desc: "a le plus trompe tout le monde" },
  profiler:  { emoji: "🕵️", label: "Le Profiler", desc: "a demasque le plus de monde" },
  readable:  { emoji: "📖", label: "Le Previsible", desc: "s'est fait trouver le plus souvent" },
  sheep:     { emoji: "🐑", label: "Le Mouton", desc: "vote toujours comme la majorite" },
  flash:     { emoji: "⚡", label: "L'Eclair", desc: "le plus de bonnes reponses rapides" },
  kamikaze:  { emoji: "💣", label: "Le Kamikaze", desc: "a perdu le plus de jetons en pariant" },
  blindtest: { emoji: "🎯", label: "L'Oreille d'or", desc: "a trouve le plus de titres / artistes" },
  dj:        { emoji: "💿", label: "Le DJ de la soiree", desc: "ses sons ont recu le plus de 👍" },
};

// Avatars offered to players (they can pick their own in the settings).
const AV_COLORS = ["#F04646", "#F0A020", "#F0E246", "#5DF046", "#2ED0C0",
  "#4C46F0", "#9B5DE5", "#F15BB5", "#00BBF9", "#FF7B54", "#8AC926", "#E86AF0"];
const AV_EMOJIS = ["🦊", "🐼", "🐧", "🐸", "🐙", "🦄", "🐯", "🐨", "🦁", "🐵",
  "🐰", "🐳", "🦉", "🐝", "🦖", "🐢", "👽", "🤖", "👻", "🎃", "🐲", "🦩"];

module.exports = { MODES, THEMES, BOT_QUERIES, BOT_NOTES, BADGES, AV_COLORS, AV_EMOJIS };
