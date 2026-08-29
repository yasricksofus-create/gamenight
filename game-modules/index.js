// game-modules/index.js -- Registry of games that have server-side logic.
//
// The engine looks up a module here by the game's id. A game listed in games.js
// but ABSENT here simply has no rules yet (the placeholders): the host gets a
// "not ready" message when trying to start it. To wire a new real game, add its
// module file next to this one and one line below.

module.exports = {
  undercover: require("./undercover"),
};
