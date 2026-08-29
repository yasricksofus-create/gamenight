// theme.js -- Apply a game's "DA" (art direction) to the current page.
//
// Each game defines a set of colors in games.js. Here we push those colors into
// CSS variables on the page's root element, so the whole room instantly takes
// on that game's look. Shared by the host and player pages.
function applyTheme(theme) {
  if (!theme) return;
  const root = document.documentElement;
  root.style.setProperty("--primary", theme.primary);
  root.style.setProperty("--secondary", theme.secondary);
  root.style.setProperty("--background", theme.background);
  root.style.setProperty("--text", theme.text);
}
