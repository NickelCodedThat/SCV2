import { createGlobalEvent, EVENT_CATEGORY, displayPriorityFromGdacs } from "../models/global-event.js";

// Global Disaster Alert and Coordination System — a joint EU/UN initiative.
// Chosen for floods specifically: neither USGS nor NASA EONET has a strong
// live flood feed (EONET's own Floods category returned zero open events
// when checked). CORS-open, keyless. GDACS requests attribution as "Global
// Disaster Alert and Coordination System, GDACS" (see gdacs.org terms of
// use) — applied as this event's source.name below.
//
// The endpoint returns the 100 most recent events across ALL hazard types
// (earthquakes, cyclones, wildfires, volcanoes, droughts, floods) with no
// working server-side type filter (verified live) — filtered to floods
// (eventtype "FL") client-side. Earthquakes/cyclones/wildfires/volcanoes are
// deliberately NOT sourced from GDACS here: USGS/EONET/NHC are each more
// authoritative for their own specialty, and using one primary provider per
// category avoids a cross-provider deduplication problem entirely.
const GDACS_URL = "https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH";

export async function fetchFloods({ signal } = {}) {
  const response = await fetch(GDACS_URL, { cache: "no-cache", signal });
  if (!response.ok) throw new Error(`GDACS returned ${response.status}.`);

  const payload = await response.json().catch(() => null);
  if (!payload || payload.type !== "FeatureCollection" || !Array.isArray(payload.features)) {
    throw new Error("GDACS returned an unexpected response.");
  }

  const events = payload.features
    .filter((feature) => feature?.properties?.eventtype === "FL")
    .map(normalizeFlood)
    .filter(Boolean);

  return { events, fetchedAt: new Date(), source: GDACS_URL };
}

export function normalizeFlood(feature) {
  if (!feature || typeof feature !== "object") return null;
  const properties = feature.properties;
  if (!properties || typeof properties !== "object") return null;

  const providerEventId = toFiniteNumber(properties.eventid);
  if (providerEventId == null) return null;

  const point = feature.geometry?.type === "Point" ? feature.geometry.coordinates : null;
  const lon = toFiniteNumber(point?.[0]);
  const lat = toFiniteNumber(point?.[1]);

  const countries = Array.isArray(properties.affectedcountries)
    ? properties.affectedcountries.map((country) => cleanText(country.countryname)).filter(Boolean)
    : [cleanText(properties.country)].filter(Boolean);

  const alertLevel = cleanText(properties.alertlevel);
  const isCurrent = properties.iscurrent === "true" || properties.iscurrent === true;

  return createGlobalEvent({
    provider: "gdacs",
    providerEventId: String(providerEventId),
    category: EVENT_CATEGORY.FLOOD,
    title: cleanText(properties.name) || "Flood",
    status: isCurrent ? "active" : "closed",
    position: lat != null && lon != null ? { lat, lon } : null,
    countries,
    place: countries[0] || cleanText(properties.country),
    eventAt: toGdacsDate(properties.fromdate),
    updatedAt: toGdacsDate(properties.datemodified),
    closedAt: isCurrent ? null : toGdacsDate(properties.todate),
    providerLevel: alertLevel || null,
    providerLabel: alertLevel ? `GDACS alert level: ${alertLevel}` : null,
    displayPriority: displayPriorityFromGdacs(alertLevel),
    details: {
      underlyingSource: cleanText(properties.source) || null,
      glideNumber: cleanText(properties.glide) || null,
      severityText: cleanText(properties.severitydata?.severitytext) || null,
      fromDate: toGdacsDate(properties.fromdate),
      toDate: toGdacsDate(properties.todate),
    },
    sourceName: "Global Disaster Alert and Coordination System, GDACS",
    sourceUrl: cleanText(properties.url?.report) || null,
  });
}

function toFiniteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function cleanText(value) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

// GDACS dates arrive without a timezone suffix (e.g. "2026-07-31T01:00:00");
// GDACS's own system operates in UTC, so one is assumed when absent rather
// than letting the browser's local offset silently skew every timestamp.
function toGdacsDate(value) {
  if (!value || typeof value !== "string") return null;
  const iso = /[Z]|[+-]\d{2}:?\d{2}$/.test(value) ? value : `${value}Z`;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}
