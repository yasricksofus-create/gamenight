// data.js -- Static content for "Kietkoutsa Reborn" (no logic here).
// Add a line to any list to enrich the game: nothing else to change.

// Game modes (id -> label + one-line rule shown in the settings).
const MODES = {
  classic:   { label: "Classique",    emoji: "🎧", rule: "Chacun met ses sons, on devine qui a mis quoi." },
  usurp:     { label: "Usurpation",   emoji: "🎭", rule: "Tu reçois un joueur à imiter : mets un son qu'IL aurait mis. +1 par vote qui tombe sur lui." },
  truebluff: { label: "Vrai ou Bluff", emoji: "🃏", rule: "2 sons chacun : un vrai coup de cœur, un piège. On devine aussi sincère ou bluff." },
  mashup:    { label: "Mashup",       emoji: "🔀", rule: "Deux extraits de deux joueurs différents à la suite : trouve les deux." },
};

// Themes drawn at random when "Thème imposé" is on.
const THEMES = [
  "Le son de ton enfance",
  "Ton plaisir coupable",
  "Le son que tu chantes sous la douche",
  "Ce que tu écoutes en cachette",
  "Le son de ton premier crush",
  "Le son parfait pour un road trip",
  "Le son qui te donne envie de danser",
  "Le son de ta pire soirée",
  "Le son qui te met en mode sport",
  "Le son de ton été préféré",
  "Un son que tes parents écoutaient",
  "Le son qui te rend nostalgique",
  "Un générique (anime, série, dessin animé)",
  "Un son de jeu vidéo",
  "Un son qui te fait pleurer (ou presque)",
  "Le son de ta playlist « focus »",
  "Un son que personne ici ne connaît",
  "Le son qui te représente le mieux",
  "Un son pour ouvrir un concert",
  "Le son qui t'énerve mais que tu kiffes",
  "Un son en langue étrangère",
  "Le son de ton année de 3e",
  "Le son de mariage ultime",
  "Un son pour une scène de film d'action",
  "Le son que tu mets pour impressionner",
  "Un son réunionnais / de chez toi",
  "Un son des années 2000",
  "Un son pour s'endormir",
  "Le son qui passe en boucle chez toi en ce moment",
  "Un son de TikTok",
];

// What bots search for (they pick a real track like a player would).
const BOT_QUERIES = ["lofi", "rock", "pop", "jazz", "electro", "rap", "classique", "metal", "reggae", "funk", "kpop", "zouk", "maloya", "disco"];

// Secret messages bots attach to their songs.
const BOT_NOTES = [
  "Je l'écoute en boucle depuis 3 semaines.",
  "Mon voisin déteste ce son.",
  "Souvenir de colo.",
  "Choisi au hasard, ne me jugez pas.",
  "Ça me met de bonne humeur.",
  "",
];

// End-of-game badges: id -> label + description (computed in server.js).
const BADGES = {
  chameleon: { emoji: "🦎", label: "Le Caméléon", desc: "a le plus trompé tout le monde" },
  profiler:  { emoji: "🕵️", label: "Le Profiler", desc: "a démasqué le plus de monde" },
  readable:  { emoji: "📖", label: "Le Prévisible", desc: "s'est fait trouver le plus souvent" },
  sheep:     { emoji: "🐑", label: "Le Mouton", desc: "vote toujours comme la majorité" },
  flash:     { emoji: "⚡", label: "L'Éclair", desc: "le plus de bonnes réponses rapides" },
  kamikaze:  { emoji: "💣", label: "Le Kamikaze", desc: "a perdu le plus de jetons en pariant" },
  blindtest: { emoji: "🎯", label: "L'Oreille d'or", desc: "a trouvé le plus de titres / artistes" },
  dj:        { emoji: "💿", label: "Le DJ de la soirée", desc: "ses sons ont reçu le plus de 👍" },
};

// How each setting is shown on the host screen. The host page BUILDS its
// settings panel from this list: adding a setting = one line here (+ its rule
// in config.js), no screen code to touch.
//   kind: "stepper" (number), "choice" (buttons), "switch" (on/off)
const SETTINGS_UI = [
  { group: "game", key: "perPlayer", kind: "stepper", label: "Morceaux par joueur", desc: "Toujours 2 en Vrai ou Bluff" },
  { group: "game", key: "roundSec", kind: "choice", label: "Durée d'une manche", options: [[15, "15 s"], [20, "20 s"], [30, "30 s"]] },
  { group: "game", key: "submitSec", kind: "choice", label: "Temps pour choisir", desc: "Après : on lance avec ce qui est proposé", options: [[0, "∞"], [60, "1 min"], [120, "2 min"], [180, "3 min"]] },
  { group: "game", key: "playback", kind: "choice", label: "Qui entend la musique ?", options: [["all", "Tout le monde"], ["host", "L'écran seulement"]] },
  { group: "game", key: "duo", kind: "choice", label: "Vote à 2 suspects", desc: "Auto = à partir de 8 participants", options: [["auto", "Auto"], ["on", "Oui"], ["off", "Non"]] },
  { group: "opts", key: "blind", kind: "switch", label: "🙈 Mode Blind", desc: "Juste l'audio + bonus blind test (titre / artiste)" },
  { group: "opts", key: "theme", kind: "switch", label: "🎲 Thème imposé", desc: "Un thème tiré au sort pour tout le monde" },
  { group: "opts", key: "bets", kind: "switch", label: "🪙 Mises de confiance", desc: "Miser 1 à 3 jetons sur son vote" },
  { group: "opts", key: "jokers", kind: "switch", label: "🃏 Jokers", desc: "Double, Espion, Brouiller (1 fois chacun)" },
  { group: "opts", key: "hints", kind: "switch", label: "💡 Indices", desc: "Un faux suspect grisé + tendance des votes à la fin" },
  { group: "opts", key: "speed", kind: "switch", label: "⚡ Bonus rapidité", desc: "+1 si tu trouves vite" },
  { group: "opts", key: "finalDouble", kind: "switch", label: "🔥 Dernière manche ×2", desc: "" },
  { group: "opts", key: "earlyEnd", kind: "switch", label: "⏩ Fin anticipée", desc: "Tout le monde a voté → 5 s puis révélation" },
  { group: "opts", key: "autoNext", kind: "switch", label: "🔁 Enchaînement auto", desc: "Pas besoin de cliquer entre les manches" },
  { group: "opts", key: "noExplicit", kind: "switch", label: "🚫 Pas de sons explicites", desc: "" },
  { group: "host", key: "hostPlays", kind: "switch", label: "🖥️ Le host joue aussi (depuis cet écran)", desc: "Tes choix passent par un panneau secret. Le mieux : joue depuis ton téléphone et laisse cet écran en mode TV." },
];

module.exports = { MODES, THEMES, BOT_QUERIES, BOT_NOTES, BADGES, SETTINGS_UI };
