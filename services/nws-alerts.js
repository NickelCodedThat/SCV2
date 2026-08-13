const NWS_ALERTS_ENDPOINT = "https://api.weather.gov/alerts/active";

export const STATE_NAMES = Object.freeze({
  AK: "Alaska", AL: "Alabama", AR: "Arkansas", AS: "American Samoa", AZ: "Arizona",
  CA: "California", CO: "Colorado", CT: "Connecticut", DC: "District of Columbia",
  DE: "Delaware", FL: "Florida", GA: "Georgia", GU: "Guam", HI: "Hawaii",
  IA: "Iowa", ID: "Idaho", IL: "Illinois", IN: "Indiana", KS: "Kansas",
  KY: "Kentucky", LA: "Louisiana", MA: "Massachusetts", MD: "Maryland",
  ME: "Maine", MI: "Michigan", MN: "Minnesota", MO: "Missouri", MP: "Northern Mariana Islands",
  MS: "Mississippi", MT: "Montana", NC: "North Carolina", ND: "North Dakota",
  NE: "Nebraska", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico",
  NV: "Nevada", NY: "New York", OH: "Ohio", OK: "Oklahoma", OR: "Oregon",
  PA: "Pennsylvania", PR: "Puerto Rico", RI: "Rhode Island", SC: "South Carolina",
  SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VA: "Virginia",
  VI: "U.S. Virgin Islands", VT: "Vermont", WA: "Washington", WI: "Wisconsin",
  WV: "West Virginia", WY: "Wyoming",
});

const SEVERITY_RANK = Object.freeze({ critical: 0, severe: 1, elevated: 2, advisory: 3 });

export async function fetchActiveAlerts({ signal } = {}) {
  const response = await fetch(NWS_ALERTS_ENDPOINT, {
    headers: { Accept: "application/geo+json" },
    cache: "no-cache",
    signal,
  });

  if (!response.ok) {
    throw new Error(`The National Weather Service returned ${response.status}.`);
  }

  const payload = await response.json().catch(() => null);

  if (!isFeatureCollection(payload)) {
    throw new Error("The National Weather Service returned an unexpected response.");
  }

  const alerts = payload.features
    .map(normalizeAlert)
    .filter(Boolean)
    .sort(compareAlerts);

  return {
    alerts,
    updatedAt: parseDate(payload.updated) || new Date(),
    source: NWS_ALERTS_ENDPOINT,
  };
}

function normalizeAlert(feature, index) {
  if (!feature || feature.type !== "Feature" || !isObject(feature.properties)) return null;

  const properties = feature.properties;
  if (properties.status && cleanText(properties.status).toLowerCase() !== "actual") return null;
  const event = cleanText(properties.event) || "Weather Alert";
  const id = cleanText(feature.id || properties.id) || `nws-alert-${index}`;
  const states = extractStates(properties);
  const geometry = normalizeGeometry(feature.geometry);
  const level = determineSeverity(properties, event);

  return Object.freeze({
    id,
    event,
    category: categorizeAlert(event),
    level,
    severity: cleanText(properties.severity) || "Unknown",
    urgency: cleanText(properties.urgency) || "Unknown",
    certainty: cleanText(properties.certainty) || "Unknown",
    status: cleanText(properties.status) || "Actual",
    messageType: cleanText(properties.messageType) || "Alert",
    headline: cleanText(properties.headline) || event,
    area: cleanText(properties.areaDesc) || "Area information unavailable",
    states,
    sent: parseDate(properties.sent),
    effective: parseDate(properties.effective),
    onset: parseDate(properties.onset),
    expires: parseDate(properties.expires),
    ends: parseDate(properties.ends),
    description: cleanMultilineText(properties.description) || "No detailed description was provided.",
    instruction: cleanMultilineText(properties.instruction),
    authority: cleanText(properties.senderName) || "National Weather Service",
    sender: cleanText(properties.sender),
    response: cleanText(properties.response) || "None",
    geometry,
    hasGeometry: Boolean(geometry),
    sourceUrl: isOfficialNwsUrl(id) ? id : NWS_ALERTS_ENDPOINT,
  });
}

function determineSeverity(properties, event) {
  const severity = cleanText(properties.severity).toLowerCase();
  const urgency = cleanText(properties.urgency).toLowerCase();
  const certainty = cleanText(properties.certainty).toLowerCase();
  const normalizedEvent = event.toLowerCase();

  if (
    severity === "extreme" ||
    /flash flood emergency|extreme wind warning|tornado emergency/.test(normalizedEvent)
  ) {
    return "critical";
  }

  if (/\bwatch\b/.test(normalizedEvent)) return "elevated";

  if (
    severity === "severe" ||
    (urgency === "immediate" && ["observed", "likely"].includes(certainty))
  ) {
    return "severe";
  }

  if (severity === "moderate" || urgency === "expected") return "elevated";
  return "advisory";
}

function categorizeAlert(event) {
  const normalized = event.toLowerCase();

  if (/tornado/.test(normalized)) return "tornado";
  if (/thunderstorm|severe weather/.test(normalized)) return "severe-storm";
  if (/flood|storm surge|high water/.test(normalized)) return "flood";
  if (/hurricane|tropical|typhoon/.test(normalized)) return "tropical";
  if (/winter|snow|blizzard|ice|freez|frost|cold|wind chill|avalanche/.test(normalized)) return "winter";
  if (/red flag|fire weather|wildfire|smoke/.test(normalized)) return "fire";
  if (/heat/.test(normalized)) return "heat";
  return "other";
}

function extractStates(properties) {
  const ugcCodes = Array.isArray(properties.geocode?.UGC) ? properties.geocode.UGC : [];
  const zoneCodes = Array.isArray(properties.affectedZones)
    ? properties.affectedZones.map((url) => String(url).split("/").pop())
    : [];

  const states = new Set(
    [...ugcCodes, ...zoneCodes]
      .map((code) => String(code).slice(0, 2).toUpperCase())
      .filter((code) => Object.hasOwn(STATE_NAMES, code)),
  );

  return Object.freeze([...states].sort());
}

function normalizeGeometry(geometry) {
  if (!geometry || !["Polygon", "MultiPolygon"].includes(geometry.type)) return null;
  if (!Array.isArray(geometry.coordinates) || geometry.coordinates.length === 0) return null;
  return geometry;
}

function compareAlerts(left, right) {
  const rankDifference = SEVERITY_RANK[left.level] - SEVERITY_RANK[right.level];
  if (rankDifference !== 0) return rankDifference;
  return (right.sent?.getTime() || 0) - (left.sent?.getTime() || 0);
}

function isFeatureCollection(payload) {
  return isObject(payload) && payload.type === "FeatureCollection" && Array.isArray(payload.features);
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cleanText(value) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function cleanMultilineText(value) {
  return typeof value === "string"
    ? value.replace(/\r/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim()
    : "";
}

function parseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isOfficialNwsUrl(value) {
  try {
    return new URL(value).hostname === "api.weather.gov";
  } catch {
    return false;
  }
}
