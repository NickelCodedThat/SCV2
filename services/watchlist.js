// LIVE EARTH's saved-events ("watchlist") persistence — browser localStorage
// only, no account/backend. Scoped to normalized GlobalEvents (see
// models/global-event.js): the one shape that already covers earthquakes,
// wildfires, volcanoes, floods, and cyclones consistently. Every read/write
// is defensive — corrupt JSON, blocked storage, or a quota error degrade to
// "storage unavailable" rather than throwing into the UI.
const STORAGE_KEY = "storm-chaser:watchlist:v1";
const SCHEMA_VERSION = 1;

export function getWatchlist() {
  return loadRaw().items.map((item) => Object.freeze({ ...item }));
}

export function isSaved(eventId) {
  if (!eventId) return false;
  return loadRaw().items.some((item) => item.id === eventId);
}

export function findSavedEntry(eventId) {
  return loadRaw().items.find((item) => item.id === eventId) || null;
}

/**
 * Saves a compact snapshot of a normalized GlobalEvent — never the raw
 * object — so a saved event can still render (with an "Archived" status)
 * after it drops out of the live feed. No-ops (returns true) if already
 * saved, so callers can treat save as idempotent.
 */
export function saveEvent(event) {
  if (!event?.id) return false;

  const data = loadRaw();
  if (data.items.some((item) => item.id === event.id)) return true;

  data.items.push({
    id: event.id,
    provider: event.provider,
    category: event.category,
    savedAt: new Date().toISOString(),
    snapshot: buildSnapshot(event),
  });
  return saveRaw(data);
}

export function removeEvent(eventId) {
  const data = loadRaw();
  const nextItems = data.items.filter((item) => item.id !== eventId);
  if (nextItems.length === data.items.length) return true; // nothing to remove
  return saveRaw({ ...data, items: nextItems });
}

export function buildSnapshot(event) {
  return {
    title: event.title,
    position: event.position ? { lat: event.position.lat, lon: event.position.lon } : null,
    place: event.region?.place || "",
    countries: event.region?.countries || [],
    displayPriority: event.severity?.displayPriority || "advisory",
    providerLevel: event.severity?.providerLevel || null,
    providerLabel: event.severity?.providerLabel || null,
    keyMeasurement: describeKeyMeasurement(event),
    eventAt: toIsoOrNull(event.time?.eventAt),
    updatedAt: toIsoOrNull(event.time?.updatedAt),
    sourceName: event.source?.name || "",
    sourceUrl: event.source?.url || null,
  };
}

function describeKeyMeasurement(event) {
  const details = event.details || {};
  if (event.category === "earthquake" && details.magnitude != null) {
    return `M ${details.magnitude.toFixed(1)}`;
  }
  if (event.category === "cyclone") {
    if (details.maxWindMph != null) return `${details.maxWindMph} mph sustained`;
    if (details.maxWindKt != null) return `${details.maxWindKt} kt sustained`;
  }
  if (event.category === "flood" && details.severityText) return details.severityText;
  return "";
}

function toIsoOrNull(date) {
  return date instanceof Date && !Number.isNaN(date.getTime()) ? date.toISOString() : null;
}

function loadRaw() {
  const empty = { version: SCHEMA_VERSION, items: [] };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return empty;

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.items)) return empty;
    // Unrecognized schema version — start fresh rather than guessing at a
    // migration for a single-purpose feature this small.
    if (parsed.version !== SCHEMA_VERSION) return empty;

    return { version: parsed.version, items: parsed.items.filter(isValidEntry) };
  } catch {
    return empty;
  }
}

function isValidEntry(entry) {
  return Boolean(entry) && typeof entry === "object" && typeof entry.id === "string" && entry.id.length > 0;
}

function saveRaw(data) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}
