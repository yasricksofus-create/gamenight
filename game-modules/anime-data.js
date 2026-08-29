// anime-data.js -- Character pairs for the anime modes of Undercover.
//
// Each entry is a PAIR of two comparable characters. Civils get one, the
// undercover gets the other (the module randomizes which). "name" is used by the
// browser to fetch the character's image from AniList at display time; "desc" is
// a short FRENCH physical description shown as a fallback (and to keep everyone
// equal even if an image fails to load).
//
// This is a STARTER SET, deliberately easy to grow: add a line to grow a mode.
// Keep pairs "confusable" (similar look/role) so the undercover can blend in.

// Mixed anime: look-alike / same-archetype characters from different series.
const CONFONDU = [
  { a: { name: "Gojo Satoru", desc: "Grand, cheveux blancs en bataille, yeux clairs souvent cachés par un bandeau." },
    b: { name: "Kakashi Hatake", desc: "Cheveux gris hérissés, masque sur le bas du visage, un œil dissimulé, air blasé." } },
  { a: { name: "Zenitsu Agatsuma", desc: "Cheveux blonds, tenue à éclairs jaunes, souvent paniqué et en larmes." },
    b: { name: "Denki Kaminari", desc: "Cheveux blonds à mèche noire en éclair, uniforme scolaire, nonchalant." } },
  { a: { name: "Light Yagami", desc: "Jeune homme brun soigné, uniforme scolaire, regard calculateur." },
    b: { name: "Lelouch Lamperouge", desc: "Cheveux noirs, traits fins, prestance aristocratique, souvent en uniforme." } },
  { a: { name: "Monkey D. Luffy", desc: "Cheveux noirs, chapeau de paille, cicatrice sous l'œil, éternel sourire." },
    b: { name: "Natsu Dragneel", desc: "Cheveux roses en bataille, écharpe blanche à écailles, énergique et bagarreur." } },
  { a: { name: "Saitama", desc: "Crâne chauve, visage inexpressif, cape blanche et combinaison jaune." },
    b: { name: "Shigeo Kageyama", desc: "Coupe au bol noire, air impassible, uniforme scolaire, très ordinaire." } },
  { a: { name: "Naruto Uzumaki", desc: "Cheveux blonds hérissés, marques sur les joues, tenue orange voyante." },
    b: { name: "Asta", desc: "Cheveux blancs courts, petit mais très musclé, crie beaucoup." } },
  { a: { name: "Mikasa Ackerman", desc: "Cheveux noirs mi-longs, écharpe rouge, regard sérieux, athlétique." },
    b: { name: "Yor Forger", desc: "Longs cheveux noirs, épingles rouges, élégante et discrète, redoutable." } },
  { a: { name: "Vegeta", desc: "Cheveux noirs dressés en flamme, armure de combat, air hautain." },
    b: { name: "Sasuke Uchiha", desc: "Cheveux noirs, regard sombre et distant, rival taciturne très doué." } },
];

// Recent well-known anime (up to ~last year).
const SAISON = [
  { a: { name: "Denji", desc: "Cheveux blonds courts en pics, sourire édenté, allure débraillée." },
    b: { name: "Yuji Itadori", desc: "Cheveux clairs courts, carrure sportive, veste d'uniforme, souriant." } },
  { a: { name: "Frieren", desc: "Elfe aux longs cheveux blancs, petite taille, air impassible et intemporel." },
    b: { name: "Marcille", desc: "Longs cheveux blonds ondulés, oreilles pointues, mage expressive." } },
  { a: { name: "Makima", desc: "Cheveux oranges tressés, yeux aux anneaux, calme et énigmatique." },
    b: { name: "Yor Forger", desc: "Longs cheveux noirs, épingles rouges, élégante mais mortelle." } },
  { a: { name: "Anya Forger", desc: "Petite fille aux cheveux roses, deux couettes, très expressive." },
    b: { name: "Nezuko Kamado", desc: "Jeune fille aux cheveux noirs à pointes oranges, bâillon en bambou." } },
];

// Single-universe modes: two characters from the SAME anime.
const UNIVERS = {
  "Naruto": [
    { a: { name: "Naruto Uzumaki", desc: "Cheveux blonds hérissés, marques sur les joues, tenue orange." },
      b: { name: "Sasuke Uchiha", desc: "Cheveux noirs, regard sombre, rival taciturne." } },
    { a: { name: "Sakura Haruno", desc: "Cheveux roses courts, front marqué, ninja médecin déterminée." },
      b: { name: "Hinata Hyuga", desc: "Cheveux bleu-noir longs, yeux pâles, timide et douce." } },
  ],
  "One Piece": [
    { a: { name: "Roronoa Zoro", desc: "Cheveux verts, trois sabres, bandeau, sens de l'orientation catastrophique." },
      b: { name: "Sanji", desc: "Cheveux blonds, sourcil en spirale, costume, se bat aux pieds." } },
    { a: { name: "Nami", desc: "Cheveux oranges, navigatrice rusée, aime l'argent et les cartes." },
      b: { name: "Nico Robin", desc: "Cheveux noirs longs, calme et cultivée, archéologue." } },
  ],
  "Dragon Ball": [
    { a: { name: "Son Goku", desc: "Cheveux noirs hérissés, tenue orange, naïf et passionné de combat." },
      b: { name: "Vegeta", desc: "Cheveux noirs en flamme, armure, prince fier et rival." } },
    { a: { name: "Son Goten", desc: "Enfant, cheveux noirs, portrait de son père au même âge." },
      b: { name: "Trunks", desc: "Enfant, cheveux violets/mauves, fils fier de Vegeta." } },
  ],
  "Jujutsu Kaisen": [
    { a: { name: "Yuji Itadori", desc: "Cheveux clairs courts, sportif, souriant et généreux." },
      b: { name: "Megumi Fushiguro", desc: "Cheveux noirs en pics, air sérieux et renfermé." } },
    { a: { name: "Gojo Satoru", desc: "Grand, cheveux blancs, bandeau sur les yeux, professeur surpuissant." },
      b: { name: "Suguru Geto", desc: "Longs cheveux noirs attachés, calme, ancien ami de Gojo." } },
  ],
};

module.exports = { CONFONDU, SAISON, UNIVERS };
