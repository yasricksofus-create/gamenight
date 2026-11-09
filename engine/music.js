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
    coverSmall: (t.album && (t.album.cover_small || t.album.cover_medium)) || "", // 56 px, for lists
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
    coverSmall: (t.artworkUrl100 || "").replace("100x100bb", "60x60bb"),
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

// ---------- small in-memory caches (LRU = forget the oldest when full) ----------
function lru(max, ttlMs) {
  const m = new Map();
  return {
    get(k) {
      const e = m.get(k);
      if (!e) return undefined;
      if (ttlMs && Date.now() - e.t > ttlMs) { m.delete(k); return undefined; }
      m.delete(k); m.set(k, e); // mark as recently used
      return e.v;
    },
    set(k, v) { m.delete(k); m.set(k, { v, t: Date.now() }); while (m.size > max) m.delete(m.keys().next().value); },
  };
}
// Same search within 5 min (5 players clicking "Zouk") = answered from memory.
const searchCache = lru(150, 5 * 60 * 1000);

// Deezer first. If Deezer is slow (> 1.5 s), iTunes is asked IN PARALLEL and
// the first useful answer wins (Deezer still wins if both arrive).
async function searchFresh(q) {
  const dz = searchDeezer(q).catch(() => []);
  const slow = new Promise((r) => setTimeout(() => r("slow"), 1500));
  const first = await Promise.race([dz, slow]);
  if (first !== "slow") {
    if (first.length) return first;
    return searchItunes(q).catch(() => []); // Deezer answered but found nothing
  }
  const it = searchItunes(q).catch(() => []);
  const [a, b] = await Promise.all([dz, it]);
  return a.length ? a : b;
}
async function search(q) {
  q = String(q || "").trim().slice(0, 100);
  if (!q) return [];
  const key = q.toLowerCase();
  const hit = searchCache.get(key);
  if (hit) return hit;
  const r = await searchFresh(q);
  if (r.length) searchCache.set(key, r);
  return r;
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
  const coverSmall = String(t.coverSmall || "");
  const link = String(t.link || "");
  return {
    id: String(t.id || "").slice(0, 40),
    title: String(t.title || "?").slice(0, 120),
    artist: String(t.artist || "").slice(0, 120),
    cover: isAllowedUrl(cover) ? cover : "",
    coverSmall: isAllowedUrl(coverSmall) ? coverSmall : "",
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

// ---------- previews kept in memory ----------
// The last ~30 previews (a 30 s preview is ~0.3-1 MB). A game can "warm" the
// next songs in advance (warm(url)): when the host screen asks for them, they
// are already here and start instantly.
const previewCache = lru(30, 30 * 60 * 1000);
const inflight = new Map(); // url -> download already running
const MAX_PREVIEW = 4 * 1024 * 1024;
function warm(u) {
  if (!isAllowedUrl(u) || typeof fetch !== "function") return Promise.resolve(null);
  const hit = previewCache.get(u);
  if (hit) return Promise.resolve(hit);
  if (inflight.has(u)) return inflight.get(u);
  const p = (async () => {
    try {
      const r = await fetch(u);
      if (!r.ok) return null;
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length > MAX_PREVIEW) return null;
      const item = { buf, type: r.headers.get("content-type") || "audio/mpeg" };
      previewCache.set(u, item);
      return item;
    } catch (e) { return null; } finally { inflight.delete(u); }
  })();
  inflight.set(u, p);
  return p;
}

// Deezer preview links carry an expiry date ("exp=<seconds>"). True if the link
// must be refreshed (expires within `withinMs`). Links without a date (iTunes)
// never need it.
function needsRefresh(u, withinMs) {
  const m = /exp=(\d{9,11})/.exec(String(u || ""));
  if (!m) return false;
  return parseInt(m[1], 10) * 1000 - Date.now() < (withinMs || 0);
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
  // Last ~30 previews kept in memory (a 30 s preview is ~0.3-1 MB): replays,
  // reconnections and the "preload next song" never re-download from Deezer.
  // GET /api/music/preview?u=<preview url>
  // Serves a preview THROUGH our server, so the host page gets it from its own
  // origin: that lets the browser analyse the sound (real visualiser) without
  // the CORS restriction. Only Deezer/Apple media URLs are accepted (otherwise
  // anyone could use our server as a free proxy).
  //  - Already in memory (see warm()): answered at once, "Range" included
  //    (Range = "only bytes X to Y", used to jump to a precise second).
  //  - Not in memory yet: the sound is STREAMED straight from Deezer as it
  //    arrives (it starts playing right away), and a copy is saved in parallel
  //    for the next time.
  app.get("/api/music/preview", proxyLimit, async (req, res) => {
    const u = String(req.query.u || "");
    if (!isAllowedUrl(u) || typeof fetch !== "function") return res.status(400).end();
    res.setHeader("Cache-Control", "public, max-age=600");
    res.setHeader("Accept-Ranges", "bytes");
    const item = previewCache.get(u);
    const m = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || ""));
    if (item) {
      const total = item.buf.length;
      res.setHeader("Content-Type", item.type);
      if (m && (m[1] || m[2])) {
        let start = m[1] ? parseInt(m[1], 10) : total - parseInt(m[2], 10);
        let end = m[1] && m[2] ? parseInt(m[2], 10) : total - 1;
        start = Math.max(0, start); end = Math.min(total - 1, end);
        if (start > end) { res.setHeader("Content-Range", "bytes */" + total); return res.status(416).end(); }
        res.status(206);
        res.setHeader("Content-Range", `bytes ${start}-${end}/${total}`);
        res.setHeader("Content-Length", end - start + 1);
        return res.end(item.buf.subarray(start, end + 1));
      }
      res.setHeader("Content-Length", total);
      return res.end(item.buf);
    }
    // not in memory: stream it now, keep a copy for later (in the background)
    warm(u);
    try {
      const headers = {};
      if (req.headers.range) headers.Range = req.headers.range;
      const r = await fetch(u, { headers });
      if (!r.ok || !r.body) return res.status(502).end();
      res.status(r.status === 206 ? 206 : 200);
      res.setHeader("Content-Type", r.headers.get("content-type") || "audio/mpeg");
      ["content-length", "content-range"].forEach((h) => { const v = r.headers.get(h); if (v) res.setHeader(h, v); });
      const reader = r.body.getReader();
      req.on("close", () => { try { reader.cancel(); } catch (e) {} });
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!res.write(Buffer.from(value))) await new Promise((ok) => res.once("drain", ok));
      }
      res.end();
    } catch (e) {
      if (!res.headersSent) res.status(502);
      res.end();
    }
  });
}

module.exports = { mount, search, charts, refresh, isAllowedUrl, sanitizeTrack, warm, needsRefresh };
