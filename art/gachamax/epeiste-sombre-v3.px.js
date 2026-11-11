// Gacha MAX -- "Sombre" style, v3. Épéiste: idle (breathing), attack, and the
// small out-of-combat version. Fixes from the v2 review:
// - no automatic glow: every light pixel is placed by hand, limited palette
// - very dark outline (not pure black) so the silhouette reads on any background
// - real arm (separated from the cloak by an inner outline + rim light), visible guard
// - blades drawn as two parallel 1-px lines at 45° or 90° only (regular steps)
// - legs with a visible knee and shaped feet, guard stance
// - cloak torn on its bottom edge only (no holes inside the body)
// - scarf: folded neck wrap + a ribbon of constant thickness that waves as one piece
// - attack: anticipation, body lean, foot that moves in 2 steps, trail that follows the blade
pal({
  x: "#0b0914",                               // outline + inside of the hood
  d: "#2a2748", D: "#18162b",                 // body: lit side / shadow side
  l: "#6c78d6", L: "#b4bdff",                 // rim light (from the upper left)
  y: "#ffe66d", Y: "#b08a2c",                 // gaze + its dim edge
  o: "#ff5a36", O: "#a92d1a", q: "#ffa27a",   // scarf (class accent)
  W: "#ffffff", c: "#9fefff", C: "#3f8fb0",   // blade / trail
  a: "#e0b04a", n: "#4a3320",                 // guard / grip
})

const R = Math.round, OX = 6                 // OX: room on the left for the blade
const P = (x, y) => [x + OX, y]

function leg(c, hip, knee, ank, col) {
  const [hx, hy] = P(...hip), [kx, ky] = P(...knee), [ax, ay] = P(...ank)
  c.line(hx, hy, kx, ky, col, 4)
  c.line(kx, ky, ax, ay, col, 3)
  c.poly([ax - 4, ay + 2, ax + 2, ay + 2, ax + 2, ay - 1, ax - 1, ay - 1], col)   // toe to the left
}

function blade(c, h, tip, trailCol) {
  const [hx, hy] = P(...h), [tx, ty] = P(...tip)
  const dx = Math.sign(tx - hx), dy = Math.sign(ty - hy)
  c.line(hx + dx, hy + dy, tx, ty, "W")
  c.line(hx + dx + 1, hy + dy, tx + 1, ty, "c")
  // guard: perpendicular to the blade, 1 px past the hand
  const gx = hx + dx, gy = hy + dy, px_ = -dy, py_ = dx
  c.line(gx - px_ * 2, gy - py_ * 2, gx + px_ * 2, gy + py_ * 2, "a")
  c.line(hx - dx, hy - dy, hx - dx * 2, hy - dy * 2, "n")                     // grip / pommel
}

function hero(c, p, t) {
  const k = t * Math.PI * 2, u = p.ux || 0, b = p.b || 0, hb = p.hb ?? b
  const U = (x, y, yy = b) => P(x + u, y + yy)          // upper-body point
  // 1. scarf: two thin tails from the knot, tapering, waving as one piece
  const tail = (len, dy, amp, lag, col, under) => {
    let prev = null
    for (let i = 0; i <= len; i++) {
      const f = i / len
      const [x, y] = U(27 + i, 14 + dy + R(i * 0.25 + Math.sin(k - i * 0.45 - lag) * amp * f))
      if (prev) {
        const w = f < 0.5 ? 2 : 1
        if (under) c.line(prev[0], prev[1] + 1, x, y + 1, under, w)
        c.line(prev[0], prev[1], x, y, col, w)
      }
      prev = [x, y]
    }
  }
  tail(9, 2, 1.5, 0.8, "O", null)          // short lower tail (shadow colour)
  tail(13, 0, 2.2, 0, "o", "O")            // long upper tail
  // 2. back leg
  leg(c, p.hipB, p.kneeB, p.ankB, "D")
  // 3. cloak, back panel (shadow side); torn hem only at the bottom edge
  const s = p.sway || 0
  c.poly([...U(19, 14), ...U(26, 14), ...U(30, 20), ...P(32, 31), ...P(31 + s, 35), ...P(29, 32), ...P(27 - s, 35), ...P(25, 33), ...P(21, 33)], "D")
  // 4. front leg (its thigh hides under the cloak)
  leg(c, p.hipF, p.kneeF, p.ankF, "d")
  // 5. cloak, front panel (lit side) + rim light on its front edge
  c.poly([...U(15, 15), ...U(22, 14), ...U(24, 20), ...P(24, 33), ...P(22 + s, 36), ...P(20, 32),
    ...P(18 - s, 36), ...P(16, 32), ...P(14 + s, 35), ...P(13, 30), ...U(13, 21)], "d")
  c.line(...U(13, 21), ...P(13, 29), "l"); c.line(...U(15, 15), ...U(13, 21), "L")
  // 6. hood: pointed back, dark opening, gaze, continuous rim light
  const H = (x, y) => P(x + u, y + hb)
  c.poly([...H(12, 10), ...H(14, 5), ...H(18, 2), ...H(23, 2), ...H(27, 5), ...H(31, 8), ...H(27, 10), ...H(26, 13), ...H(13, 13), ...H(11, 12)], "d")
  c.poly([...H(23, 2), ...H(27, 5), ...H(31, 8), ...H(27, 10), ...H(26, 13), ...H(22, 13), ...H(22, 5)], "D")
  c.poly([...H(12, 7), ...H(16, 6), ...H(17, 12), ...H(12, 12)], "x")
  c.px(...H(13, 9), "y"); c.px(...H(14, 9), "y"); c.px(...H(15, 9), "Y"); c.px(...H(13, 10), "Y")
  c.line(...H(11, 12), ...H(12, 10), "l"); c.line(...H(12, 10), ...H(14, 5), "L")
  c.line(...H(14, 5), ...H(18, 2), "L"); c.line(...H(18, 2), ...H(22, 2), "l")
  // 7. scarf wrapped around the neck: folds + knot at the back
  c.poly([...U(11, 12), ...U(24, 11), ...U(26, 13), ...U(25, 16), ...U(12, 16)], "o")
  c.line(...U(12, 16), ...U(25, 16), "O")
  c.px(...U(17, 13), "O"); c.px(...U(18, 14), "O"); c.px(...U(21, 12), "O"); c.px(...U(22, 13), "O")
  c.line(...U(12, 12), ...U(16, 12), "q")
  c.rect(...U(24, 12), 3, 4, "O"); c.px(...U(25, 13), "o")
  // 8. sword (under the hand)
  blade(c, p.H, p.tip)
  // 9. sword arm: inner outline first (separates it from the cloak), then fill + rim
  const [sx, sy] = P(...p.S), [ex, ey] = P(...p.E), [hx, hy] = P(...p.H)
  c.line(sx, sy, ex, ey, "x", 5); c.line(ex, ey, hx, hy, "x", 4)
  c.line(sx, sy, ex, ey, "d", 3); c.line(ex, ey, hx, hy, "d", 2)
  c.line(sx - 1, sy - 1, ex - 1, ey - 1, "l")
  c.rect(hx - 1, hy - 1, 3, 3, "D"); c.px(hx - 1, hy - 1, "l")
  // 10. slash trail: an arc around the shoulder, from where the blade came from
  if (p.trail) {
    const [cx, cy] = P(...p.S), r = p.trail.r
    for (let a = p.trail.a0; a >= p.trail.a1; a -= 2) {
      const ra = (a * Math.PI) / 180, cs = Math.cos(ra), sn = Math.sin(ra)
      if (p.trail.fade) { if (a % 6 === 0) c.px(R(cx + cs * (r - 1)), R(cy + sn * (r - 1)), "C"); continue }
      c.px(R(cx + cs * r), R(cy + sn * r), "W")
      c.px(R(cx + cs * (r - 1)), R(cy + sn * (r - 1)), "c")
      c.px(R(cx + cs * (r - 2)), R(cy + sn * (r - 2)), "C")
    }
  }
}

// --- poses (coordinates before the OX shift) ---
const GUARD_LEGS = { hipF: [18, 30], kneeF: [14, 36], ankF: [13, 41], hipB: [25, 30], kneeB: [28, 36], ankB: [31, 41] }
const STEP_LEGS = { hipF: [17, 30], kneeF: [12, 36], ankF: [10, 41], hipB: [25, 30], kneeB: [29, 36], ankB: [32, 41] }
const LUNGE_LEGS = { hipF: [16, 30], kneeF: [10, 35], ankF: [7, 41], hipB: [24, 30], kneeB: [28, 36], ankB: [33, 41] }
const guard = (b) => ({ ...GUARD_LEGS, b, S: [17, 16 + b], E: [14, 21 + b], H: [11, 24 + b], tip: [2, 15 + b] })

// Idle: head and shoulders move 1 px at different moments (smoother than one jump).
const IDLE = [
  { ...guard(0), hb: 0, sway: 0 }, { ...guard(0), hb: 1, sway: 0 },
  { ...guard(1), hb: 1, sway: 1 }, { ...guard(1), hb: 0, sway: 1 },
]
anim("ombre_idle", { w: 48, h: 45, fps: 5, outline: "x" },
  ...IDLE.map((p, i) => frame((c) => hero(c, p, i / IDLE.length))))

// Attack.
const ATK = [
  { ...guard(0), ms: 300 },
  { ...GUARD_LEGS, kneeF: [15, 37], ux: 2, b: 1, S: [19, 17], E: [21, 13], H: [23, 9], tip: [31, 1], ms: 240 },          // anticipation
  { ...STEP_LEGS, ux: -1, b: 1, S: [16, 17], E: [14, 12], H: [13, 8], tip: [13, 0], ms: 60 },                             // step + swing
  { ...LUNGE_LEGS, ux: -4, b: 2, hb: 2, S: [13, 18], E: [9, 22], H: [6, 25], tip: [0, 31],
    trail: { r: 18, a0: -43, a1: -225 }, ms: 140 },                                                                       // slash
  { ...LUNGE_LEGS, ux: -4, b: 2, hb: 2, S: [13, 18], E: [10, 24], H: [8, 28], tip: [2, 34],
    trail: { r: 18, a0: -150, a1: -225, fade: true }, ms: 220 },                                                          // follow-through
  { ...STEP_LEGS, ux: -1, b: 1, S: [16, 17], E: [14, 22], H: [11, 25], tip: [3, 17], ms: 120 },                          // recover
  { ...guard(0), ms: 300 },
]
anim("ombre_attaque", { w: 48, h: 45, outline: "x" },
  ...ATK.map((p, i) => frame({ ms: p.ms }, (c) => hero(c, p, i / ATK.length))))

// Small out-of-combat version (14 x 16): same hood, gaze, scarf, raised sword.
const MINI = `
......LLd.....
....lLdddd....
...lddddddDd..
...xyyxdddDDD.
...xxxddddDD..
W.oqqooooOO...
.W.ooooooOOO..
..Wa.dddDDOOO.
...nlddddDD.OO
...lddddddD...
...ldddddDDD..
....dddddDDD..
....dd...DD...
...dd.....DD..
..ddd.....DDD.`
anim("ombre_mini", { fps: 5, outline: "x" },
  frame(MINI),
  frame(MINI, grid(11, 7, "OO_"), grid(12, 8, "_O")),
  frame(MINI, grid(11, 7, "OOO"), grid(12, 8, "__")),
  frame(MINI, grid(11, 7, "OO_"), grid(12, 8, "_O")))

// Board: the same sprites on a mid-tone and on a very dark background.
scene("planche_v3", { w: 236, h: 108, bg: "#3d4170" },
  rect(0, 54, 236, 54, "#0d0c18"),
  stamp("ombre_idle", 6, 4), stamp("ombre_attaque", 66, 4),
  stamp("ombre_mini", 130, 24), stamp("ombre_mini", 150, 24, { delay: 200 }),
  stamp("ombre_idle", 6, 58, { delay: 400 }), stamp("ombre_attaque", 66, 58, { delay: 600 }),
  stamp("ombre_mini", 130, 78), stamp("ombre_mini", 150, 78, { delay: 400 }))
