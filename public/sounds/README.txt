DOSSIER DES SONS — Game Night (jeu Undercover uniquement)
=========================================================

Les sons sont joues sur l'ECRAN DU HOST. AJOUTER DES SONS NE DEMANDE AUCUNE
MODIFICATION DE CODE : depose simplement les fichiers ici avec le bon nom.

Fichiers de base :
  reglages.mp3                -> pendant le vote des reglages (MUSIQUE)
  ambiance.mp3                -> ambiance en boucle pendant la partie (MUSIQUE)
  vote.mp3                    -> pendant le vote (MUSIQUE)
  mrwhite.mp3                 -> quand Mr. White est demasque (MUSIQUE : coupe le reste)
  victoire.mp3                -> fin de partie (MUSIQUE)
  distribution.mp3            -> distribution des cartes (BRUITAGE)
  elimination-Civil.mp3       -> un CIVIL est elimine (BRUITAGE)
  elimination-Undercover.mp3  -> un UNDERCOVER est elimine (BRUITAGE)

AJOUTER DES VARIANTES (jouees au hasard, sans repeter la meme deux fois) :
  Ajoute simplement un chiffre a la fin : ambiance2.mp3, ambiance3.mp3,
  vote2.mp3, vote3.mp3, distribution2.mp3, mrwhite2.mp3, etc. (jusqu'a 8).
  Le jeu les detecte tout seul au chargement de la page host. AUCUN CODE A TOUCHER.

MUSIQUES vs BRUITAGES :
  - Les MUSIQUES sont exclusives : demarrer l'une coupe les autres (fondu court).
  - Les BRUITAGES se jouent PAR-DESSUS la musique, qui baisse (50% -> 10%) 2s,
    puis remonte 2s.

Volume : barre en bas a droite de l'ecran host (avec bouton muet), a 50% par defaut.
Formats acceptes : .mp3 (utilise par la detection auto).
