// engine/music.js -- GENERIC music service for any music game (Kietkoutsa today).
//
// It talks to the public music catalogues so the browser never has to (no CORS
// trouble, no API key):
//   - Deezer first (best catalogue, 30s previews),
//   - iTunes Search as a FALLBACK when Deezer is down or finds nothing.
// Every track is normalised to the same small shape:
//   { id, title, artist, cover, preview, link, explicit, source }
// The id carries its source ("dz:123" / "it:456") so we can re-fetch a fresh
// preview later (preview links can expire).
//
// It also exposes:
//   - charts()        -> trending tracks (for "suggestions" in the search UI)
//   - refresh(track)  -> a fresh preview URL for a track (or null)
//   - isAllowedUrl(u) -> true only for real Deezer / Apple media hosts
//   - mount(app)      -> plugs the HTTP routes into the Express app
//
// Nothing here knows about any game's rules.

const { Readable } = require("stream");

// Media hosts we accept for previews / covers (anything else is refused).
const ALLOWED_HOSTS = ["dzcdn.net", "deezer.com", "mzstatic.com", "apple.com"];

function isAllowedUrl(u) {
  try {
    const url = new URL(String(u));
    if (url.protocol !== "https:" && url.protocol !== "http:") return false;
    const h = url.hostname.toLowerCase();
    return ALLOWED_HOSTS.some((d) => h === d || h.endsWith("." + d));
  } catch (e) {
    return false;
  }
}

// fetch() + JSON with a timeout, so a slow catalogue never blocks a game.
async function getJson(url, ms) {
  if (typeof fetch !== "function") throw new Error("no fetch");
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms || 4000);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

function fromDeezer(t) {
  return {
    id: "dz:" + t.id,
    title: t.title || "?",
    artist: (t.artist && t.artist.name) || "",
    cover: (t.album && (t.album.cover_medium || t.album.cover)) || "",
    preview: t.preview || "",
    link: t.link || ("https://www.deezer.com/track/" + t.id),
    explicit: !!t.explicit_lyrics,
    source: "deezer",
  };
}
function fromItunes(t) {
  return {
    id: "it:" + t.trackId,
    title: t.trackName || "?",
    artist: t.artistName || "",
    // iTunes gives 100x100 artwork; the same URL pattern serves bigger sizes.
    cover: (t.artworkUrl100 || "").replace("100x100bb", "250x250bb"),
    preview: t.previewUrl || "",
    link: t.trackViewUrl || "",
    explicit: t.trackExplicitness === "explicit",
    source: "itunes",
  };
}
const usable = (t) => t && t.preview && isAllowedUrl(t.preview);

async function searchDeezer(q) {
  const j = await getJson("https://api.deezer.com/search?limit=14&q=" + encodeURIComponent(q));
  return (j.data || []).map(fromDeezer).filter(usable);
}
async function searchItunes(q) {
  const j = await getJson("https://itunes.apple.com/search?media=music&entity=song&limit=14&term=" + encodeURIComponent(q));
  return (j.results || []).map(fromItunes).filter(usable);
}

// Deezer first; iTunes only if Deezer fails or returns nothing.
async function search(q) {
  q = String(q || "").trim().slice(0, 100);
  if (!q) return [];
  try {
    const r = await searchDeezer(q);
    if (r.length) return r;
  } catch (e) { /* fall through to iTunes */ }
  try { return await searchItunes(q); } catch (e) { return []; }
}

// Trending tracks, cached 10 minutes (they barely change).
let chartsCache = { at: 0, list: [] };
async function charts() {
  if (Date.now() - chartsCache.at < 10 * 60 * 1000 && chartsCache.list.length) return chartsCache.list;
  let list = [];
  try {
    const j = await getJson("https://api.deezer.com/chart/0/tracks?limit=20");
    list = (j.data || []).map(fromDeezer).filter(usable);
  } catch (e) {}
  if (!list.length) { try { list = await searchItunes("top hits"); } catch (e) {} }
  if (list.length) chartsCache = { at: Date.now(), list };
  return list;
}

// Ask the catalogue again for a track's preview (links can expire after a while).
// Returns the fresh URL, or null if we could not get one (keep the old one then).
async function refresh(track) {
  const id = String((track && track.id) || "");
  try {
    if (id.startsWith("dz:")) {
      const j = await getJson("https://api.deezer.com/track/" + encodeURIComponent(id.slice(3)), 2500);
      return usable(j) ? j.preview : null;
    }
    if (id.startsWith("it:")) {
      const j = await getJson("https://itunes.apple.com/lookup?id=" + encodeURIComponent(id.slice(3)), 2500);
      const t = (j.results || [])[0];
      return t && usable({ preview: t.previewUrl }) ? t.previewUrl : null;
    }
  } catch (e) {}
  return null;
}

// Cleans a track sent by a browser: keeps only known fields, checks the URLs.
// Returns null if the track is not acceptable (no preview / unknown host).
function sanitizeTrack(t) {
  if (!t || typeof t !== "object") return null;
  const preview = String(t.preview || "");
  if (!isAllowedUrl(preview)) return null;
  const cover = String(t.cover || "");
  const link = String(t.link || "");
  return {
    id: String(t.id || "").slice(0, 40),
    title: String(t.title || "?").slice(0, 120),
    artist: String(t.artist || "").slice(0, 120),
    cover: isAllowedUrl(cover) ? cover : "",
    preview,
    link: isAllowedUrl(link) ? link : "",
    explicit: !!t.explicit,
    source: t.source === "itunes" ? "itunes" : "deezer",
  };
}

// ---------- tiny per-IP rate limiter (anti-abuse) ----------
// A "token bucket": each IP has `burst` tokens, refilled at `perSec` per second;
// each request spends one. No token left -> HTTP 429 ("too many requests").
function rateLimiter(burst, perSec) {
  const buckets = new Map();
  setInterval(() => { // forget idle IPs so the map never grows forever
    const now = Date.now();
    for (const [k, b] of buckets) if (now - b.t > 60000) buckets.delete(k);
  }, 60000).unref();
  return (req, res, next) => {
    const k = req.ip || "?";
    const now = Date.now();
    const b = buckets.get(k) || { tokens: burst, t: now };
    b.tokens = Math.min(burst, b.tokens + ((now - b.t) / 1000) * perSec);
    b.t = now;
    if (b.tokens < 1) { buckets.set(k, b); return res.status(429).json({ results: [], error: "Trop de recherches, attends une seconde." }); }
    b.tokens -= 1;
    buckets.set(k, b);
    next();
  };
}

// ---------- HTTP routes ----------
function mount(app) {
  // Generous: several phones on the same Wi-Fi share ONE public IP.
  const searchLimit = rateLimiter(20, 4);  // 20 quick searches, then 4 per second
  const proxyLimit = rateLimiter(20, 1);

  // GET /api/music/search?q=...  -> { results: [track...] }
  app.get("/api/music/search", searchLimit, async (req, res) => {
    res.json({ results: await search(req.query.q) });
  });

  // GET /api/music/charts -> { results: [track...] } (trending suggestions)
  app.get("/api/music/charts", searchLimit, async (req, res) => {
    res.json({ results: await charts() });
  });

  // GET /api/music/preview?u=<preview url>
  // Streams a preview THROUGH our server, so the host page gets it from its own
  // origin: that lets the browser analyse the sound (real visualiser) without
  // the CORS restriction. Only Deezer/Apple media URLs are accepted (otherwise
  // anyone could use our server as a free proxy), and the size is capped.
  app.get("/api/music/preview", proxyLimit, async (req, res) => {
    const u = String(req.query.u || "");
    if (!isAllowedUrl(u) || typeof fetch !== "function") return res.status(400).end();
    try {
      // "Range" = "send me only the bytes from X to Y". The browser asks for it
      // when it jumps to a precise second (e.g. the host screen reloads mid-round
      // and must resume at 0:12). We pass it on to Deezer/Apple and send back
      // their partial answer (HTTP 206), so seeking works through the proxy.
      const headers = {};
      if (req.headers.range) headers.Range = req.headers.range;
      const r = await fetch(u, { headers });
      if (!r.ok || !r.body) return res.status(502).end();
      res.status(r.status === 206 ? 206 : 200);
      res.setHeader("Content-Type", r.headers.get("content-type") || "audio/mpeg");
      res.setHeader("Cache-Control", "public, max-age=600");
      res.setHeader("Accept-Ranges", r.headers.get("accept-ranges") || "bytes");
      const len = r.headers.get("content-length");
      if (len) res.setHeader("Content-Length", len);
      const range = r.headers.get("content-range");
      if (range) res.setHeader("Content-Range", range);
      let sent = 0;
      const MAX = 4 * 1024 * 1024; // 4 MB is far above any 30s preview
      const stream = Readable.fromWeb(r.body);
      stream.on("data", (chunk) => { sent += chunk.length; if (sent > MAX) stream.destroy(); });
      stream.on("error", () => res.end());
      stream.pipe(res);
    } catch (e) {
      res.status(502).end();
    }
  });
}

module.exports = { mount, search, charts, refresh, isAllowedUrl, sanitizeTrack };
