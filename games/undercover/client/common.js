// undercover-common.js -- Shared helpers for the Undercover client (host + player).

// Per-mode color palettes (the adaptive "DA"). We reuse applyTheme() from
// theme.js, which sets the CSS color variables the whole page reads.
window.UC_THEMES = {
  marine: { primary: "#2f7fb3", secondary: "#0d9488", background: "#07293b", text: "#e6f6ff" },
  gold: { primary: "#B4872E", secondary: "#9E2B1E", background: "#12100D", text: "#F1E6C9" },
  ring: { primary: "#d21f3c", secondary: "#f0a500", background: "#1a0d0d", text: "#fff1e6" },
};
// Optional background image per theme. Drop the files in public/themes/ ; if a
// file is missing, only the dark tint over the base color shows (no broken icon).
window.UC_BG = {
  marine: "/themes/marine.jpg",
  gold: "/themes/gold.jpg",
  ring: "/themes/ring.jpg",
};
window.applyUcTheme = function (key) {
  const palette = window.UC_THEMES[key];
  if (palette && typeof applyTheme === "function") applyTheme(palette);
  const img = window.UC_BG[key];
  if (img) {
    // A dark gradient sits on top of the image so the text stays readable.
    document.body.style.backgroundImage =
      'linear-gradient(rgba(0,0,0,0.62), rgba(0,0,0,0.62)), url("' + img + '")';
    document.body.style.backgroundSize = "cover";
    document.body.style.backgroundPosition = "center";
    document.body.style.backgroundAttachment = "fixed";
    document.body.style.backgroundRepeat = "no-repeat";
  }
};

// Fetch a character's image URL from AniList (browser-side; the sandbox can't,
// but real browsers and the Render server can). Cached; returns null on failure.
const _ucImgCache = {};
// series = words of the character's series title ("fairytail", "chainsawman|csm"):
// AniList gives up to 10 characters with that name, we keep the one who appears
// in that series (before, "Happy" or "Power" could show a stranger).
window.ucAnimeImage = async function (name, series) {
  const key = name + "|" + (series || "");
  if (_ucImgCache[key] !== undefined) return _ucImgCache[key];
  const flat = (t) => String(t || "").toLowerCase().normalize("NFD").replace(/[^a-z0-9]/g, "");
  try {
    const res = await fetch("https://graphql.anilist.co", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        query: "query($s:String){Page(perPage:10){characters(search:$s){image{large} media(perPage:6){nodes{title{romaji english}}}}}}",
        variables: { s: name },
      }),
    });
    const j = await res.json();
    const list = (j && j.data && j.data.Page && j.data.Page.characters) || [];
    const words = String(series || "").split("|").filter(Boolean);
    const inSeries = (c) => (c.media && c.media.nodes || []).some((m) =>
      words.some((w) => flat(m.title && m.title.romaji).includes(w) || flat(m.title && m.title.english).includes(w)));
    const best = (words.length && list.find(inSeries)) || (words.length ? null : list[0]);
    _ucImgCache[key] = (best && best.image && best.image.large) || null;
  } catch (e) {
    _ucImgCache[key] = null;
  }
  return _ucImgCache[key];
};

window.ucRoleLabel = function (role) {
  if (role === "undercover") return "Undercover";
  if (role === "mrwhite") return "Mr. White";
  return "Civil";
};

// Phone vibration (Android; iPhones do not let websites vibrate).
window.ucBuzz = function (pattern) {
  try { if (navigator.vibrate && !document.hidden) navigator.vibrate(pattern || 80); } catch (e) {}
};

// "Comment jouer ?" pop-up (host screen and phones).
window.ucHowTo = function () {
  const old = document.getElementById("uc-howto");
  if (old) { old.remove(); return; }
  const m = document.createElement("div");
  m.id = "uc-howto"; m.className = "uc-overlay show";
  m.innerHTML = `<div class="uc-sheet" role="dialog" aria-modal="true" aria-label="Comment jouer">
    <h2>Comment jouer ?</h2>
    <p><b>1.</b> Chacun reçoit une carte secrète. Les <b>civils</b> ont tous la même ; l'<b>undercover</b> a une carte proche mais différente (et il ne sait pas qu'il est l'undercover !). <b>Mr. White</b> n'a rien.</p>
    <p><b>2.</b> Chacun son tour, donne <b>un indice à l'oral</b> sur ta carte, sans la dire.</p>
    <p><b>3.</b> Tout le monde vote : qui est l'imposteur ? Le plus voté est éliminé (et peut avoir une dernière parole).</p>
    <p><b>4.</b> Les civils gagnent s'ils éliminent tous les imposteurs. Les imposteurs gagnent s'ils sont aussi nombreux que les civils. Mr. White éliminé peut voler la victoire en devinant la carte des civils.</p>
    <button class="uc-btn" type="button">OK</button></div>`;
  m.onclick = (e) => { if (e.target === m || e.target.tagName === "BUTTON") m.remove(); };
  document.body.appendChild(m);
};
