import { createGlobalEvent, EVENT_CATEGORY, DISPLAY_PRIORITY } from "../models/global-event.js";

// NASA EONET v3 — curated, editorially-identified natural events (not raw
// satellite thermal detections), covering wildfires and volcanoes globally.
// Official, CORS-open, keyless: https://eonet.gsfc.nasa.gov/docs/v3
//
// Also used for global tropical-cyclone coverage beyond Phase 3's NHC/CPHC
// basins (see isNhcCoveredStorm below) — EONET's severeStorms category
// tracks Western Pacific/Indian Ocean systems via JTWC that NHC does not.
const EONET_BASE = "https://eonet.gsfc.nasa.gov/api/v3/categories";

const CATEGORY_MAP = Object.freeze({
  wildfires: EVENT_CATEGORY.WILDFIRE,
  volcanoes: EVENT_CATEGORY.VOLCANO,
  severeStorms: EVENT_CATEGORY.CYCLONE,
});

// Fetched as separate per-category requests, each with its own limit —
// EONET's combined `category=a,b,c` query applies one shared limit across
// all requested categories together (confirmed live: wildfires alone
// regularly exceeds 300 open events and was silently crowding out every
// volcano and most severe-storm entries when combined into one request).
const CATEGORY_LIMITS = Object.freeze({
  wildfires: 500,
  volcanoes: 100,
  severeStorms: 50,
});

// Storm Chaser's own tropical architecture (services/nhc-storms.js) already
// covers every NOAA_NHC-sourced storm in full detail (forecast track, cone,
// watches/warnings). Dropping them here — by verified source id, not by
// geographic proximity — is the dedup rule: it prevents the same real-world
// storm appearing twice under two providers, while still surfacing storms
// NHC has no jurisdiction over (JTWC-tracked systems elsewhere).
const NHC_COVERED_SOURCE_ID = "NOAA_NHC";

// A source list exists at /api/v3/sources; hardcoding the handful relevant
// to our 3 categories avoids an extra request for largely-static reference
// data. Falls back to the raw EONET source id when not one of these.
const SOURCE_NAMES = Object.freeze({
  IRWIN: "Integrated Reporting of Wildfire Information (IRWIN)",
  InciWeb: "InciWeb",
  CALFIRE: "California Department of Forestry and Fire Protection",
  BCWILDFIRE: "British Columbia Wildfire Service",
  ABFIRE: "Alberta Wildfire",
  MBFIRE: "Manitoba Wildfire Program",
  DFES_WA: "WA Dept. of Fire and Emergency Services",
  SIVolcano: "Smithsonian Institution Global Volcanism Program",
  JTWC: "Joint Typhoon Warning Center",
  AU_BOM: "Australia Bureau of Meteorology",
  NOAA_CPC: "NOAA Center for Weather and Climate Prediction",
});

export async function fetchEonetEvents({ signal } = {}) {
  const categoryIds = Object.keys(CATEGORY_MAP);
  const rawEventLists = await Promise.all(
    categoryIds.map((categoryId) => fetchCategory(categoryId, { signal })),
  );

  const events = rawEventLists
    .flat()
    .filter((event) => !isNhcCoveredStorm(event))
    .map(normalizeEonetEvent)
    .filter(Boolean);

  return { events, fetchedAt: new Date(), source: EONET_BASE };
}

async function fetchCategory(categoryId, { signal }) {
  const url = `${EONET_BASE}/${categoryId}?status=open&limit=${CATEGORY_LIMITS[categoryId]}`;
  const response = await fetch(url, { cache: "no-cache", signal });
  if (!response.ok) throw new Error(`NASA EONET returned ${response.status}.`);

  const payload = await response.json().catch(() => null);
  if (!payload || !Array.isArray(payload.events)) {
    throw new Error("NASA EONET returned an unexpected response.");
  }
  return payload.events;
}

export function isNhcCoveredStorm(event) {
  const categoryIds = (event?.categories || []).map((category) => category.id);
  if (!categoryIds.includes("severeStorms")) return false;
  const sourceIds = (event?.sources || []).map((source) => source.id);
  return sourceIds.includes(NHC_COVERED_SOURCE_ID);
}

export function normalizeEonetEvent(event) {
  if (!event || typeof event !== "object") return null;

  const primaryCategoryId = event.categories?.[0]?.id;
  const category = CATEGORY_MAP[primaryCategoryId];
  if (!category) return null;

  const providerEventId = cleanText(event.id);
  if (!providerEventId) return null;

  const geometries = Array.isArray(event.geometry) ? event.geometry : [];
  const first = geometries[0];
  const latest = geometries[geometries.length - 1];
  const point = latest?.type === "Point" ? latest.coordinates : null;
  const lon = toFiniteNumber(point?.[0]);
  const lat = toFiniteNumber(point?.[1]);

  const primarySource = event.sources?.[0];
  const sourceId = cleanText(primarySource?.id);

  return createGlobalEvent({
    provider: "eonet",
    providerEventId,
    category,
    title: cleanText(event.title) || "Untitled event",
    status: event.closed ? "closed" : "active",
    position: lat != null && lon != null ? { lat, lon } : null,
    place: cleanText(event.title),
    eventAt: toEonetDate(first?.date),
    updatedAt: toEonetDate(latest?.date),
    closedAt: toEonetDate(event.closed),
    // EONET does not publish a severity/alert level for these categories —
    // shown as "Informational" rather than inventing a scale.
    providerLevel: null,
    providerLabel: null,
    displayPriority: DISPLAY_PRIORITY.INFORMATIONAL,
    details: {
      eonetCategory: primaryCategoryId,
      magnitudeValue: toFiniteNumber(latest?.magnitudeValue),
      magnitudeUnit: cleanText(latest?.magnitudeUnit) || null,
      trackPointCount: geometries.length,
      // JTWC-tracked storms report wind speed via the generic
      // magnitude field (unit "kts") rather than a dedicated field —
      // surfaced explicitly so cyclone-specific UI can use it directly.
      maxWindKt: category === EVENT_CATEGORY.CYCLONE && cleanText(latest?.magnitudeUnit) === "kts"
        ? toFiniteNumber(latest?.magnitudeValue)
        : null,
    },
    sourceName: sourceId ? (SOURCE_NAMES[sourceId] || `NASA EONET (${sourceId})`) : "NASA EONET",
    sourceUrl: cleanText(primarySource?.url) || cleanText(event.link) || null,
  });
}

function toFiniteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function cleanText(value) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function toEonetDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
