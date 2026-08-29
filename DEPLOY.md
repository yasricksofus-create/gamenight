# Mettre Game Night en ligne (gratuit, avec Render)

But : obtenir une **URL publique** (ex. `https://gamenight-xxxx.onrender.com`)
que tes amis ouvrent depuis **n'importe où**, pas seulement ton wifi.

Tu n'as **rien à installer** ni aucune ligne de commande à taper : tout se fait
dans le navigateur. Prévois ~15-20 minutes la première fois.

Le principe : ton code va d'abord sur **GitHub** (un site qui héberge le code),
puis **Render** récupère ce code et le fait tourner en ligne.

---

## Étape 1 — Mettre le code sur GitHub

1. Crée un compte gratuit sur **https://github.com** (bouton *Sign up*).
2. En haut à droite, clique **+** puis **New repository**.
3. Donne un nom, par exemple `gamenight`. Laisse **Public**. Clique **Create repository**.
4. Sur la page qui s'affiche, clique le lien **« uploading an existing file »**
   (ou *Add file → Upload files*).
5. **Glisse-dépose** dans la zone d'upload les éléments suivants, pris dans ton
   dossier de projet :
   - les fichiers : `package.json`, `games.js`, `server.js`, `render.yaml`,
     `.gitignore`, `README.md`, `DEPLOY.md`
   - **le dossier `public` en entier** (avec ses sous-dossiers `css` et `js`)
   - ⚠️ **NE PAS** envoyer le dossier `node_modules` s'il existe :
     Render le recréera tout seul.
6. En bas, clique **Commit changes**.

Ton code est maintenant sur GitHub.

---

## Étape 2 — Déployer sur Render

1. Va sur **https://render.com** et crée un compte.
   👉 Choisis **« Sign up with GitHub »** : c'est le plus simple, ça relie
   directement tes deux comptes.
2. Dans le tableau de bord, clique **New +** → **Web Service**.
3. Render te propose tes dépôts GitHub → choisis **`gamenight`** → **Connect**.
   (S'il demande l'autorisation d'accéder à GitHub, accepte.)
4. Vérifie les réglages (grâce au fichier `render.yaml`, ils sont normalement
   déjà bons) :
   - **Language / Runtime** : `Node`
   - **Build Command** : `npm install`
   - **Start Command** : `npm start`
   - **Instance Type** : **Free**
5. Clique **Create Web Service** (ou **Deploy**).
6. Render installe et lance ton serveur — ça prend quelques minutes. Suis les
   logs ; quand tu vois `Game Night server running...` et le statut **Live**,
   c'est prêt.
7. En haut de la page, Render affiche ton **URL publique**
   (ex. `https://gamenight-xxxx.onrender.com`). C'est elle que tout le monde utilisera.

---

## Étape 3 — Jouer en ligne

- **Toi (host)** : ouvre l'URL Render sur ton ordinateur, choisis un jeu,
  tu obtiens un code de salle. Partage ton écran (visio/Discord).
- **Tes amis** : ouvrent la **même URL** sur leur téléphone (n'importe où),
  tapent le code + leur pseudo, et rejoignent.

### À savoir sur l'offre gratuite

- Après **15 minutes sans activité**, le service **s'endort**. Le tout premier
  accès suivant prend **~30 à 60 secondes** (Render affiche une page de
  chargement le temps de le réveiller). Ensuite, tout est fluide.
- Astuce avant une soirée jeux : ouvre l'URL 1-2 minutes avant que les amis
  arrivent, pour que le serveur soit déjà réveillé.

---

## Mettre à jour le jeu plus tard

Quand on modifiera le code, il suffira de renvoyer les fichiers modifiés sur
GitHub (même méthode *Upload files*, ou plus tard avec un outil Git) : **Render
redéploie automatiquement** la nouvelle version. L'URL, elle, ne change pas.
