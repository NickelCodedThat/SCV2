const PHOTON_ENDPOINT = "https://photon.komoot.io/api/";
const PLACE_TYPES = new Set(["city", "town", "village", "hamlet", "locality"]);

export async function fetchLocationSuggestions(query, { signal, fetchImpl = fetch } = {}) {
  const normalizedQuery = typeof query === "string" ? query.trim() : "";
  if (!normalizedQuery) return [];

  const params = new URLSearchParams({ q: normalizedQuery, limit: "30", lang: "en" });
  let response;
  try {
    response = await fetchImpl(`${PHOTON_ENDPOINT}?${params}`, { signal });
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    throw new Error("Location suggestions are unavailable.");
  }

  const data = await response.json().catch(() => null);
  if (!response.ok || !Array.isArray(data?.features)) {
    throw new Error("Location suggestions are unavailable.");
  }

  const seen = new Set();
  return data.features
    .map(normalizePhotonFeature)
    .filter(Boolean)
    .filter((location) => {
      const key = `${location.name}|${location.admin1}|${location.country}`.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 8);
}

export function normalizePhotonFeature(feature) {
  const properties = feature?.properties;
  const coordinates = feature?.geometry?.coordinates;
  if (
    !properties?.name ||
    !PLACE_TYPES.has(properties.type) ||
    !Array.isArray(coordinates) ||
    !Number.isFinite(coordinates[0]) ||
    !Number.isFinite(coordinates[1])
  ) return null;

  return {
    name: String(properties.name),
    admin1: String(properties.state || properties.county || ""),
    country: String(properties.country || properties.countrycode || ""),
    latitude: coordinates[1],
    longitude: coordinates[0],
    timezone: "auto",
  };
}
