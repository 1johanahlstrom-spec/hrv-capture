// ════════════════════════════════════════════════════════════════════════════
// SERVICE WORKER — offline-cachning av HRV capture-sidan (ROBUSTHET, ej DSP).
//
// VARFÖR: capture-sidan (index.html) laddas från GitHub Pages via TWA. Är nätet
// nere eller Pages otillgängligt laddar sidan inte → ingen mätning. Denna SW
// cachar sidan så en mätning fungerar offline / när Pages är nere.
//
// VAD den rör: BARA laddningen av denna self-contained HTML. All CSS/JS/filter
// (Butterworth bp2/bp4/af/ff/detrend) är INLINE → EN enda fil, inga separata
// assets att cacha. Den rör INTE:
//   • rå R/G/B → native: deep-linken `hrvresult://raw?...` är ett CUSTOM-SCHEME.
//     Service-workers avlyssnar bara http(s) → den går rakt till OS/native,
//     aldrig genom denna SW. Dataflödet till native är strukturellt orört.
//   • DSP/SQI/gate: körs native i APK:n, aldrig här.
//   • DAL (.well-known/assetlinks.json): undantas uttryckligen i fetch-handlern
//     nedan → DAL förblir nät-färsk även när SW:ns scope är origin-roten.
//     Produktions-DAL uppdaterades med release-certifikatet 2026-07-04.
//
// CACHE-BUSTER-SAMSPEL (viktigt): TWA:n laddar `…/?t=<tidsstämpel>&
// dur=…&breath=…` — `?t` är unik per mätning (tvingar Chrome till en FÄRSK
// navigering så window.load fyrar → ny capture). Därför MÅSTE matchningen nedan
// använda { ignoreSearch:true } — annars missar cachen ALLTID (URL:en upprepas
// aldrig) och offline slutar fungera. Cache-bustern jobbar på navigerings-/
// flik-nivå (färskt dokument), SW:n på resurs-byte-nivå (cachad kropp) → de är
// ortogonala och fungerar tillsammans.
//
// ⚠️ UPPDATERINGS-DISCIPLIN (den klassiska SW-fällan — LÄS DETTA):
//   När du ändrar index.html MÅSTE du BUMPA CACHE_VERSION nedan (v1 → v2 → …).
//   Då händer:
//     1. Chrome byte-jämför sw.js vid nästa start (registreringen sätter
//        updateViaCache:'none' → förbi HTTP-cachen) → ser ändringen → installerar
//        nya SW:n.
//     2. install() precachar FÄRSK index.html i nya cachen (hrv-capture-vN).
//     3. activate() raderar gamla cachen → nästa mätning serverar nya sidan.
//   GLÖMMER du bumpa → användaren sitter kvar på GAMMAL cachad sida för evigt.
// ════════════════════════════════════════════════════════════════════════════

// ⬇️⬇️ BUMPA denna vid VARJE ändring av index.html (se disciplin ovan). ⬇️⬇️
const CACHE_VERSION = 'hrv-capture-v13';
// Prefix → activate() raderar bara capture-appens gamla cacher.
const CACHE_PREFIX = 'hrv-capture-';

// Scope-sökväg härledd ur sw.js:ens egen URL (på custom-domänen är den '/').
const SCOPE_PATH = self.location.pathname.replace(/sw\.js$/, '');
const SW_PATH = self.location.pathname; // '/sw.js'

// Precache: den navigerade sidan. Både dir-index ('/') och '/index.html'.
const PRECACHE_URLS = ['./', './index.html'];

// ── INSTALL: precacha sidan ─────────────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_VERSION);
    await cache.addAll(PRECACHE_URLS);
    // Aktivera direkt. SÄKERT här: sidan är EN self-contained fil → ingen
    // html-vs-asset-skew (den risk som annars gör skipWaiting vansklig). Ger
    // snabbare uppdaterings-genomslag. (Lägger någon framöver SEPARATA assets
    // → omvärdera skipWaiting.)
    await self.skipWaiting();
  })());
});

// ── ACTIVATE: rensa gamla cache-versioner + ta kontroll ─────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(
      names
        .filter((n) => n.startsWith(CACHE_PREFIX) && n !== CACHE_VERSION)
        .map((n) => caches.delete(n)),
    );
    await self.clients.claim(); // ta kontroll över redan öppna klienter direkt
  })());
});

// ── FETCH: cache-first för capture-sidan, annars orört ──────────────────────
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // bara GET
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // cross-origin → orört
  if (!url.pathname.startsWith(SCOPE_PATH)) return; // utanför scope → orört
  if (url.pathname.startsWith('/.well-known/')) return; // DAL måste alltid gå direkt till nätet
  if (url.pathname === SW_PATH) return; // ALDRIG cacha sw.js (uppdateringar måste vara färska)
  event.respondWith(cacheFirst(req));
});

// Cache-first: servera cachad sida (ignoreSearch → cache-buster ?t / ?dur
// ignoreras vid matchning), fall annars tillbaka till nät, och nät-fel →
// precachad sida som sista offline-utväg. Skriver ALDRIG navigerings-svar med
// unik query till cachen (cache-bustern skulle annars få cachen att växa
// obegränsat) — precachen täcker redan sidan, så en träff sker här.
async function cacheFirst(req) {
  const cache = await caches.open(CACHE_VERSION);
  const cached = await cache.match(req, { ignoreSearch: true });
  if (cached) return cached;
  try {
    return await fetch(req); // ej precachad (online) → nät
  } catch (err) {
    // Offline + ej i cachen → sista utväg: den precachade sidan.
    const fallback =
      (await cache.match('./index.html', { ignoreSearch: true })) ||
      (await cache.match('./', { ignoreSearch: true }));
    if (fallback) return fallback;
    throw err; // inget att ge → låt browsern visa sitt fel (= som utan SW)
  }
}
