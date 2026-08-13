import { createGlobalEvent, EVENT_CATEGORY, displayPriorityFromUsgs } from "../models/global-event.js";

// USGS's fixed-feed model: {magnitude-threshold}_{period}.geojson. 2.5+ over
// the past week gives a meaningful, cluster-friendly volume without the
// thousands of micro-quakes "all" thresholds produce. Official, CORS-open,
// keyless: https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php
const USGS_FEED_URL = "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_week.geojson";

export async function fetchEarthquakes({ signal } = {}) {
  const response = await fetch(USGS_FEED_URL, { cache: "no-cache", signal });
  if (!response.ok) throw new Error(`USGS returned ${response.status}.`);

  const payload = await response.json().catch(() => null);
  if (!payload || payload.type !== "FeatureCollection" || !Array.isArray(payload.features)) {
    throw new Error("USGS returned an unexpected response.");
  }

  const events = payload.features.map(normalizeEarthquake).filter(Boolean);
  return { events, fetchedAt: new Date(), source: USGS_FEED_URL };
}

export function normalizeEarthquake(feature) {
  if (!feature || typeof feature !== "object") return null;
  const properties = feature.properties;
  if (!properties || typeof properties !== "object") return null;

  const providerEventId = cleanText(feature.id) || cleanText(properties.code);
  if (!providerEventId) return null;

  const coordinates = feature.geometry?.type === "Point" ? feature.geometry.coordinates : null;
  const lon = toFiniteNumber(coordinates?.[0]);
  const lat = toFiniteNumber(coordinates?.[1]);
  const depthKm = toFiniteNumber(coordinates?.[2]);
  const magnitude = toFiniteNumber(properties.mag);
  const alert = cleanText(properties.alert);
  const significance = toFiniteNumber(properties.sig);

  return createGlobalEvent({
    provider: "usgs",
    providerEventId,
    category: EVENT_CATEGORY.EARTHQUAKE,
    title: cleanText(properties.title) || (magnitude != null ? `M ${magnitude.toFixed(1)} Earthquake` : "Earthquake"),
    // Earthquakes don't have an active/closed lifecycle like storms — this
    // reflects USGS's own data-review status instead.
    status: cleanText(properties.status).toLowerCase() || "unknown",
    position: lat != null && lon != null ? { lat, lon } : null,
    place: cleanText(properties.place),
    eventAt: toEpochDate(properties.time),
    updatedAt: toEpochDate(properties.updated),
    providerLevel: alert || null,
    providerLabel: alert
      ? `USGS PAGER alert: ${capitalize(alert)}`
      : significance != null ? `USGS significance ${significance}` : null,
    displayPriority: displayPriorityFromUsgs({ alert, sig: significance }),
    details: {
      magnitude,
      magnitudeType: cleanText(properties.magType) || null,
      depthKm,
      tsunami: properties.tsunami === 1,
      significance,
      feltReports: toFiniteNumber(properties.felt),
    },
    sourceName: "USGS",
    sourceUrl: cleanText(properties.url) || null,
  });
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

function capitalize(value) {
  return value ? `${value.charAt(0).toUpperCase()}${value.slice(1)}` : "";
}
