# Game Night 🎉

Plateforme web générique de mini-jeux multijoueurs (façon Jackbox).
Un **host** ouvre le site sur son écran (partagé en visio/Discord), les **joueurs**
rejoignent depuis leur téléphone avec un **code de salle**.

## Ce qui fonctionne pour l'instant

- Page d'accueil avec la grille des jeux (le « Megapicker »).
- Création d'une salle par le host, avec un code à 4 lettres.
- Les joueurs rejoignent par ce code depuis leur appareil.
- Chaque jeu a sa propre **DA** (direction artistique : couleurs, emoji).
- Liste des joueurs mise à jour en direct (arrivées / départs).

Il n'y a pas encore de règles de jeu : c'est le **socle** (moteur générique).
Les jeux eux-mêmes viendront ensuite, sans toucher au moteur.

## Lancer en local (sur ton ordinateur)

1. **Installer Node.js** (si ce n'est pas déjà fait) : https://nodejs.org (version LTS).
2. Ouvrir un terminal **dans ce dossier**.
3. Installer les dépendances (à faire une seule fois) :
   ```
   npm install
   ```
4. Lancer le serveur :
   ```
   npm start
   ```
5. Ouvrir **http://localhost:3000** dans ton navigateur → tu es le host.

### Faire jouer des amis sur le même wifi

- Trouve l'adresse IP locale de ton ordinateur
  (Windows : `ipconfig` → « Adresse IPv4 », ex. `192.168.1.42`).
- Tes amis ouvrent `http://192.168.1.42:3000` sur leur téléphone (même wifi)
  et entrent le code affiché sur ton écran.

> Pour jouer avec des amis **à distance** (pas le même wifi), il faudra
> **déployer** le serveur en ligne. C'est une étape séparée, à faire plus tard.

## Structure du projet

```
server.js        → le MOTEUR générique (salles, connexions, temps réel)
games.js         → la liste des jeux + leur DA (le seul fichier à modifier pour ajouter un jeu)
public/          → tout ce que voit le navigateur
  index.html     → page d'accueil (grille + rejoindre)
  host.html      → écran du host (code + joueurs)
  player.html    → écran du joueur (téléphone)
  css/base.css   → styles de base
  js/theme.js    → applique la DA du jeu
  js/home.js     → logique de l'accueil
  js/host.js     → logique côté host
  js/player.js   → logique côté joueur
```

## Ajouter un nouveau jeu (aperçu)

Pour l'instant, il suffit d'ajouter une entrée dans `games.js` (id, nom, emoji,
tagline, couleurs). Le moteur n'a pas besoin d'être modifié : c'est tout l'intérêt
d'une plateforme générique.

## Limite connue (à améliorer plus tard)

Si le host **recharge sa page**, sa salle est fermée et il en obtient une nouvelle
(nouveau code). Une future version permettra au host de se reconnecter à sa salle.
