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
window.ucAnimeImage = async function (name) {
  if (_ucImgCache[name] !== undefined) return _ucImgCache[name];
  try {
    const res = await fetch("https://graphql.anilist.co", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        query: "query($s:String){Character(search:$s){image{large}}}",
        variables: { s: name },
      }),
    });
    const j = await res.json();
    const url = j && j.data && j.data.Character && j.data.Character.image
      ? j.data.Character.image.large : null;
    _ucImgCache[name] = url || null;
  } catch (e) {
    _ucImgCache[name] = null;
  }
  return _ucImgCache[name];
};

window.ucRoleLabel = function (role) {
  if (role === "undercover") return "Undercover";
  if (role === "mrwhite") return "Mr. White";
  return "Civil";
};
