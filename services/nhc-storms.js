import { describeTropicalClassification } from "../utils/hurricane-scale.js";

// NOAA's consolidated NHC/CPHC tropical summary map service. Chosen over
// NHC's own CurrentStorms.json (which does not send CORS headers and cannot
// be fetched directly from a browser — verified against a live response) and
// over the per-basin-slot "NHC_tropical_weather" service (which needs 15
// separate layer lookups per basin slot). This consolidated service exposes
// one fixed set of layers covering every active storm across all basins, so
// no slot-guessing or layer-name resolution is needed.
const TROPICAL_MAPSERVER =
  "https://mapservices.weather.noaa.gov/tropical/rest/services/tropical/NHC_tropical_weather_summary/MapServer";

// Fixed, well-known layer ids in the consolidated service (verified live).
const LAYER_ID = Object.freeze({
  forecastPoints: 5,
  forecastTrack: 6,
  forecastCone: 7,
  watchWarnings: 8,
  pastTrack: 11,
});

// Keyed by binnumber's own prefix convention (AT/EP/CP) — note this differs
// from the separate "basin" property, which uses "AL" for Atlantic.
const BASIN_LABELS = Object.freeze({
  AT: "Atlantic",
  EP: "Eastern Pacific",
  CP: "Central Pacific",
});

// NHC's sibling CurrentStorms.json product documents this same quantity
// (storm intensity) in knots; this service doesn't state units in its field
// metadata, but both come from the same NHC/nowCOAST advisory pipeline
// (see the shared "idp_*" ingest fields), so the same unit is assumed.
const KT_TO_MPH = 1.15078;

export async function fetchActiveStorms({ signal } = {}) {
  const collection = await queryLayer(LAYER_ID.forecastPoints, "tau=0", signal);
  if (!collection) {
    throw new Error("The National Hurricane Center returned an unexpected response.");
  }

  const storms = collection.features.map(normalizeStorm).filter(Boolean);
  return { storms, updatedAt: new Date(), source: TROPICAL_MAPSERVER };
}

export function normalizeStorm(feature, index = 0) {
  if (!feature || typeof feature !== "object") return null;
  const properties = feature.properties;
  if (!properties || typeof properties !== "object") return null;

  const binNumber = cleanText(properties.binnumber).toUpperCase();
  const classification = cleanText(properties.stormtype).toUpperCase();
  const maxWindKt = toFiniteNumber(properties.maxwind);
  const officialCategory = toFiniteNumber(properties.ssnum);
  const classificationInfo = describeTropicalClassification({
    classification,
    intensityKt: maxWindKt,
    officialCategory: officialCategory > 0 ? officialCategory : null,
  });

  const point = feature.geometry?.type === "Point" ? feature.geometry.coordinates : null;
  const lon = toFiniteNumber(point?.[0]);
  const lat = toFiniteNumber(point?.[1]);

  return Object.freeze({
    id: cleanText(properties.idp_subset) || `nhc-storm-${index}`,
    binNumber,
    basin: BASIN_LABELS[binNumber.slice(0, 2)] || cleanText(properties.basin) || "Unknown basin",
    name: cleanText(properties.stormname) || "Unnamed system",
    classification,
    classificationInfo,
    maxWindKt,
    maxWindMph: maxWindKt != null ? Math.round(maxWindKt * KT_TO_MPH) : null,
    gustKt: toFiniteNumber(properties.gust),
    pressureMb: toFiniteNumber(properties.mslp),
    position: lat != null && lon != null ? { lat, lon } : null,
    positionLabel: formatPositionLabel(lat, lon),
    movement: {
      directionDeg: toFiniteNumber(properties.tcdir),
      speedMph: toFiniteNumber(properties.tcspd),
    },
    lastUpdate: toEpochDate(properties.idp_filedate),
    advisory: Object.freeze({
      number: cleanText(properties.advisnum) || null,
      issuedAtLabel: cleanText(properties.advdate) || null,
    }),
    links: Object.freeze({
      // Verified stable pattern from NHC's own CurrentStorms.json (each
      // storm's forecastGraphics.url follows graphics_<binnumber>.shtml).
      publicAdvisory: binNumber ? `https://www.nhc.noaa.gov/graphics_${binNumber.toLowerCase()}.shtml` : null,
    }),
    authority: binNumber.startsWith("CP") ? "Central Pacific Hurricane Center" : "National Hurricane Center",
    sourceUrl: "https://www.nhc.noaa.gov/",
  });
}

/**
 * Fetches NHC's official forecast/past-track geometry for one storm as
 * GeoJSON. Each layer is requested independently (Promise.allSettled) so a
 * single missing/broken layer (e.g. no active watch/warning) never blocks
 * the rest of the storm's geometry.
 */
export async function fetchStormGeometry(binNumber, { signal } = {}) {
  if (!binNumber) return emptyGeometry();

  const where = binNumberFilter(binNumber);
  const keys = Object.keys(LAYER_ID);
  const results = await Promise.allSettled(
    keys.map((key) => queryLayer(LAYER_ID[key], where, signal)),
  );

  const geometry = emptyGeometry();
  keys.forEach((key, index) => {
    geometry[key] = results[index].status === "fulfilled" ? results[index].value : null;
  });
  return geometry;
}

function emptyGeometry() {
  return {
    forecastPoints: null,
    forecastTrack: null,
    forecastCone: null,
    watchWarnings: null,
    pastTrack: null,
  };
}

async function queryLayer(layerId, where, signal) {
  const url = `${TROPICAL_MAPSERVER}/${layerId}/query?where=${encodeURIComponent(where)}&outFields=*&f=geojson`;
  const response = await fetch(url, { cache: "no-cache", signal });
  if (!response.ok) throw new Error(`NHC map service returned ${response.status}.`);

  const payload = await response.json().catch(() => null);
  return isFeatureCollection(payload) ? payload : null;
}

function binNumberFilter(binNumber) {
  return `binnumber='${binNumber.replace(/'/g, "''")}'`;
}

function formatPositionLabel(lat, lon) {
  if (lat == null || lon == null) return "";
  const latLabel = `${Math.abs(lat).toFixed(1)}°${lat >= 0 ? "N" : "S"}`;
  const lonLabel = `${Math.abs(lon).toFixed(1)}°${lon >= 0 ? "E" : "W"}`;
  return `${latLabel}, ${lonLabel}`;
}

function isFeatureCollection(payload) {
  return Boolean(payload) && payload.type === "FeatureCollection" && Array.isArray(payload.features);
}

function toFiniteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function cleanText(value) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function toEpochDate(value) {
  const ms = Number(value);
  return Number.isFinite(ms) ? new Date(ms) : null;
}
