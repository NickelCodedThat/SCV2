// NOAA nowCOAST — official NWS/NSSL Multi-Radar/Multi-Sensor (MRMS) CONUS base
// reflectivity mosaic, served as a time-enabled WMS layer.
// https://nowcoast.noaa.gov/ (see nowCOAST GIS map service documentation)
const WMS_BASE = "https://nowcoast.noaa.gov/geoserver/observations/weather_radar/ows";
const LAYER_NAME = "conus_base_reflectivity_mosaic";
const CAPABILITIES_URL = `${WMS_BASE}?service=WMS&version=1.3.0&request=GetCapabilities`;

// The service exposes several hours of ~4-minute frames; we only ever keep a
// bounded, recent window so animation can't grow API calls or memory
// unbounded on slow mobile connections.
const MAX_FRAMES = 15;

export const RADAR_ATTRIBUTION =
  "Radar: NOAA/NWS nowCOAST (NEXRAD/MRMS base reflectivity)";

export function buildRadarTileUrl(isoTime) {
  const params = new URLSearchParams({
    service: "WMS",
    version: "1.3.0",
    request: "GetMap",
    layers: LAYER_NAME,
    styles: "",
    format: "image/png",
    transparent: "true",
    width: "256",
    height: "256",
    crs: "EPSG:3857",
  });
  if (isoTime) params.set("time", isoTime);
  return `${WMS_BASE}?${params.toString()}&bbox={bbox-epsg-3857}`;
}

export async function fetchRadarFrames({ signal } = {}) {
  const response = await fetch(CAPABILITIES_URL, { cache: "no-cache", signal });

  if (!response.ok) {
    throw new Error(`NOAA nowCOAST returned ${response.status}.`);
  }

  const xmlText = await response.text();
  const rawTimes = extractLayerTimeDimension(xmlText, LAYER_NAME);
  if (!rawTimes) {
    throw new Error("NOAA nowCOAST did not report available radar frame times.");
  }

  const times = parseTimeDimensionValue(rawTimes);
  if (times.length === 0) {
    throw new Error("NOAA nowCOAST returned no usable radar frame times.");
  }

  const frames = selectRecentFrames(times, { maxFrames: MAX_FRAMES }).map((time) => ({
    time,
    iso: time.toISOString(),
  }));

  return {
    frames,
    latest: frames[frames.length - 1]?.time || null,
    updatedAt: new Date(),
  };
}

/**
 * Finds the WMS <Layer> matching layerName and returns the raw text content
 * of its <Dimension name="time"> element, or null if not found. Pure DOM
 * parsing, kept separate from the network call so it's easy to reason about;
 * relies on the browser's DOMParser (this module only ever runs client-side).
 */
export function extractLayerTimeDimension(xmlText, layerName) {
  const doc = new DOMParser().parseFromString(xmlText, "text/xml");
  if (doc.querySelector("parsererror")) return null;

  const layers = [...doc.getElementsByTagName("Layer")];
  const target = layers.find((layer) => {
    const nameNode = layer.querySelector(":scope > Name");
    return nameNode?.textContent?.trim() === layerName;
  });

  const dimension = target?.querySelector('Dimension[name="time"]');
  return dimension?.textContent?.trim() || null;
}

/**
 * Parses a WMS time-dimension value into Dates. Supports the common
 * comma-separated list form; ignores/skips malformed entries rather than
 * failing the whole batch.
 */
export function parseTimeDimensionValue(rawValue) {
  if (typeof rawValue !== "string" || rawValue.trim() === "") return [];

  return rawValue
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => new Date(entry))
    .filter((date) => !Number.isNaN(date.getTime()));
}

/**
 * Returns the most recent `maxFrames` timestamps in chronological order
 * (oldest first, latest last), regardless of the input order.
 */
export function selectRecentFrames(times, { maxFrames = MAX_FRAMES } = {}) {
  return [...times]
    .sort((left, right) => left.getTime() - right.getTime())
    .slice(-maxFrames);
}
