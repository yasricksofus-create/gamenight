// engine/games-loader.js -- Auto-discovers the games.
//
// Each game is ONE self-contained folder under /games/<id>/ :
//   meta.js            -> the registry entry (id, name, theme, cheats, order...)
//   server.js          -> the game's server logic (OPTIONAL; absent = "coming soon")
//   client/            -> the browser code (common.js + host.js + player.js)
//   (any data files the game needs, e.g. data.js)
//
// This file is the ONLY thing the engine (server.js) loads. Adding a game =
// dropping a new folder here. Nothing else to touch.

const fs = require("fs");
const path = require("path");

const GAMES_DIR = path.join(__dirname, "..", "games");

const games = [];        // the public registry (metas), ordered
const gameModules = {};  // id -> server module (only for games that have one)

for (const id of fs.readdirSync(GAMES_DIR)) {
  const dir = path.join(GAMES_DIR, id);
  if (!fs.statSync(dir).isDirectory() || id.startsWith("_")) continue;

  const metaPath = path.join(dir, "meta.js");
  if (!fs.existsSync(metaPath)) continue; // not a game folder
  const meta = require(metaPath);
  // A game that has real rules also flags itself as "ready" for the home grid.
  const serverPath = path.join(dir, "server.js");
  meta.ready = fs.existsSync(serverPath);
  games.push(meta);
  if (meta.ready) gameModules[meta.id] = require(serverPath);
}

// Stable display order (meta.order, then name).
games.sort((a, b) => (a.order || 99) - (b.order || 99) || a.name.localeCompare(b.name));

function getGameById(id) {
  return games.find((g) => g.id === id) || null;
}

module.exports = { games, getGameById, gameModules, GAMES_DIR };
