// games/cascade/server.js -- Server logic for "Cascade" (an original shedding-card
// game, Uno-like but with the user's own rules and 5 custom cards).
//
// Colors: R J V B. Cards: numbers 0-9, specials skip/reverse/draw2 (colored),
// joker (= wild +4), and 5 custom colourless cards: flush, pay, print, plus1,
// protect. Non-classic rules are voted before the game (settings phase).
//
// Players are identified by their stable seatId (never a socket). Each player's
// hand is private (sent via "cascade:hand"); the public "cascade:state" only carries
// counts + the top card + the active color + whose turn it is.

const COLORS = ["R", "J", "V", "B"];
const SETTINGS_SECONDS = 60;
const HAND_SIZE = 7;

// Auto-avatars for the host "table" view (players don't pick yet).
const AVATAR_COLORS = ["#F04646", "#F0A020", "#F0E246", "#5DF046", "#2ED0C0",
  "#4C46F0", "#9B5DE5", "#F15BB5", "#00BBF9", "#FF7B54", "#8AC926", "#E86AF0"];
const AVATAR_EMOJIS = ["🦊", "🐼", "🐧", "🐸", "🐙", "🦄", "🐯", "🐨", "🦁", "🐵",
  "🐰", "🐳", "🦉", "🐝", "🦖", "🐢"];

// How many of each custom card go in the deck (from the user's "Max de carte").
const CUSTOM_COUNTS = { flush: 8, pay: 10, print: 8, plus1: 4, protect: 4 };

let _uid = 0;
function card(props) { return Object.assign({ id: "c" + (++_uid) }, props); }

function buildDeck(withCustoms) {
  const deck = [];
  COLORS.forEach((c) => {
    deck.push(card({ kind: "number", color: c, value: 0 }));
    for (let v = 1; v <= 9; v++) {
      deck.push(card({ kind: "number", color: c, value: v }));
      deck.push(card({ kind: "number", color: c, value: v }));
    }
    for (let k = 0; k < 2; k++) {
      deck.push(card({ kind: "skip", color: c }));
      deck.push(card({ kind: "reverse", color: c }));
      deck.push(card({ kind: "draw2", color: c }));
    }
  });
  for (let k = 0; k < 4; k++) deck.push(card({ kind: "joker", color: null })); // wild +4
  if (withCustoms) {
    Object.keys(CUSTOM_COUNTS).forEach((kind) => {
      for (let k = 0; k < CUSTOM_COUNTS[kind]; k++) deck.push(card({ kind, color: null }));
    });
  }
  return deck;
}

function shuffle(a) {
  a = a.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const isCustom = (k) => ["flush", "pay", "print", "plus1", "protect"].includes(k);
const isColorless = (c) => c.color === null;

// Can `c` be played on top of `top` given the active color?
function playable(c, top, activeColor) {
  if (c.color === null) return true; // joker + customs: anytime
  if (c.color === activeColor) return true;
  if (c.kind === "number") return top.kind === "number" && c.value === top.value;
  return c.kind === top.kind; // skip on skip, reverse on reverse, draw2 on draw2
}

function nextIndex(s, from) {
  const n = s.players.length;
  return ((from + s.dir) % n + n) % n;
}
function advance(s) { s.turn = nextIndex(s, s.turn); }

function drawFromPile(s, n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    if (s.drawPile.length === 0) {
      // Reshuffle the discard (except the top) back into the draw pile.
      if (s.discard.length <= 1) break;
      const top = s.discard.pop();
      s.drawPile = shuffle(s.discard);
      s.discard = [top];
    }
    if (s.drawPile.length) out.push(s.drawPile.pop());
  }
  return out;
}
function giveCards(s, seatId, n) {
  const cards = drawFromPile(s, n);
  s.hands[seatId] = s.hands[seatId].concat(cards);
  s.saidUno[seatId] = false;
  return cards.length;
}

function checkWin(s) {
  for (const id of s.players) {
    if (s.hands[id].length === 0) { s.winner = id; s.phase = "ended"; return true; }
  }
  return false;
}

// ---------- broadcasting ----------
function topCard(s) { return s.discard[s.discard.length - 1]; }

function handSig(cards) { return cards.length + ":" + cards.map((c) => c.id).join(","); }
function sendHands(api, s) {
  // Only re-send a hand that actually changed since last time (most actions touch
  // just 1-2 hands), instead of every player's hand on every update.
  s._handSig = s._handSig || {};
  s.players.forEach((id) => {
    const sig = handSig(s.hands[id] || []);
    if (s._handSig[id] === sig) return;
    s._handSig[id] = sig;
    api.toPlayer(id, "cascade:hand", { hand: s.hands[id] });
  });
}
function broadcast(api, room) {
  const s = room.gameState;
  if (s.phase === "settings") {
    const v = s.settings.votes;
    const counts = { cumul: [0, 0], jumpin: [0, 0], drawUntil: [0, 0], customs: [0, 0] };
    Object.values(v).forEach((choice) => {
      ["cumul", "jumpin", "drawUntil", "customs"].forEach((k) => {
        if (choice[k] === true) counts[k][0]++; else if (choice[k] === false) counts[k][1]++;
      });
    });
    api.toAll("cascade:state", {
      phase: "settings", endsAt: s.settings.endsAt, counts,
      voted: Object.keys(v).length, total: api.players().length,
    });
    return;
  }
  const pub = {
    phase: s.phase,
    players: s.players.map((id) => ({
      id, name: s.names[id], count: s.hands[id].length,
      connected: api.connected(id), said: !!s.saidUno[id],
      avatar: (s.avatars && s.avatars[id]) || null,
    })),
    turn: s.players[s.turn],
    dir: s.dir,
    top: topCard(s),
    activeColor: s.activeColor,
    pendingDraw: s.pendingDraw,
    drawCount: s.drawPile.length,
    rules: s.settings.rules,
    winner: s.winner,
    lastAction: s.lastAction || null,
  };
  api.toAll("cascade:state", pub);
  // Re-send every player their hand on EVERY update, so a played/drawn card is
  // reflected immediately on the phone (the hand changes on almost every action).
  sendHands(api, s);
  // Private per-player info: whose turn + any pending prompt aimed at them.
  s.players.forEach((id) => {
    const mine = { yourTurn: s.players[s.turn] === id, awaiting: null };
    if (s.awaiting && s.awaiting.seatId === id) mine.awaiting = s.awaiting;
    api.toPlayer(id, "cascade:you", mine);
  });
}

// ---------- deal ----------
function deal(api, room) {
  const s = room.gameState;
  const players = api.players();
  s.players = players.map((p) => p.id);
  s.names = {}; players.forEach((p) => (s.names[p.id] = p.name));

  // Auto-assign a distinct avatar (emoji + color) per player for the table view.
  // (Kept in state so it stays stable for the whole round.)
  const cols = shuffle(AVATAR_COLORS), emos = shuffle(AVATAR_EMOJIS);
  s.avatars = {};
  s.players.forEach((id, i) => {
    s.avatars[id] = { color: cols[i % cols.length], emoji: emos[i % emos.length] };
  });

  s.drawPile = shuffle(buildDeck(s.settings.rules.customs));
  s.hands = {};
  s.saidUno = {};
  s.players.forEach((id) => { s.hands[id] = drawFromPile(s, HAND_SIZE); s.saidUno[id] = false; });

  // First discard = the first NUMBER card (keeps the opening simple).
  let first = null;
  for (let i = s.drawPile.length - 1; i >= 0; i--) {
    if (s.drawPile[i].kind === "number") { first = s.drawPile.splice(i, 1)[0]; break; }
  }
  if (!first) first = s.drawPile.pop();
  s.discard = [first];
  s.activeColor = first.color;
  s.dir = 1;
  s.turn = 0;
  s.pendingDraw = 0;
  s.pendingType = null;
  s.winner = null;
  s.awaiting = null;
  s.lastAction = null;
  s.phase = "playing";

  sendHands(api, s);
  broadcast(api, room);
}

// ---------- applying a played card's effect ----------
// Returns true if the turn was already advanced by the effect handler.
function applyEffect(api, room, s, seatId, c) {
  s.lastAction = { name: s.names[seatId], kind: c.kind, color: c.color, value: c.value };

  switch (c.kind) {
    case "skip":
      advance(s); advance(s); // skip the next player
      return true;
    case "reverse":
      if (s.players.length === 2) { advance(s); advance(s); } // acts like skip at 2p
      else s.dir *= -1, advance(s);
      return true;
    case "draw2":
      s.pendingType = "draw2"; s.pendingDraw += 2;
      advance(s); resolvePending(api, room, s);
      return true;
    case "joker": // wild +4
      s.pendingType = "joker"; s.pendingDraw += 4;
      s.awaiting = { type: "color", seatId, then: "advanceResolve" };
      return true; // wait for color; turn handled after color pick
    case "pay":
      s.awaiting = { type: "pay-target", seatId };
      return true; // wait for target
    case "plus1":
      s.players.forEach((id) => { if (id !== seatId) giveCards(s, id, 1); });
      advance(s);
      return true;
    case "print": {
      // Copy the card now under this one (the previous top) into the hand.
      const prev = s.discard[s.discard.length - 2];
      if (prev) { s.hands[seatId].push(card({ kind: prev.kind, color: prev.color, value: prev.value })); }
      advance(s);
      return true;
    }
    case "flush":
      s.awaiting = { type: "flush", seatId };
      return true; // wait for the 3 cards to toss
    case "protect":
      // Played proactively out of a reaction it does nothing special; just skip on.
      advance(s);
      return true;
    default: // number
      advance(s);
      return true;
  }
}

// Make the current player face a pending draw (from +2/+4). Offers protect if
// they hold one; otherwise they draw and are skipped.
function resolvePending(api, room, s) {
  if (s.pendingDraw <= 0) return;
  const victim = s.players[s.turn];
  // If cumul is on and the victim can stack the same type, let them choose to.
  if (s.settings.rules.cumul && s.hands[victim].some((c) => c.kind === s.pendingType)) {
    s.awaiting = { type: "stack-or-take", seatId: victim, amount: s.pendingDraw, ptype: s.pendingType };
    return;
  }
  offerProtectOrDraw(api, room, s, victim, s.pendingDraw, () => { s.pendingDraw = 0; s.pendingType = null; advance(s); });
}

function offerProtectOrDraw(api, room, s, seatId, amount, done) {
  if (s.hands[seatId].some((c) => c.kind === "protect")) {
    s.awaiting = { type: "protect", seatId, amount, _done: done };
    return;
  }
  giveCards(s, seatId, amount);
  done();
}

// ---------- module ----------
module.exports = {
  id: "cascade",
  minPlayers: 2,

  start(api, room) { openSettings(api, room); },

  handle(api, actor, room, type, payload) {
    const s = room.gameState;
    if (!s) return;
    const me = actor.seatId;
    const isHost = actor.isHost;
    payload = payload || {};

    // ----- settings phase -----
    if (type === "voteSetting" && s.phase === "settings" && !isHost) {
      const v = s.settings.votes[me] || {};
      if (["cumul", "jumpin", "drawUntil", "customs"].includes(payload.key)) v[payload.key] = !!payload.value;
      s.settings.votes[me] = v;
      broadcast(api, room); return;
    }
    if (type === "finalizeSettings" && isHost && s.phase === "settings") { finalizeSettings(api, room); return; }
    if (type === "replay" && isHost && s.phase === "ended") { openSettings(api, room); return; }
    if (s.phase !== "playing") return;

    const top = topCard(s);

    // ----- reactions / awaited sub-steps -----
    if (s.awaiting) {
      const aw = s.awaiting;
      if (aw.seatId !== me) {
        // Jump-in is the only thing another player may do while we wait.
        if (type === "jumpin") return tryJumpIn(api, room, s, me, payload.cardId);
        return;
      }
      if (type === "chooseColor" && aw.type === "color") {
        if (!COLORS.includes(payload.color)) return;
        s.activeColor = payload.color;
        s.awaiting = null;
        advance(s); resolvePending(api, room, s); // +4 hits the next player
        checkWin(s); broadcast(api, room); return;
      }
      if (type === "payTarget" && aw.type === "pay-target") {
        const t = payload.seatId;
        s.awaiting = null;
        if (s.players.includes(t) && t !== me) offerProtectOrDraw(api, room, s, t, 1, () => advance(s));
        else advance(s); // invalid target -> just pass the turn on
        checkWin(s); broadcast(api, room); return;
      }
      if (type === "flushDiscard" && aw.type === "flush") {
        const ids = Array.isArray(payload.cardIds) ? payload.cardIds.slice(0, 3) : [];
        const keep = [], tossed = [];
        s.hands[me].forEach((c) => (ids.includes(c.id) ? tossed.push(c) : keep.push(c)));
        s.hands[me] = keep;
        tossed.forEach((c) => s.discard.splice(s.discard.length - 1, 0, c)); // buried under top
        giveCards(s, me, tossed.length);
        s.awaiting = null; advance(s); checkWin(s); broadcast(api, room); return;
      }
      if (type === "protectDecision" && aw.type === "protect") {
        const done = aw._done || (() => {});
        if (payload.use && s.hands[me].some((c) => c.kind === "protect")) {
          const i = s.hands[me].findIndex((c) => c.kind === "protect");
          s.discard.splice(s.discard.length - 1, 0, s.hands[me].splice(i, 1)[0]);
        } else {
          giveCards(s, me, aw.amount);
        }
        s.pendingDraw = 0; s.pendingType = null;
        s.awaiting = null; done(); checkWin(s); broadcast(api, room); return;
      }
      if (type === "stackTake" && aw.type === "stack-or-take") {
        // player chose to just take the pending draw
        offerProtectOrDraw(api, room, s, me, aw.amount, () => { s.pendingDraw = 0; s.pendingType = null; advance(s); });
        s.awaiting = s.awaiting && s.awaiting.type === "protect" ? s.awaiting : null;
        checkWin(s); broadcast(api, room); return;
      }
      if (type === "playDrawn" && aw.type === "play-drawn") {
        s.awaiting = null;
        if (payload.play) return doPlay(api, room, s, me, aw.cardId);
        advance(s); broadcast(api, room); return;
      }
      // Stacking a matching draw card is handled by the normal "play" below.
      if (!(type === "play" && aw.type === "stack-or-take")) return;
    }

    // ----- normal turn actions -----
    if (type === "jumpin") return tryJumpIn(api, room, s, me, payload.cardId);
    if (type === "sayUno") { if (s.hands[me] && s.hands[me].length === 1) s.saidUno[me] = true; broadcast(api, room); return; }
    if (type === "denounce") {
      const t = payload.seatId;
      if (s.players.includes(t) && s.hands[t].length === 1 && !s.saidUno[t]) { giveCards(s, t, 2); broadcast(api, room); }
      return;
    }

    if (s.players[s.turn] !== me) return; // not your turn

    if (type === "play") return doPlay(api, room, s, me, payload.cardId);

    if (type === "draw") {
      if (s.pendingDraw > 0) { // taking the pending attack
        offerProtectOrDraw(api, room, s, me, s.pendingDraw, () => { s.pendingDraw = 0; s.pendingType = null; advance(s); });
        checkWin(s); broadcast(api, room); return;
      }
      // Draw 1 (or until playable if that rule is on), then offer to play it.
      let drawn = drawFromPile(s, 1);
      if (s.settings.rules.drawUntil) {
        while (drawn.length && !playable(drawn[drawn.length - 1], topCard(s), s.activeColor)) {
          s.hands[me].push(drawn[drawn.length - 1]); drawn = drawFromPile(s, 1);
        }
      }
      if (drawn.length) {
        const c = drawn[0]; s.hands[me].push(c); s.saidUno[me] = false;
        if (playable(c, topCard(s), s.activeColor)) { s.awaiting = { type: "play-drawn", seatId: me, cardId: c.id }; }
        else advance(s);
      } else advance(s);
      broadcast(api, room); return;
    }
  },

  onCheat(api, room, cheatId) {
    const s = room.gameState;
    if (!s) return;
    if (cheatId === "reveal-hands") {
      // Host-only peek at every hand (like Undercover's role reveal).
      if (s.hands) {
        const hands = (s.players || []).map((id) => ({ name: s.names[id], cards: s.hands[id] || [] }));
        api.toHost("cascade:cheatReveal", { hands });
      }
      return;
    }
    if (s.phase !== "playing") return;
    if (cheatId === "skip-turn") {
      // Force the current turn to pass (unblocks a stalled player). Clears any
      // pending prompt aimed at the current player.
      if (s.awaiting && s.awaiting.seatId === s.players[s.turn]) s.awaiting = null;
      s.pendingDraw = 0; s.pendingType = null;
      advance(s);
      broadcast(api, room);
      return;
    }
    if (cheatId === "redeal") { deal(api, room); return; }
  },

  onReconnect(api, room, who) {
    const s = room.gameState;
    if (!s) return;
    if (who && who.seatId && s.hands && s.hands[who.seatId]) {
      api.toPlayer(who.seatId, "cascade:hand", { hand: s.hands[who.seatId] });
    }
    broadcast(api, room);
  },

  onPlayerLeave(api, room, seatId) {
    const s = room.gameState;
    if (!s) return;
    if (s.phase === "settings") { delete s.settings.votes[seatId]; broadcast(api, room); return; }
    if (!s.players || !s.players.includes(seatId)) return;
    // Put their cards back and remove them from the rotation.
    const idx = s.players.indexOf(seatId);
    if (s.hands[seatId]) s.drawPile = shuffle(s.drawPile.concat(s.hands[seatId]));
    delete s.hands[seatId];
    s.players.splice(idx, 1);
    if (s.turn >= s.players.length) s.turn = 0;
    if (s.players.length <= 1) { s.winner = s.players[0] || null; s.phase = "ended"; }
    if (s.awaiting && s.awaiting.seatId === seatId) { s.awaiting = null; }
    broadcast(api, room);
  },
};

function doPlay(api, room, s, me, cardId) {
  // Clear a "stack or take" prompt if the player is stacking a matching card.
  if (s.awaiting && s.awaiting.seatId === me && s.awaiting.type === "stack-or-take") s.awaiting = null;
  const hand = s.hands[me];
  const idx = hand.findIndex((c) => c.id === cardId);
  if (idx < 0) return;
  const c = hand[idx];
  const top = topCard(s);

  // If a draw is pending, only a matching stack card may be played (cumul).
  if (s.pendingDraw > 0) {
    if (!(s.settings.rules.cumul && c.kind === s.pendingType)) return;
  } else if (!playable(c, top, s.activeColor)) {
    return;
  }

  hand.splice(idx, 1);
  s.discard.push(c);
  if (!isColorless(c)) s.activeColor = c.color;
  if (hand.length === 1 && s.saidUno[me] === undefined) s.saidUno[me] = false;

  if (checkWin(s)) { broadcast(api, room); return; }

  const advanced = applyEffect(api, room, s, me, c);
  if (!advanced) { /* effect set an awaiting sub-step */ }
  checkWin(s);
  broadcast(api, room);
}

function tryJumpIn(api, room, s, me, cardId) {
  if (!s.settings.rules.jumpin || s.awaiting) return;
  const hand = s.hands[me] || [];
  const c = hand.find((x) => x.id === cardId);
  const top = topCard(s);
  if (!c || c.kind !== top.kind || c.color !== top.color || c.value !== top.value) return;
  // Valid jump-in: it becomes this player's move.
  hand.splice(hand.indexOf(c), 1);
  s.discard.push(c);
  if (!isColorless(c)) s.activeColor = c.color;
  s.turn = s.players.indexOf(me);
  if (checkWin(s)) { broadcast(api, room); return; }
  applyEffect(api, room, s, me, c);
  checkWin(s);
  broadcast(api, room);
}

function openSettings(api, room) {
  const endsAt = Date.now() + SETTINGS_SECONDS * 1000;
  room.gameState = {
    phase: "settings",
    settings: { votes: {}, endsAt, timer: null, rules: { cumul: false, jumpin: false, drawUntil: false, customs: true } },
  };
  room.gameState.settings.timer = setTimeout(() => finalizeSettings(api, room), SETTINGS_SECONDS * 1000);
  broadcast(api, room);
}

function finalizeSettings(api, room) {
  const s = room.gameState;
  if (!s || s.phase !== "settings") return;
  if (s.settings.timer) { clearTimeout(s.settings.timer); s.settings.timer = null; }
  const votes = Object.values(s.settings.votes);
  ["cumul", "jumpin", "drawUntil", "customs"].forEach((k) => {
    let yes = 0, no = 0;
    votes.forEach((v) => { if (v[k] === true) yes++; else if (v[k] === false) no++; });
    s.settings.rules[k] = yes >= no && (yes > 0 || k === "customs"); // customs default ON
    if (yes === 0 && no === 0) s.settings.rules[k] = (k === "customs"); // nobody voted -> only customs on
  });
  deal(api, room);
}
