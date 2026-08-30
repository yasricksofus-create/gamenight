// anime-data.js -- Character data for the anime modes of Undercover.
//
// The data is organised in GROUPS (clusters) of look-alike / same-role
// characters. At deal time the module picks a group, then TWO different members
// of that group: one for the civils, one for the undercover. Because any two
// members of a group can be paired, a group of N gives N*(N-1)/2 possible pairs
// -- so a handful of groups already yields a LOT of hard, confusable matchups.
//
// This is a starter set, deliberately easy to grow: add a member to a group, or
// add a whole group. "name" is used to fetch the character image from AniList in
// the browser; "desc" is a short FRENCH physical description (fallback + fairness).

// ---- Mixed anime: look-alike characters from different series ----
const CONFONDU = [
  // Cheveux blancs / argentés, classe et puissants
  [
    { name: "Gojo Satoru", desc: "Grand, cheveux blancs en bataille, yeux clairs souvent cachés par un bandeau." },
    { name: "Kakashi Hatake", desc: "Cheveux gris hérissés, masque, un œil dissimulé, air blasé." },
    { name: "Ken Kaneki", desc: "Cheveux blancs, regard sombre, allure tourmentée." },
    { name: "Killua Zoldyck", desc: "Cheveux argentés en bataille, regard vif, agile et posé." },
    { name: "Toshiro Hitsugaya", desc: "Petit, cheveux blancs hérissés, yeux turquoise, très sérieux." },
    { name: "Jiraiya", desc: "Grand, longue crinière blanche, marques rouges, allure d'ermite." },
  ],
  // Blonds hérissés, énergiques ou explosifs
  [
    { name: "Naruto Uzumaki", desc: "Cheveux blonds hérissés, marques sur les joues, tenue orange." },
    { name: "Katsuki Bakugo", desc: "Cheveux blonds en pics, regard féroce, explosif et colérique." },
    { name: "Zenitsu Agatsuma", desc: "Cheveux blonds, tenue à éclairs, souvent paniqué." },
    { name: "Denki Kaminari", desc: "Cheveux blonds à mèche noire en éclair, uniforme, nonchalant." },
    { name: "Meliodas", desc: "Petit, cheveux blonds, air juvénile cachant une force immense." },
  ],
  // Bruns génies, rivaux ténébreux
  [
    { name: "Light Yagami", desc: "Jeune homme brun soigné, uniforme, regard calculateur." },
    { name: "Lelouch Lamperouge", desc: "Cheveux noirs, traits fins, prestance aristocratique." },
    { name: "Sasuke Uchiha", desc: "Cheveux noirs, regard sombre, rival taciturne très doué." },
    { name: "Itachi Uchiha", desc: "Cheveux noirs longs attachés, cernes marqués, calme glacial." },
    { name: "Vegeta", desc: "Cheveux noirs dressés en flamme, armure, fierté immense." },
  ],
  // Héros shonen surexcités
  [
    { name: "Monkey D. Luffy", desc: "Cheveux noirs, chapeau de paille, cicatrice sous l'œil, éternel sourire." },
    { name: "Natsu Dragneel", desc: "Cheveux roses en bataille, écharpe à écailles, bagarreur." },
    { name: "Son Goku", desc: "Cheveux noirs hérissés, tenue orange, naïf et passionné de combat." },
    { name: "Gon Freecss", desc: "Cheveux noirs à pointes vertes, gamin énergique et pur." },
    { name: "Asta", desc: "Cheveux blancs courts, petit mais très musclé, crie beaucoup." },
  ],
  // Air impassible, puissance cachée
  [
    { name: "Saitama", desc: "Crâne chauve, visage inexpressif, cape blanche et combinaison jaune." },
    { name: "Shigeo Kageyama", desc: "Coupe au bol noire, air impassible, uniforme, très ordinaire." },
    { name: "Sung Jinwoo", desc: "Cheveux noirs, regard perçant, chasseur devenu surpuissant." },
  ],
  // Filles brunes calmes et redoutables
  [
    { name: "Mikasa Ackerman", desc: "Cheveux noirs mi-longs, écharpe rouge, regard sérieux, athlétique." },
    { name: "Yor Forger", desc: "Longs cheveux noirs, épingles rouges, élégante mais mortelle." },
    { name: "Rukia Kuchiki", desc: "Petite, cheveux noirs courts, une mèche sur le visage, sérieuse." },
    { name: "Shinobu Kocho", desc: "Cheveux noir-violet en papillon, petit sourire, calme et vive." },
    { name: "Kaguya Shinomiya", desc: "Longs cheveux noirs, allure hautaine et distinguée." },
  ],
  // Filles aux cheveux roses
  [
    { name: "Sakura Haruno", desc: "Cheveux roses courts, front dégagé, déterminée." },
    { name: "Hitori Gotoh", desc: "Longs cheveux roses, survêtement, extrêmement timide." },
    { name: "Anya Forger", desc: "Petite fille aux cheveux roses, deux couettes, très expressive." },
    { name: "Zero Two", desc: "Longs cheveux roses, petites cornes, aguicheuse et fière." },
  ],
  // Sabreurs / épéistes stoïques
  [
    { name: "Roronoa Zoro", desc: "Cheveux verts, trois sabres, bandeau, sens de l'orientation nul." },
    { name: "Ichigo Kurosaki", desc: "Cheveux oranges hérissés, air renfrogné, immense sabre." },
    { name: "Kenpachi Zaraki", desc: "Grand, cheveux noirs à clochettes, balafre, assoiffé de combat." },
    { name: "Trafalgar Law", desc: "Cheveux noirs sous un bonnet tacheté, cernes, long sabre." },
  ],
  // Petits combattants acharnés
  [
    { name: "Levi Ackerman", desc: "Petit, coupe au bol noire, regard froid, extrêmement fort." },
    { name: "Rock Lee", desc: "Coupe au bol noire, gros sourcils, combattant en vert." },
    { name: "Edward Elric", desc: "Petit, cheveux blonds tressés, manteau rouge, tête brûlée." },
  ],
  // Enfants prodiges
  [
    { name: "Son Goten", desc: "Enfant, cheveux noirs, portrait de son père au même âge." },
    { name: "Trunks", desc: "Enfant, cheveux violets/mauves, fils fier de Vegeta." },
    { name: "Conan Edogawa", desc: "Enfant à lunettes, cheveux noirs, esprit d'un grand détective." },
  ],
];

// ---- Recent well-known anime (up to ~last year) ----
const SAISON = [
  // Ados impulsifs récents
  [
    { name: "Denji", desc: "Cheveux blonds courts en pics, sourire édenté, débraillé." },
    { name: "Yuji Itadori", desc: "Cheveux clairs courts, carrure sportive, souriant." },
    { name: "Isagi Yoichi", desc: "Cheveux noirs, sourcils marqués, footballeur ambitieux." },
    { name: "Sung Jinwoo", desc: "Cheveux noirs, regard perçant, chasseur surpuissant." },
  ],
  // Mages / fantasy récents
  [
    { name: "Frieren", desc: "Elfe aux longs cheveux blancs, petite taille, impassible." },
    { name: "Marcille", desc: "Longs cheveux blonds ondulés, oreilles pointues, mage expressive." },
    { name: "Fern", desc: "Cheveux violets, couettes, apprentie mage calme et sérieuse." },
  ],
  // Filles mignonnes et timides récentes
  [
    { name: "Hitori Gotoh", desc: "Longs cheveux roses, très timide, souvent cachée." },
    { name: "Shouko Komi", desc: "Longs cheveux noirs, très élégante, muette de timidité." },
    { name: "Anya Forger", desc: "Petite, cheveux roses, deux couettes, très expressive." },
  ],
  // Femmes énigmatiques et dangereuses récentes
  [
    { name: "Makima", desc: "Cheveux oranges tressés, yeux aux anneaux, calme et énigmatique." },
    { name: "Yor Forger", desc: "Longs cheveux noirs, épingles rouges, élégante mais mortelle." },
    { name: "Reze", desc: "Cheveux verts noués, sourire doux mais dangereuse." },
  ],
  // Beaux gosses stylés récents
  [
    { name: "Aki Hayakawa", desc: "Cheveux noirs mi-longs, sérieux, souvent une cigarette." },
    { name: "Loid Forger", desc: "Cheveux blonds soignés, élégant, espion imperturbable." },
    { name: "Gojo Satoru", desc: "Grand, cheveux blancs, bandeau sur les yeux, professeur surpuissant." },
  ],
];

// ---- Single-universe modes: pick two characters from the SAME anime ----
const UNIVERS = {
  "Naruto": [
    { name: "Naruto Uzumaki", desc: "Cheveux blonds hérissés, marques sur les joues, tenue orange." },
    { name: "Sasuke Uchiha", desc: "Cheveux noirs, regard sombre, rival taciturne." },
    { name: "Sakura Haruno", desc: "Cheveux roses courts, front dégagé, ninja médecin." },
    { name: "Hinata Hyuga", desc: "Cheveux bleu-noir longs, yeux pâles, timide." },
    { name: "Kakashi Hatake", desc: "Cheveux gris, masque, un œil caché, blasé." },
    { name: "Gaara", desc: "Cheveux rouges, cernes, calebasse de sable, taciturne." },
    { name: "Itachi Uchiha", desc: "Cheveux noirs attachés, cernes, calme glacial." },
  ],
  "One Piece": [
    { name: "Monkey D. Luffy", desc: "Chapeau de paille, cicatrice, éternel sourire." },
    { name: "Roronoa Zoro", desc: "Cheveux verts, trois sabres, bandeau." },
    { name: "Sanji", desc: "Blond, sourcil en spirale, costume, se bat aux pieds." },
    { name: "Nami", desc: "Cheveux oranges, navigatrice rusée." },
    { name: "Nico Robin", desc: "Cheveux noirs longs, calme et cultivée." },
    { name: "Usopp", desc: "Long nez, cheveux crépus, froussard vantard." },
    { name: "Trafalgar Law", desc: "Cheveux noirs, bonnet tacheté, cernes, sabre." },
  ],
  "Dragon Ball": [
    { name: "Son Goku", desc: "Cheveux noirs hérissés, tenue orange, naïf." },
    { name: "Vegeta", desc: "Cheveux en flamme, armure, prince fier." },
    { name: "Son Gohan", desc: "Cheveux noirs, studieux mais puissant." },
    { name: "Piccolo", desc: "Peau verte, antennes, cape et turban, stoïque." },
    { name: "Trunks", desc: "Cheveux violets, fils de Vegeta, épée dans le dos." },
    { name: "Krillin", desc: "Petit, chauve, six points sur le front." },
  ],
  "Jujutsu Kaisen": [
    { name: "Yuji Itadori", desc: "Cheveux clairs courts, sportif, souriant." },
    { name: "Megumi Fushiguro", desc: "Cheveux noirs en pics, air sérieux et renfermé." },
    { name: "Nobara Kugisaki", desc: "Cheveux oranges au carré, franche et sûre d'elle." },
    { name: "Gojo Satoru", desc: "Cheveux blancs, bandeau sur les yeux, surpuissant." },
    { name: "Suguru Geto", desc: "Longs cheveux noirs attachés, calme." },
    { name: "Maki Zenin", desc: "Cheveux verts, lunettes, combattante physique." },
  ],
  "My Hero Academia": [
    { name: "Izuku Midoriya", desc: "Cheveux verts bouclés, taches de rousseur, timide." },
    { name: "Katsuki Bakugo", desc: "Cheveux blonds en pics, explosif et colérique." },
    { name: "Shoto Todoroki", desc: "Cheveux mi-blancs mi-rouges, cicatrice à l'œil, froid." },
    { name: "Ochaco Uraraka", desc: "Cheveux bruns courts, joues rondes, souriante." },
    { name: "Eijiro Kirishima", desc: "Cheveux rouges dressés, dents pointues, loyal." },
    { name: "Tsuyu Asui", desc: "Cheveux verts, allure et manières de grenouille." },
  ],
  "Demon Slayer": [
    { name: "Tanjiro Kamado", desc: "Cheveux bordeaux, cicatrice au front, doux et déterminé." },
    { name: "Zenitsu Agatsuma", desc: "Cheveux blonds, tenue à éclairs, trouillard." },
    { name: "Inosuke Hashibira", desc: "Masque de sanglier, cheveux noirs, sauvage et bagarreur." },
    { name: "Nezuko Kamado", desc: "Cheveux noirs à pointes oranges, bâillon en bambou." },
    { name: "Shinobu Kocho", desc: "Cheveux noir-violet en papillon, petit sourire." },
    { name: "Giyu Tomioka", desc: "Cheveux noirs en catogan, veste bicolore, stoïque." },
  ],
  "Bleach": [
    { name: "Ichigo Kurosaki", desc: "Cheveux oranges hérissés, air renfrogné, grand sabre." },
    { name: "Rukia Kuchiki", desc: "Petite, cheveux noirs courts, une mèche, sérieuse." },
    { name: "Renji Abarai", desc: "Cheveux rouges en catogan, tatouages, fougueux." },
    { name: "Orihime Inoue", desc: "Cheveux roux longs, douce et rêveuse." },
    { name: "Toshiro Hitsugaya", desc: "Petit, cheveux blancs, yeux turquoise, sérieux." },
    { name: "Uryu Ishida", desc: "Cheveux noirs, lunettes, archer réservé." },
  ],
  "Attack on Titan": [
    { name: "Eren Yeager", desc: "Cheveux bruns mi-longs, regard intense." },
    { name: "Mikasa Ackerman", desc: "Cheveux noirs mi-longs, écharpe rouge, redoutable." },
    { name: "Armin Arlert", desc: "Cheveux blonds au carré, doux, stratège." },
    { name: "Levi Ackerman", desc: "Petit, coupe au bol noire, froid, soldat d'élite." },
    { name: "Erwin Smith", desc: "Grand, blond, gros sourcils, commandant charismatique." },
    { name: "Reiner Braun", desc: "Grand, blond, carrure massive, tourmenté." },
  ],
  "Hunter x Hunter": [
    { name: "Gon Freecss", desc: "Cheveux noirs à pointes vertes, gamin énergique." },
    { name: "Killua Zoldyck", desc: "Cheveux argentés, regard vif, agile." },
    { name: "Kurapika", desc: "Blond, tenue tribale, calme et vengeur." },
    { name: "Leorio", desc: "Grand, cheveux noirs courts, lunettes, costume." },
    { name: "Hisoka", desc: "Cheveux rouges, maquillage de clown, inquiétant." },
    { name: "Chrollo", desc: "Cheveux noirs plaqués, croix sur le front, posé." },
  ],
  "Fairy Tail": [
    { name: "Natsu Dragneel", desc: "Cheveux roses, écharpe à écailles, bagarreur." },
    { name: "Lucy Heartfilia", desc: "Blonde, une couette de côté, mage stellaire." },
    { name: "Gray Fullbuster", desc: "Cheveux noirs, se déshabille sans le vouloir, mage de glace." },
    { name: "Erza Scarlet", desc: "Longs cheveux rouges, armure, autoritaire." },
    { name: "Wendy Marvell", desc: "Cheveux bleus longs, jeune, timide et gentille." },
  ],
  "Black Clover": [
    { name: "Asta", desc: "Cheveux blancs courts, petit mais musclé, crie fort." },
    { name: "Yuno", desc: "Cheveux noirs, calme et talentueux, rival d'Asta." },
    { name: "Noelle Silva", desc: "Cheveux gris-argent en couettes, fière mais attachante." },
    { name: "Yami Sukehiro", desc: "Grand, cheveux noirs, cigarette, chef brutal." },
    { name: "Luck Voltia", desc: "Cheveux blonds, sourire constant, accro au combat." },
  ],
  "Chainsaw Man": [
    { name: "Denji", desc: "Cheveux blonds en pics, sourire édenté, débraillé." },
    { name: "Power", desc: "Cheveux blonds/roses avec cornes rouges, imprévisible." },
    { name: "Aki Hayakawa", desc: "Cheveux noirs mi-longs, sérieux, cigarette." },
    { name: "Makima", desc: "Cheveux oranges tressés, yeux aux anneaux, énigmatique." },
    { name: "Himeno", desc: "Cheveux noirs courts, cache-œil, décontractée." },
  ],
};

module.exports = { CONFONDU, SAISON, UNIVERS };
