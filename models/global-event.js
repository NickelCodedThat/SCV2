// The normalized shape every LIVE EARTH provider adapter produces, so the
// UI never touches a provider's raw response format.
//
// @typedef {Object} GlobalEvent
// @property {string} id                 - `${provider}:${providerEventId}`, stable across refreshes
// @property {string} provider           - "usgs" | "eonet" | "gdacs" | "nhc"
// @property {string} providerEventId    - the raw id the provider itself uses
// @property {string} category           - see EVENT_CATEGORY
// @property {string} title
// @property {string} status             - "active" | "closed" | "unknown" (provider's own lifecycle signal)
// @property {{lat:number, lon:number}|null} position
// @property {Object|null} geometry      - raw GeoJSON geometry, only when the provider legitimately supplies one
// @property {{countries: string[], place: string}} region
// @property {{eventAt: Date|null, updatedAt: Date|null, closedAt: Date|null, fetchedAt: Date}} time
// @property {{providerLevel: string|null, providerLabel: string|null, displayPriority: string}} severity
// @property {Object} details            - category-specific fields, see each provider adapter
// @property {{name: string, url: string|null}} source

export const EVENT_CATEGORY = Object.freeze({
  EARTHQUAKE: "earthquake",
  WILDFIRE: "wildfire",
  VOLCANO: "volcano",
  FLOOD: "flood",
  CYCLONE: "cyclone",
});

// LIVE EARTH's presentation ranking — reuses Storm Chaser's existing 4-tier
// CSS vocabulary verbatim (styles.css --severity-critical/severe/elevated/
// advisory, alert-card--<tier>, severity-badge, severity-dot) so no new
// colors/components are introduced. This is a DISPLAY ranking, not a
// scientific severity scale — see displayPriority docs on each mapping
// function below. The event's own provider-reported severity is always kept
// separately in `severity.providerLevel`/`providerLabel` and never
// overwritten.
export const DISPLAY_PRIORITY = Object.freeze({
  CRITICAL: "critical",
  SIGNIFICANT: "severe",
  MONITORING: "elevated",
  INFORMATIONAL: "advisory",
});

export const DISPLAY_PRIORITY_LABELS = Object.freeze({
  critical: "Critical",
  severe: "Significant",
  elevated: "Monitoring",
  advisory: "Informational",
});

export const DISPLAY_PRIORITY_ORDER = Object.freeze(["critical", "severe", "elevated", "advisory"]);

export function createGlobalEvent({
  provider,
  providerEventId,
  category,
  title,
  status = "unknown",
  position = null,
  geometry = null,
  countries = [],
  place = "",
  eventAt = null,
  updatedAt = null,
  closedAt = null,
  providerLevel = null,
  providerLabel = null,
  displayPriority = DISPLAY_PRIORITY.INFORMATIONAL,
  details = {},
  sourceName,
  sourceUrl = null,
}) {
  return Object.freeze({
    id: `${provider}:${providerEventId}`,
    provider,
    providerEventId: String(providerEventId),
    category,
    title,
    status,
    position: position && Number.isFinite(position.lat) && Number.isFinite(position.lon)
      ? { lat: position.lat, lon: position.lon }
      : null,
    geometry: geometry || null,
    region: Object.freeze({ countries: Object.freeze([...countries]), place }),
    time: Object.freeze({
      eventAt: eventAt instanceof Date && !Number.isNaN(eventAt.getTime()) ? eventAt : null,
      updatedAt: updatedAt instanceof Date && !Number.isNaN(updatedAt.getTime()) ? updatedAt : null,
      closedAt: closedAt instanceof Date && !Number.isNaN(closedAt.getTime()) ? closedAt : null,
      fetchedAt: new Date(),
    }),
    severity: Object.freeze({ providerLevel, providerLabel, displayPriority }),
    details: Object.freeze({ ...details }),
    source: Object.freeze({ name: sourceName, url: sourceUrl }),
  });
}

/**
 * USGS's PAGER "alert" field (green/yellow/orange/red) only exists for
 * earthquakes significant enough to trigger it — most quakes have none.
 * Falls back to USGS's own "sig" (significance) score, documented at
 * https://earthquake.usgs.gov/data/comcat/data-eventterms.php#sig — a
 * combination of magnitude, felt reports, and other factors USGS itself
 * computes, not a Storm Chaser invention.
 */
export function displayPriorityFromUsgs({ alert, sig }) {
  const normalizedAlert = typeof alert === "string" ? alert.toLowerCase() : null;
  if (normalizedAlert === "red" || normalizedAlert === "orange") return DISPLAY_PRIORITY.CRITICAL;
  if (normalizedAlert === "yellow") return DISPLAY_PRIORITY.SIGNIFICANT;
  if (normalizedAlert === "green") return DISPLAY_PRIORITY.MONITORING;

  const significance = Number(sig);
  if (!Number.isFinite(significance)) return DISPLAY_PRIORITY.INFORMATIONAL;
  if (significance >= 650) return DISPLAY_PRIORITY.CRITICAL;
  if (significance >= 450) return DISPLAY_PRIORITY.SIGNIFICANT;
  if (significance >= 150) return DISPLAY_PRIORITY.MONITORING;
  return DISPLAY_PRIORITY.INFORMATIONAL;
}

/**
 * GDACS's own Green/Orange/Red alert level, mapped 1:1 onto Storm Chaser's
 * tiers (Red -> critical, Orange -> "Significant", Green -> "Monitoring").
 * GDACS has no fourth level, so "Informational" is never produced here.
 */
export function displayPriorityFromGdacs(alertLevel) {
  const normalized = typeof alertLevel === "string" ? alertLevel.toLowerCase() : "";
  if (normalized === "red") return DISPLAY_PRIORITY.CRITICAL;
  if (normalized === "orange") return DISPLAY_PRIORITY.SIGNIFICANT;
  if (normalized === "green") return DISPLAY_PRIORITY.MONITORING;
  return DISPLAY_PRIORITY.INFORMATIONAL;
}
