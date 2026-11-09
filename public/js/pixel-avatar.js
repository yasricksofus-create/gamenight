// pixel-avatar.js -- GENERIC pixel-art avatars for the whole site (engine side).
//
// An avatar is a small object of "parts" chosen by the player:
//   { ears, hair, eyes, mouth, acc, cheeks, face, hairc, bg, shirt, accc, inner }
// (shapes are names from the lists below, colours are "#rrggbb").
// From it we draw a 16x16 pixel-art face (with a blink frame).
//
// This SAME file runs in two places:
//   - in the browser (window.PixelAvatar): drawing, the creator, the games;
//   - on the server (require): clean() checks what a browser sends (never trust
//     the browser), random() gives bots and new players a face.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.PixelAvatar = api;
})(typeof self !== "undefined" ? self : this, function () {
  const P = { // overlays: "." = keep what is underneath
    ears:{
      none:[],
      cat:[[1,"...K........K..."],[2,"...KK......KK..."],[3,"...KIK....KIK..."]],
      fox:[[0,"..K..........K.."],[1,"..KK........KK.."],[2,"..KIK......KIK.."],[3,"..KIIK....KIIK.."]],
      bunny:[[0,"....KK....KK...."],[1,"...KIFK..KFIK..."],[2,"...KIFK..KFIK..."],[3,"...KIFK..KFIK..."]],
      bear:[[2,"..KKK......KKK.."],[3,"..KIFK....KFIK.."]],
      mouse:[[1,".KKK........KKK."],[2,"KIIIK......KIIIK"],[3,"KIIIK......KIIIK"],[4,".KKK........KKK."]],
    },
    hair:{
      none:[],
      short:[[4,"...KHHHHHHHHK..."],[5,"..KHHHHHHHHHHK.."]],
      fringe:[[4,"...KHHHHHHHHK..."],[5,"..KHHHHHHHHHHK.."],[6,"..KHH......HHK.."]],
      spiky:[[2,"....K.K..K.K...."],[3,"...KHKHKKHKHK..."],[4,"...KHHHHHHHHK..."],[5,"..KHHHHHHHHHHK.."]],
      long:[[4,"...KHHHHHHHHK..."],[5,"..KHHHHHHHHHHK.."],[6,"..KH........HK.."],[7,"..KH........HK.."],[8,"..KH........HK.."],[9,"..KH........HK.."],[10,"..KHK......KHK.."],[11,"..KHHKKKKKKHHK.."]],
      afro:[[1,"....KKKKKKKK...."],[2,"..KKHHHHHHHHKK.."],[3,".KHHHHHHHHHHHHK."],[4,".KHHHHHHHHHHHHK."],[5,".KHHFFFFFFFFHHK."],[6,".KHK........KHK."],[7,"..KK........KK.."]],
      bun:[[1,"......KKKK......"],[2,".....KHHHHK....."],[3,"....KKHHHHKK...."],[4,"...KHHHHHHHHK..."],[5,"..KHHFFFFFFHHK.."]],
    },
    eyes:{
      dot:[[7,".....K....K....."]],
      big:[[6,".....WK..WK....."],[7,".....KK..KK....."]],
      happy:[[6,".....K....K....."],[7,"....K.K..K.K...."]],
      sleepy:[[7,"....KKK..KKK...."]],
      glasses:[[7,"...KCCKKKKCCK..."]],
      shades:[[6,"...KKKKKKKKKK..."],[7,"....KWK..KWK...."]],
      star:[[6,".....Y....Y....."],[7,"....YYY..YYY...."],[8,".....Y....Y....."]],
    },
    blink:[[6,"....FFF..FFF...."],[7,"....KKK..KKK...."]],
    mouth:{
      smile:[[9,"......K..K......"],[10,".......KK......."]],
      open:[[9,"......KRRK......"],[10,".......KK......."]],
      cat:[[9,".....K.KK.K....."],[10,"......K..K......"]],
      tongue:[[9,"......KKKK......"],[10,".......RR......."]],
      flat:[[9,"......KKKK......"]],
      fang:[[9,"......KKKK......"],[10,"......W..W......"]],
    },
    acc:{
      none:[],
      headphones:[[3,"...KVVVVVVVVK..."],[6,".KK..........KK."],[7,"KPPK........KPPK"],[8,"KPPK........KPPK"],[9,".KK..........KK."]],
      crown:[[1,"....Y..YY..Y...."],[2,"....YYYYYYYY...."],[3,"....YPYYYYPY...."]],
      cap:[[2,"....KAAAAAAK...."],[3,"...KAAAAAAAAK..."],[4,"...KKKKKKKKKKKK."]],
      beanie:[[1,".......AA......."],[2,"....KAAAAAAK...."],[3,"...KAAAAAAAAK..."],[4,"...KWWWWWWWWK..."]],
      bow:[[2,"..........KPK.KP"],[3,"..........PPPKPP"],[4,"...........KPKP."]],
      horns:[[1,"...R........R..."],[2,"...RR......RR..."]],
      halo:[[0,"....YYYYYYYY...."],[1,"...Y........Y..."],[2,"....YYYYYYYY...."]],
      antenna:[[0,".......Y........"],[1,".......K........"],[2,".......K........"]],
      mic:[[10,"...........KK..."],[11,"...........KGK.."],[12,"............KK.."],[13,"............K..."]],
    },
    cheeks:[[8,"....P......P...."]],
  };
  const HEAD=[[3,"....KKKKKKKK...."],[4,"...KFFFFFFFFK..."],[5,"..KFFFFFFFFFFK.."],[6,"..KFFFFFFFFFFK.."],[7,"..KFFFFFFFFFFK.."],[8,"..KFFFFFFFFFFK.."],[9,"..KFFFFFFFFFFK.."],[10,"...KFFFFFFFFK..."],[11,"....KKKKKKKK...."],[12,"......KFFK......"]];
  const BODY=[[13,"...KKTTTTTTKK..."],[14,"..KTTTTTTTTTTK.."],[15,"..KTTTTTTTTTTK.."]];
  function over(g, layer){ layer.forEach(([y,row])=>{ if(row.length!==16) throw new Error("bad row "+row); [...row].forEach((c,x)=>{ if(c!==".") g[y][x]=c; }); }); }
  function build(o, blink){
    const g = Array.from({length:16},(_,y)=>Array.from({length:16},(_,x)=>((x-7.5)**2+(y-7.5)**2<=62?"B":".")));
    over(g, P.ears[o.ears||"none"]); over(g, BODY); over(g, HEAD);
    over(g, P.hair[o.hair||"none"]);
    // blink only for eyes you can see (not behind glasses); restore the face first
    if (blink && o.eyes!=="glasses" && o.eyes!=="shades") over(g, P.blink); else over(g, P.eyes[o.eyes||"dot"]);
    if (o.cheeks) over(g, P.cheeks);
    over(g, P.mouth[o.mouth||"smile"]); over(g, P.acc[o.acc||"none"]);
    return g.map(r=>r.join(""));
  }
  const SKIN=["#ffdcb8","#f2c9a0","#d9a47a","#b77a52","#8a5636","#5e3a24"];
  const FUR=["#ff9a3c","#f3e9ff","#a9a3c2","#8a5636","#ffd54a","#7cfc7c","#9b5cff","#22e0ff","#ff8fd0"];
  const HAIR=["#1b1030","#3b2414","#8a5636","#ffd54a","#ff2fb0","#22e0ff","#f3e9ff","#ff4d5e","#9b5cff"];
  const BG=["#3b1f6e","#123f5c","#5c1240","#1f4d2e","#5c3a12","#2a2440","#1a2a6e","#6e1f1f"];
  const ACC=["#ff2fb0","#22e0ff","#ffd54a","#7cfc7c","#ff4d5e","#9b5cff","#3b6bff"];
  const pick=a=>a[Math.floor(Math.random()*a.length)];

  // ----- what is allowed (used to clean anything a browser sends) -----
  const SHAPES = {
    ears: Object.keys(P.ears), hair: Object.keys(P.hair), eyes: Object.keys(P.eyes),
    mouth: Object.keys(P.mouth), acc: Object.keys(P.acc),
  };
  const COLORS = ["face", "hairc", "bg", "shirt", "accc", "inner"];
  const HEX = /^#[0-9a-fA-F]{6}$/;

  // Returns a safe avatar object, or null if `o` is not an avatar at all.
  function clean(o) {
    if (!o || typeof o !== "object") return null;
    const out = {};
    Object.keys(SHAPES).forEach((k) => { out[k] = SHAPES[k].includes(o[k]) ? o[k] : SHAPES[k][0]; });
    if (!SHAPES.eyes.includes(o.eyes)) out.eyes = "dot";
    if (!SHAPES.mouth.includes(o.mouth)) out.mouth = "smile";
    out.cheeks = !!o.cheeks;
    const def = { face: "#ffdcb8", hairc: "#1b1030", bg: "#3b1f6e", shirt: "#22e0ff", accc: "#ff2fb0", inner: "#ff8fd0" };
    COLORS.forEach((k) => { out[k] = HEX.test(String(o[k] || "")) ? String(o[k]).toLowerCase() : def[k]; });
    return out;
  }

  function random() {
    const animal = Math.random() < .45;
    const o = {
      ears: animal ? pick(["cat", "fox", "bunny", "bear", "mouse"]) : "none",
      hair: animal ? "none" : pick(["short", "fringe", "spiky", "long", "afro", "bun", "none"]),
      eyes: pick(SHAPES.eyes), mouth: pick(SHAPES.mouth),
      acc: pick(["none", "none", "headphones", "crown", "cap", "beanie", "bow", "horns", "halo", "antenna", "mic"]),
      cheeks: Math.random() < .4,
      face: animal ? pick(FUR) : pick(SKIN), hairc: pick(HAIR), bg: pick(BG), shirt: pick(ACC), accc: pick(ACC),
      inner: pick(["#ff8fd0", "#f3e9ff", "#1b1030"]),
    };
    if ((o.acc === "cap" || o.acc === "beanie") && ["afro", "bun", "spiky"].includes(o.hair)) o.hair = "short";
    if (o.acc === "headphones" && o.ears === "mouse") o.acc = "none";
    return o;
  }

  // Ready-made characters (same as the "Pixel Game Night" gallery).
  const PRESETS = [
    ["Chat DJ",{ears:"cat",eyes:"big",mouth:"cat",acc:"headphones",face:"#ff9a3c",bg:"#3b1f6e",shirt:"#22e0ff",cheeks:true}],
    ["Renard ruse",{ears:"fox",eyes:"shades",mouth:"smile",face:"#ff9a3c",inner:"#f3e9ff",bg:"#123f5c",shirt:"#ff2fb0"}],
    ["Lapin pop",{ears:"bunny",eyes:"happy",mouth:"open",acc:"bow",face:"#f3e9ff",bg:"#5c1240",shirt:"#9b5cff",cheeks:true}],
    ["Ours zouk",{ears:"bear",eyes:"dot",mouth:"smile",acc:"headphones",face:"#8a5636",inner:"#f2c9a0",bg:"#1f4d2e",shirt:"#ffd54a"}],
    ["Souris karaoke",{ears:"mouse",eyes:"big",mouth:"open",acc:"mic",face:"#a9a3c2",bg:"#2a2440",shirt:"#ff4d5e",cheeks:true}],
    ["Roi du blind test",{eyes:"star",mouth:"open",acc:"crown",hair:"short",face:"#d9a47a",hairc:"#1b1030",bg:"#5c3a12",shirt:"#9b5cff"}],
    ["Rappeur",{hair:"none",eyes:"shades",mouth:"flat",acc:"cap",face:"#8a5636",accc:"#ff4d5e",bg:"#6e1f1f",shirt:"#1b1030"}],
    ["Rockeuse",{hair:"long",eyes:"shades",mouth:"tongue",face:"#ffdcb8",hairc:"#ff2fb0",bg:"#2a2440",shirt:"#1b1030"}],
    ["Afro funk",{hair:"afro",eyes:"happy",mouth:"open",face:"#5e3a24",hairc:"#1b1030",bg:"#5c3a12",shirt:"#ffd54a",cheeks:true}],
    ["Danseuse",{hair:"bun",eyes:"big",mouth:"smile",face:"#f2c9a0",hairc:"#3b2414",bg:"#5c1240",shirt:"#22e0ff",cheeks:true}],
    ["Geek",{hair:"fringe",eyes:"glasses",mouth:"flat",face:"#ffdcb8",hairc:"#8a5636",bg:"#123f5c",shirt:"#7cfc7c"}],
    ["Petit diable",{hair:"spiky",eyes:"dot",mouth:"fang",acc:"horns",face:"#ff4d5e",hairc:"#1b1030",bg:"#6e1f1f",shirt:"#1b1030"}],
    ["Ange",{hair:"short",eyes:"happy",mouth:"smile",acc:"halo",face:"#ffdcb8",hairc:"#ffd54a",bg:"#1a2a6e",shirt:"#f3e9ff",cheeks:true}],
    ["Alien",{eyes:"big",mouth:"flat",acc:"antenna",face:"#7cfc7c",bg:"#2a2440",shirt:"#9b5cff"}],
    ["Robot",{eyes:"glasses",mouth:"flat",acc:"antenna",face:"#a9a3c2",bg:"#123f5c",shirt:"#3b6bff"}],
    ["Mamie disco",{hair:"bun",eyes:"glasses",mouth:"smile",face:"#d9a47a",hairc:"#f3e9ff",bg:"#3b1f6e",shirt:"#ff2fb0",cheeks:true}],
    ["Skater",{hair:"fringe",eyes:"dot",mouth:"tongue",acc:"beanie",face:"#b77a52",accc:"#22e0ff",bg:"#1f4d2e",shirt:"#ff9a3c"}],
    ["Dormeur",{hair:"spiky",eyes:"sleepy",mouth:"flat",acc:"headphones",face:"#f2c9a0",hairc:"#9b5cff",bg:"#1a2a6e",shirt:"#2a2440"}],
    ["Panda",{ears:"bear",eyes:"glasses",mouth:"cat",face:"#f3e9ff",inner:"#1b1030",bg:"#1f4d2e",shirt:"#7cfc7c"}],
    ["Chat noir",{ears:"cat",eyes:"big",mouth:"fang",face:"#2a2440",inner:"#ff2fb0",bg:"#5c1240",shirt:"#ffd54a"}],
    ["Lapin star",{ears:"bunny",eyes:"star",mouth:"open",acc:"crown",face:"#ffd54a",bg:"#5c3a12",shirt:"#ff2fb0"}],
    ["Mr. Discret",{hair:"short",eyes:"shades",mouth:"flat",acc:"cap",face:"#ffdcb8",accc:"#1b1030",bg:"#2a2440",shirt:"#2a2440"}],
    ["Chanteuse",{hair:"long",eyes:"happy",mouth:"open",acc:"mic",face:"#8a5636",hairc:"#1b1030",bg:"#3b1f6e",shirt:"#ffd54a",cheeks:true}],
    ["Gamer",{hair:"short",eyes:"dot",mouth:"smile",acc:"headphones",face:"#5e3a24",hairc:"#ff4d5e",bg:"#6e1f1f",shirt:"#22e0ff"}],
  ];
  const presets = PRESETS.map(([name, o]) => ({ name, parts: clean(o) }));

  // Colour of each letter of the grid for this avatar.
  const BASE = { K: "#0b0618", W: "#f3e9ff", P: "#ff2fb0", C: "#22e0ff", V: "#9b5cff", Y: "#ffd54a", G: "#2a2440", R: "#ff4d5e" };
  function palette(o) {
    return Object.assign({}, BASE, { B: o.bg, F: o.face, I: o.inner, H: o.hairc, T: o.shirt, A: o.accc });
  }

  // ----- browser only: draw to a PNG (cached) -----
  const cache = {};
  function url(o, opts) {
    if (typeof document === "undefined") return "";
    o = clean(o) || clean(presets[0].parts);
    const blink = !!(opts && opts.blink);
    const key = JSON.stringify(o) + blink;
    if (cache[key]) return cache[key];
    const rows = build(o, blink), pal = palette(o);
    const c = document.createElement("canvas"); c.width = c.height = 64;
    const x = c.getContext("2d");
    rows.forEach((row, y) => [...row].forEach((ch, xx) => {
      if (ch === ".") return;
      x.fillStyle = pal[ch] || "#000"; x.fillRect(xx * 4, y * 4, 4, 4);
    }));
    cache[key] = c.toDataURL("image/png");
    return cache[key];
  }
  // <img> HTML of an avatar, `size` px wide (round frame by default).
  function html(o, size, extraClass) {
    size = size || 40;
    return `<img class="px-av ${extraClass || ""}" src="${url(o)}" width="${size}" height="${size}" alt="" style="width:${size}px;height:${size}px">`;
  }

  // Short text code to copy / share an avatar ("PGN1:...").
  function encode(o) {
    try { return "PGN1:" + btoa(unescape(encodeURIComponent(JSON.stringify(clean(o))))); } catch (e) { return ""; }
  }
  function decode(s) {
    try { return clean(JSON.parse(decodeURIComponent(escape(atob(String(s).trim().replace(/^PGN1:/, "")))))); } catch (e) { return null; }
  }

  // Remembered on this device (the player's own avatar, for every game).
  const KEY = "gn_avatar";
  function load() { try { return clean(JSON.parse(localStorage.getItem(KEY))); } catch (e) { return null; } }
  function save(o) { try { localStorage.setItem(KEY, JSON.stringify(clean(o))); } catch (e) {} }
  // The player's avatar, created at random the first time.
  function mine() { let o = load(); if (!o) { o = random(); save(o); } return o; }

  return { clean, random, build, palette, url, html, encode, decode, load, save, mine, presets,
    SHAPES, COLORS, SKIN, FUR, HAIR, BG, ACC };
});
