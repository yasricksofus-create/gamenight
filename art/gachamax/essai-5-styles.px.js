// Gacha MAX -- the same class (Épéiste) in 5 different styles, to choose one.
pal({
  k: "#1b1630", e: "#1b1630", w: "#ffffff",
  s: "#f2c9a0", S: "#c98f6a", t: "#a8694a",       // skin light / shade / deep
  h: "#d9504a", H: "#8f2a35", i: "#ff8a6a",       // red hair + highlight
  g: "#4fae5c", G: "#2e6b3e", j: "#8fd88a",       // green tunic + highlight
  b: "#3b2e4a", B: "#241b30",                     // trousers / boots
  m: "#e6eef5", M: "#8a96a8", W: "#ffffff",       // blade
  a: "#ffd54a", A: "#b8862a", n: "#5e3a24",       // gold / grip
  // dark style
  d: "#141325", D: "#25233f", l: "#7b86e0", L: "#b9c2ff",
  o: "#ff5a36", O: "#b8321c", y: "#ffe66d", c: "#9ff0ff",
})
ramps("tSs", "Hhi", "Ggj", "Bb", "Mm", "Aa", "dDlL", "Oo")

// ---------------------------------------------------------------------------
// 1. MAP SPRITE (GBA Fire Emblem-like): 14 x 14, 3/4 view, small idle bob.
function mapBody(y) {
  return [
    grid(1, y, `
....hhhh......
..hhhhhhhh....
.hhhHhhhhhh...
.hHhhsssssh...
..HhssessSe...
..HhsssssS....
...hSsssS.....
....GgggGg....
...sGggggGs...
...sGgaagGs...
....ggGGgg....
....bbbbbb....
....bb..bb....
...BBB..BBB...`.replace(/Se\.\.\./, "Se...")),
    line(12, y + 8, 15, y + 2, "m"), px(14, y + 3, "M"), px(15, y + 2, "W"),
    px(11, y + 8, "a"), px(12, y + 9, "a"),
  ]
}
anim("map", { w: 17, h: 16, fps: 3, outline: "k" },
  frame(...mapBody(1)), frame(...mapBody(1)), frame(...mapBody(2)))

// ---------------------------------------------------------------------------
// 2. BATTLE SPRITE (GBA Fire Emblem-like): ~48 x 48, real proportions, side
//    view facing left, idle -> wind-up -> slash.
function warrior(c, p) {
  // legs: hip -> knee -> foot, back leg first (darker)
  c.line(p.hip[0] + 3, p.hip[1], p.kb[0], p.kb[1], "B", 4)
  c.line(p.kb[0], p.kb[1], p.fb[0], p.fb[1], "B", 4)
  c.rect(p.fb[0] - 2, p.fb[1] - 1, 6, 3, "B")
  c.line(p.hip[0] - 1, p.hip[1], p.kf[0], p.kf[1], "b", 4)
  c.line(p.kf[0], p.kf[1], p.ff[0], p.ff[1], "b", 4)
  c.rect(p.ff[0] - 4, p.ff[1] - 1, 6, 3, "B")
  // back arm (behind the body)
  c.line(p.sh[0] + 3, p.sh[1] + 1, p.hand[0] + 2, p.hand[1], "G", 3)
  // torso + tunic skirt
  const [sx, sy] = p.sh, [hx, hy] = p.hip
  c.poly([sx - 4, sy, sx + 5, sy, hx + 5, hy, hx - 4, hy], "g")
  c.poly([sx + 2, sy, sx + 5, sy, hx + 5, hy, hx + 2, hy], "G")
  c.poly([hx - 5, hy - 2, hx + 6, hy - 2, hx + 8, hy + 6, hx - 7, hy + 6], "g")
  c.poly([hx + 2, hy - 2, hx + 6, hy - 2, hx + 8, hy + 6, hx + 3, hy + 6], "G")
  c.line(hx - 5, hy - 2, hx + 6, hy - 2, "a")
  c.line(sx - 3, sy + 1, hx - 3, hy - 3, "j")                    // rim light
  // sword: blade from the hands to the tip, then guard + grip
  c.line(p.hand[0], p.hand[1], p.tip[0], p.tip[1], "m", 2)
  c.line(p.hand[0], p.hand[1], p.tip[0], p.tip[1], "M")
  c.px(p.tip[0], p.tip[1], "W")
  c.line(p.hand[0] - p.g[0], p.hand[1] - p.g[1], p.hand[0] + p.g[0], p.hand[1] + p.g[1], "a", 2)
  // front arm on top
  c.line(sx - 1, sy + 1, p.elb[0], p.elb[1], "g", 3)
  c.line(p.elb[0], p.elb[1], p.hand[0], p.hand[1], "s", 3)
  c.circ(p.hand[0], p.hand[1], 1, "s")
  // head: face, hair mass with spikes flowing back, eye
  const [x, y] = p.head
  c.circ(x, y, 4, "s"); c.rect(x - 4, y, 3, 3, "s"); c.px(x - 4, y + 3, "S")
  c.poly([x - 4, y - 2, x - 2, y - 6, x + 3, y - 6, x + 7, y - 3, x + 11, y - 4, x + 7, y, x + 10, y + 3, x + 5, y + 3, x + 3, y + 5, x + 1, y, x - 4, y - 1], "h")
  c.line(x - 2, y - 5, x + 4, y - 5, "i")
  c.px(x - 2, y, "e"); c.px(x - 2, y - 1, "H"); c.px(x - 1, y - 1, "H")
  c.vline(x - 4, y + 1, 2, "S"); c.px(x + 1, y + 1, "S")
  if (p.slash) {                                                    // slash trail
    for (let a = 100; a <= 230; a += 4) {                          // arc drawn point by point
      const r = (a * Math.PI) / 180
      c.px(Math.round(20 + Math.cos(r) * 16), Math.round(30 + Math.sin(r) * 16), "W")
      c.px(Math.round(20 + Math.cos(r) * 15), Math.round(30 + Math.sin(r) * 15), "c")
    }
  }
}
const POSES = [
  { head: [24, 11], sh: [23, 18], hip: [24, 31], kf: [19, 38], ff: [16, 45], kb: [29, 38], fb: [31, 45], elb: [19, 23], hand: [17, 26], tip: [5, 12], g: [2, -2] },
  { head: [24, 12], sh: [23, 19], hip: [24, 31], kf: [19, 38], ff: [16, 45], kb: [29, 38], fb: [31, 45], elb: [19, 24], hand: [17, 27], tip: [5, 13], g: [2, -2] },
  { head: [26, 12], sh: [25, 19], hip: [25, 31], kf: [20, 38], ff: [17, 45], kb: [31, 38], fb: [34, 45], elb: [29, 15], hand: [30, 11], tip: [44, 2], g: [2, 2] },
  { head: [18, 14], sh: [18, 21], hip: [21, 32], kf: [13, 38], ff: [8, 45], kb: [28, 39], fb: [33, 45], elb: [12, 25], hand: [8, 29], tip: [2, 44], g: [2, 1], slash: true },
]
anim("battle", { w: 47, h: 47, outline: "k" },
  ...POSES.map((p, i) => frame({ ms: [500, 500, 250, 450][i] }, (c) => warrior(c, p))))

// ---------------------------------------------------------------------------
// 3. PORTRAIT (dialogue / gacha card): 48 x 48 bust, 3/4 view.
sprite("portrait", { w: 46, h: 46, outline: "k" },
  // shoulders + tunic collar
  poly([2, 46, 6, 36, 16, 32, 32, 32, 41, 37, 44, 46], "g"),
  poly([28, 32, 32, 32, 41, 37, 44, 46, 30, 46], "G"),
  poly([16, 32, 23, 40, 30, 32], "a"), poly([18, 32, 23, 37, 28, 32], "G"),
  line(4, 41, 12, 35, "j"),
  // neck
  rect(18, 26, 9, 7, "S"), rect(18, 26, 4, 7, "s"),
  // face (3/4 to the left): jaw polygon
  poly([12, 10, 31, 10, 32, 20, 28, 27, 21, 30, 15, 27, 12, 20], "s"),
  poly([26, 14, 32, 14, 32, 20, 28, 27, 25, 28, 27, 20], "S"),
  // ear
  rect(30, 16, 3, 6, "s"), px(31, 18, "S"), px(31, 19, "S"),
  // eyes: big GBA-style, highlight, brows
  rect(15, 16, 4, 4, "e"), px(16, 16, "W"), px(15, 19, "G"), px(18, 19, "G"),
  rect(23, 16, 3, 4, "e"), px(24, 16, "W"), px(23, 19, "G"),
  hline(14, 14, 6, "H"), hline(22, 14, 5, "H"),
  // nose + mouth
  px(20, 21, "S"), px(20, 22, "S"), hline(18, 25, 4, "t"),
  // hair: big spiky mass with fringe over the forehead
  poly([9, 15, 8, 6, 12, 1, 18, 3, 22, 0, 26, 3, 33, 1, 37, 7, 41, 6, 37, 12, 40, 18, 34, 17, 33, 24, 31, 14, 25, 13, 22, 9, 19, 14, 15, 10, 12, 16], "h"),
  poly([12, 4, 18, 3, 22, 1, 26, 4, 22, 5, 16, 6], "i"),
  poly([33, 4, 37, 7, 41, 6, 37, 12, 40, 18, 34, 17], "H"),
  line(13, 9, 16, 12, "H"), line(22, 9, 24, 12, "H"),
  // headband
  line(10, 10, 33, 8, "a"), px(36, 9, "a"), px(38, 10, "A"),
  // sword hilt over the shoulder
  line(38, 30, 44, 22, "n", 2), rect(36, 30, 5, 2, "a"),
)

// ---------------------------------------------------------------------------
// 4. DARK SILHOUETTE (Dead Cells / Hyper Light Drifter-like): side view,
//    near-black body, rim light, glowing eye, scarf blowing in the wind.
function shadow(c, ph) {
  const k = ph * Math.PI * 2
  const flap = Math.round(Math.sin(k) * 2)
  // scarf (behind)
  c.poly([16, 13, 26, 11 + flap, 33, 14 + flap, 27, 15, 22, 17], "O")
  c.poly([16, 13, 25, 12 + flap, 30, 13 + flap, 21, 15], "o")
  // cloak + body
  c.poly([10, 15, 18, 12, 22, 20, 24, 36, 18, 33, 12, 37, 8, 30], "d")
  c.poly([18, 12, 22, 20, 24, 36, 20, 34], "D")
  c.line(10, 16, 8, 30, "l")                                        // rim light
  // legs
  c.line(13, 34, 10, 42, "d", 3); c.line(19, 34, 22, 42, "D", 3)
  // head + hood
  c.circ(13, 9, 5, "d"); c.poly([8, 7, 14, 2, 20, 8, 18, 14, 9, 14], "d")
  c.line(8, 8, 12, 3, "l"); c.px(10, 9, "y"); c.px(9, 9, "y")
  // sword: thin glowing blade held low
  c.line(7, 26, 0, 40, "c", 2); c.line(9, 24, 6, 28, "D", 2)
}
anim("dark", { w: 36, h: 44, frames: 6, fps: 8 }, (c) => shadow(c, c.phase),
  glow("c", { r: 4, strength: 0.5, bands: 3 }), glow("y", { r: 2, strength: 0.35, bands: 2 }))

// ---------------------------------------------------------------------------
// 5. MIX: small map sprite in fights + portrait on the gacha card.
sprite("_card", { w: 58, h: 76 },
  rect(0, 0, 58, 76, "k"), rect(2, 2, 54, 72, "a"), rect(4, 4, 50, 68, "#2a2440"),
  grad(4, 4, 50, 52, "DDl", "v", 0.6),
  stamp("portrait", 4, 6),
  rect(4, 56, 50, 16, "k"),
  text(29, 60, "EPEISTE", "a", { align: "c" }),
  text(29, 66, "***", "y", { align: "c" }))

// ---------------------------------------------------------------------------
// The board shown to the user (light paper, labels in the built-in font).
scene("planche", { w: 350, h: 120, bg: "#f2efe6" },
  text(4, 4, "1 CARTE", "k"), stamp("map", 10, 50),
  text(50, 4, "2 COMBAT", "k"), stamp("battle", 48, 34),
  text(112, 4, "3 PORTRAIT", "k"), stamp("portrait", 112, 34),
  text(180, 4, "4 SOMBRE", "k"), stamp("dark", 182, 34),
  text(232, 4, "5 MELANGE", "k"),
  stamp("map", 234, 60), stamp("_card", 270, 22))
