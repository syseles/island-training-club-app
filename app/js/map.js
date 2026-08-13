// ==========================================================================
// ITC prototype — Leaflet + Nominatim wiring for free-event venue maps.
//
// The module owns:
// - lazy Leaflet loading with pinned CDN URLs, integrity, and a
//   session-scoped failure cache;
// - serialized Nominatim lookup with a localStorage cache;
// - the route-safe mount() entry point invoked by app.js once the
//   Activity route HTML is committed.
//
// It has no DOM access at import time and does not import the store or
// views. Pure helpers are exported for smoke coverage.
// ==========================================================================

const CACHE_KEY = "itc.geocode.v1";
const LEAFLET_CSS = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
const LEAFLET_CSS_INTEGRITY = "sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=";
const LEAFLET_JS = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
const LEAFLET_JS_INTEGRITY = "sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=";
const FALLBACK_COPY = "Couldn't find the venue on the map — tap Get directions instead.";
const LEAFLET_TIMEOUT_MS = 5000;
const NOMINATIM_TIMEOUT_MS = 5000;

let leafletLoadPromise = null;
let leafletLoadFailed = false;
let activeGeocode = Promise.resolve();
const geocodeInFlight = new Map();
let leafletLoaded = false;

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function parseCoordinate(value) {
  const parsed = Number(value);
  return isFiniteNumber(parsed) ? parsed : null;
}

export function parseGeocodeCache(raw) {
  let parsed;
  try {
    parsed = raw ? JSON.parse(raw) : null;
  } catch (_err) {
    return {};
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  const out = {};
  for (const [query, coords] of Object.entries(parsed)) {
    if (!coords || typeof coords !== "object") continue;
    const lat = parseCoordinate(coords.lat);
    const lon = parseCoordinate(coords.lon);
    if (lat === null || lon === null) continue;
    out[query] = { lat, lon };
  }
  return out;
}

export function normalizeGeocodeResult(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const first = rows[0];
  if (!first || typeof first !== "object") return null;
  const lat = parseCoordinate(first.lat);
  const lon = parseCoordinate(first.lon);
  if (lat === null || lon === null) return null;
  return { lat, lon };
}

function readCache() {
  if (typeof localStorage === "undefined") return {};
  try {
    return parseGeocodeCache(localStorage.getItem(CACHE_KEY));
  } catch (_err) {
    return {};
  }
}

function writeCache(cache) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch (_err) {
    // Ignore quota / private-mode failures; the in-memory result still serves this page.
  }
}

function lookupCache(query) {
  const cache = readCache();
  return cache[query] || null;
}

function storeCache(query, coords) {
  const cache = readCache();
  cache[query] = coords;
  writeCache(cache);
}

async function fetchNominatim(query, { fetchImpl = globalThis.fetch, timeoutMs = NOMINATIM_TIMEOUT_MS } = {}) {
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query)}`;
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const response = await fetchImpl(url, controller ? { signal: controller.signal } : undefined);
    if (!response || !response.ok) return null;
    const rows = await response.json();
    return normalizeGeocodeResult(rows);
  } catch (_err) {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function geocodeQuery(query, options) {
  if (!query) return null;
  const cached = lookupCache(query);
  if (cached) return cached;
  if (geocodeInFlight.has(query)) return geocodeInFlight.get(query);
  const task = activeGeocode.then(() => fetchNominatim(query, options));
  geocodeInFlight.set(query, task);
  activeGeocode = task.finally(() => geocodeInFlight.delete(query));
  const result = await task;
  if (result) storeCache(query, result);
  return result;
}

function loadLeafletAsset(tag, attrs) {
  return new Promise((resolve, reject) => {
    const existing = document.head.querySelector(`${tag}[data-itc-leaflet="${attrs.integrity}"]`);
    if (existing) {
      if (existing.dataset.itcLeafletReady === "true") return resolve();
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("Leaflet asset failed to load")), { once: true });
      return;
    }
    const el = document.createElement(tag);
    el.dataset.itcLeaflet = attrs.integrity;
    el.crossOrigin = "anonymous";
    if (tag === "link") el.rel = "stylesheet";
    el.integrity = attrs.integrity;
    if (attrs.href) el.href = attrs.href;
    if (attrs.src) el.src = attrs.src;
    el.addEventListener("load", () => {
      el.dataset.itcLeafletReady = "true";
      resolve();
    }, { once: true });
    el.addEventListener("error", () => reject(new Error("Leaflet asset failed to load")), { once: true });
    document.head.appendChild(el);
  });
}

async function defaultLoadLeaflet({ timeoutMs = LEAFLET_TIMEOUT_MS } = {}) {
  if (leafletLoaded) return;
  if (leafletLoadFailed) throw new Error("Leaflet previously failed to load");
  if (leafletLoadPromise) return leafletLoadPromise;
  leafletLoadPromise = (async () => {
    let timer;
    try {
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("Leaflet load timed out")), timeoutMs);
      });
      await Promise.race([
        Promise.all([
          loadLeafletAsset("link", { href: LEAFLET_CSS, integrity: LEAFLET_CSS_INTEGRITY }),
          loadLeafletAsset("script", { src: LEAFLET_JS, integrity: LEAFLET_JS_INTEGRITY }),
        ]),
        timeout,
      ]);
      clearTimeout(timer);
      if (typeof globalThis.L === "undefined") {
        throw new Error("Leaflet global not available after script load");
      }
      leafletLoaded = true;
    } catch (err) {
      leafletLoadFailed = true;
      throw err;
    } finally {
      leafletLoadPromise = null;
    }
  })();
  return leafletLoadPromise;
}

function renderFallback(host) {
  if (!host) return;
  host.innerHTML = `<p class="muted small activity-map-fallback" role="status">${FALLBACK_COPY}</p>`;
}

function safeApply(fn) {
  try { fn(); } catch (_err) { /* swallow — see renderFallback path */ }
}

export async function mountActivityMap(host, options = {}) {
  const { ownsGeneration = () => true, fetchImpl, timeoutMs, loadLeaflet } = options;
  if (!host || host.id !== "activity-map") return false;
  const query = String(host.dataset.mapsQuery || "").trim();
  if (!query) return false;
  const coords = await geocodeQuery(query, { fetchImpl, timeoutMs });
  if (!coords) {
    if (ownsGeneration() && host.isConnected) renderFallback(host);
    return false;
  }
  try {
    await (loadLeaflet || defaultLoadLeaflet)({ timeoutMs: timeoutMs || LEAFLET_TIMEOUT_MS });
  } catch (_err) {
    if (ownsGeneration() && host.isConnected) renderFallback(host);
    return false;
  }
  if (!ownsGeneration() || !host.isConnected) return false;
  const label = String(host.dataset.markerLabel || query);
  safeApply(() => {
    if (!ownsGeneration() || !host.isConnected) return;
    host.innerHTML = "";
    const map = globalThis.L.map(host, { scrollWheelZoom: false });
    map.setView([coords.lat, coords.lon], 15);
    globalThis.L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);
    const marker = globalThis.L.marker([coords.lat, coords.lon]).addTo(map);
    const popup = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = label;
    popup.appendChild(title);
    marker.bindPopup(popup);
  });
  return true;
}

export const __test = { FALLBACK_COPY, CACHE_KEY };