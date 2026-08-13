import { haversineDistanceKm } from "../utils/geo-distance.js";

// Finds the nearest NOAA CO-OPS tide station that can actually produce the
// data this app needs, for a given weather location.
//
// Station selection logic:
//  1. Only stations returned by the metadata API's `type=tidepredictions`
//     filter are considered at all — this excludes stations that only
//     report water levels/currents with no tide *prediction* product.
//  2. Within that set, only Reference-type stations ("R") are eligible.
//     CO-OPS also lists many Subordinate stations ("S"), which only carry
//     time/height *offsets* from a reference station and — verified against
//     NOAA's own datagetter API — do not support the `interval=h` hourly
//     product the tide chart needs, only discrete high/low (`interval=hilo`)
//     predictions. Restricting to reference stations keeps every accepted
//     station capable of both the chart and the high/low summary, rather
//     than silently choosing the geographically nearest station and then
//     discovering it can't produce a curve.
//  3. The nearest eligible station is only used if it's within
//     COASTAL_DISTANCE_KM — chosen by checking real reference-station
//     distances for known coastal cities (Myrtle Beach ~4km, Miami ~2km,
//     New York ~1.5km, San Juan ~1km) against a known inland city
//     (Pittsburgh, ~300km to its nearest station) — 50km comfortably covers
//     coastal/tidal-estuary locations without matching inland ones.
const STATIONS_ENDPOINT = "https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations.json?type=tidepredictions";
const CACHE_KEY = "storm-chaser:tide-stations:v1";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
export const COASTAL_DISTANCE_KM = 50;

export async function findNearestTideStation(latitude, longitude, { signal, fetchImpl = fetch } = {}) {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

  const stations = await loadReferenceStations({ signal, fetchImpl });
  if (stations.length === 0) return null;

  let nearest = null;
  let nearestDistanceKm = Infinity;
  for (const station of stations) {
    const distanceKm = haversineDistanceKm(latitude, longitude, station.lat, station.lng);
    if (distanceKm < nearestDistanceKm) {
      nearestDistanceKm = distanceKm;
      nearest = station;
    }
  }

  if (!nearest || nearestDistanceKm > COASTAL_DISTANCE_KM) return null;
  return { id: nearest.id, name: nearest.name, distanceKm: nearestDistanceKm };
}

async function loadReferenceStations({ signal, fetchImpl }) {
  const cached = readCache();
  if (cached) return cached;

  const response = await fetchImpl(STATIONS_ENDPOINT, { signal });
  if (!response.ok) throw new Error("NOAA station data is unavailable right now.");

  const data = await response.json().catch(() => null);
  const stations = Array.isArray(data?.stations) ? data.stations : [];
  if (stations.length === 0) throw new Error("NOAA station data is unavailable right now.");

  // Trim to only the fields the app uses before caching — the full API
  // response includes several unused sub-resource links per station and is
  // several megabytes; the trimmed reference-only list is a small fraction
  // of that.
  const referenceStations = stations
    .filter((station) => station.type === "R" && Number.isFinite(station.lat) && Number.isFinite(station.lng) && station.id)
    .map((station) => ({ id: String(station.id), name: String(station.name || "NOAA Tide Station"), lat: station.lat, lng: station.lng }));

  writeCache(referenceStations);
  return referenceStations;
}

function readCache() {
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.stations) || typeof parsed.cachedAt !== "number") {
      return null;
    }
    if (Date.now() - parsed.cachedAt > CACHE_TTL_MS) return null;

    return parsed.stations;
  } catch {
    return null;
  }
}

function writeCache(stations) {
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify({ cachedAt: Date.now(), stations }));
  } catch {
    // Non-critical — station lookup still works without a persisted cache,
    // it just re-fetches on the next page load.
  }
}
