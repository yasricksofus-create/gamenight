# Gacha MAX — pixel art (claude-pxl)

Sources of the Gacha MAX character sprites, written with claude-pxl
(https://github.com/crsolver/claude-pxl, MIT): pixel art as JavaScript code.
This folder is NOT served by the site (only `public/` and `games/` are).

- `epeiste-sombre-v3.px.js` — chosen style "Sombre" (dark silhouettes, rim light,
  one accent colour per class). Épéiste: idle, attack, small out-of-combat version.
- `essai-5-styles.px.js` — the 5 styles tried before choosing (history).
- `*.gif` — rendered animations (1x).

Build (Node >= 22.18):

    git clone --depth 1 https://github.com/crsolver/claude-pxl /tmp/pxl
    node /tmp/pxl/bin/pxl.js build art/gachamax/epeiste-sombre-v3.px.js --out /tmp/gm-out

Decisions: combat = large "Sombre" sprites; out of combat = small sprites in the
same style; 17-colour palette, no automatic glow, very dark outline (#0b0914).
