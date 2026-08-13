// Quick Locations persistence — browser localStorage only, no account or
// backend, mirroring services/watchlist.js's defensive-storage pattern.
// Locations are stored as full, stable records (name + admin1/admin2 +
// country + coordinates + timezone) rather than bare city-name strings, so a
// saved location can be re-loaded without re-geocoding and without any
// ambiguity between two same-named places.
const STORAGE_KEY = "storm-chaser:quick-locations:v1";
const SCHEMA_VERSION = 1;
const MAX_LOCATIONS = 8;
const ID_PRECISION = 4; // ~11m — enough to dedupe the same place, not so coarse it merges distinct nearby ones.

// The app's original static Quick Locations, carried over as the seeded
// starting set so existing users see the same four tiles on first load —
// after that, their own saves/removals are the only source of truth (see
// getQuickLocations: seeding only happens when storage has never been
// initialized at all, never to "restore" tiles a user removed).
const DEFAULT_QUICK_LOCATIONS = Object.freeze([
  { name: "New York City", admin1: "New York", admin2: "", country: "United States", country_code: "US", latitude: 40.7128, longitude: -74.006, timezone: "auto" },
  { name: "Memphis", admin1: "Tennessee", admin2: "", country: "United States", country_code: "US", latitude: 35.1495, longitude: -90.049, timezone: "auto" },
  { name: "Myrtle Beach", admin1: "South Carolina", admin2: "", country: "United States", country_code: "US", latitude: 33.6891, longitude: -78.8867, timezone: "auto" },
  { name: "Jacksonville", admin1: "Florida", admin2: "", country: "United States", country_code: "US", latitude: 30.3322, longitude: -81.6557, timezone: "auto" },
]);

export function buildLocationId(latitude, longitude) {
  const lat = Number(latitude);
  const lon = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return "";
  return `${lat.toFixed(ID_PRECISION)},${lon.toFixed(ID_PRECISION)}`;
}

export function getQuickLocations() {
  return loadRaw().items.map((item) => Object.freeze({ ...item }));
}

export function isSaved(id) {
  if (!id) return false;
  return loadRaw().items.some((item) => item.id === id);
}

export function findSavedLocation(id) {
  return loadRaw().items.find((item) => item.id === id) || null;
}

/**
 * Saves a location. Idempotent (saving an already-saved location succeeds
 * without creating a duplicate). Returns {ok:false, reason:"limit"} rather
 * than silently dropping the save once MAX_LOCATIONS is reached, so the
 * caller can tell the user why nothing happened.
 */
export function saveLocation(location) {
  const id = buildLocationId(location?.latitude, location?.longitude);
  if (!id || !location?.name) return { ok: false, reason: "invalid" };

  const data = loadRaw();
  if (data.items.some((item) => item.id === id)) return { ok: true };
  if (data.items.length >= MAX_LOCATIONS) return { ok: false, reason: "limit" };

  data.items.push({
    id,
    name: String(location.name),
    admin1: String(location.admin1 || ""),
    admin2: String(location.admin2 || ""),
    country: String(location.country || ""),
    country_code: String(location.country_code || ""),
    latitude: location.latitude,
    longitude: location.longitude,
    timezone: location.timezone || "auto",
    savedAt: new Date().toISOString(),
  });

  return saveRaw(data) ? { ok: true } : { ok: false, reason: "storage" };
}

export function removeLocation(id) {
  const data = loadRaw();
  const nextItems = data.items.filter((item) => item.id !== id);
  if (nextItems.length === data.items.length) return true; // nothing to remove
  return saveRaw({ ...data, items: nextItems });
}

export const QUICK_LOCATIONS_MAX = MAX_LOCATIONS;

function loadRaw() {
  const empty = { version: SCHEMA_VERSION, items: [] };
  let raw;
  try {
    raw = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return empty; // storage blocked (private mode, disabled cookies, etc.)
  }

  if (raw === null) return seedDefaults();

  try {
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

function seedDefaults() {
  const seeded = {
    version: SCHEMA_VERSION,
    items: DEFAULT_QUICK_LOCATIONS.map((location) => ({
      id: buildLocationId(location.latitude, location.longitude),
      ...location,
      savedAt: new Date().toISOString(),
    })),
  };
  saveRaw(seeded); // best-effort; if storage is unavailable, still return the defaults for this session
  return seeded;
}

function isValidEntry(entry) {
  return (
    Boolean(entry) &&
    typeof entry === "object" &&
    typeof entry.id === "string" &&
    entry.id.length > 0 &&
    typeof entry.name === "string" &&
    Number.isFinite(entry.latitude) &&
    Number.isFinite(entry.longitude)
  );
}

function saveRaw(data) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}
