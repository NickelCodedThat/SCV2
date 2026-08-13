// Resolves a human-readable place name for raw coordinates (used by "current
// location" weather) via Photon's reverse-geocoding endpoint — the same
// provider services/location-suggestions.js already uses for forward search,
// so this doesn't introduce a new external dependency. Reverse lookups can
// land on a street or building rather than a settlement, so this prefers the
// broadest available locality field rather than filtering by feature type
// the way forward-search suggestions do.
//
// Naming is a "nice to have": if the lookup fails or returns nothing useful,
// the coordinates are still returned with a generic name, since the weather
// request only needs valid latitude/longitude to work.
const PHOTON_REVERSE_ENDPOINT = "https://photon.komoot.io/reverse";
const FALLBACK_NAME = "Current Location";

export async function reverseGeocodeCoordinates(latitude, longitude, { signal, fetchImpl = fetch } = {}) {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    throw new Error("A valid latitude and longitude are required.");
  }

  const location = {
    name: FALLBACK_NAME,
    admin1: "",
    admin2: "",
    country: "",
    country_code: "",
    latitude,
    longitude,
    timezone: "auto",
  };

  try {
    const params = new URLSearchParams({ lat: String(latitude), lon: String(longitude), lang: "en" });
    const response = await fetchImpl(`${PHOTON_REVERSE_ENDPOINT}?${params}`, { signal });
    const data = await response.json().catch(() => null);
    const properties = Array.isArray(data?.features) ? data.features[0]?.properties : null;

    if (response.ok && properties) {
      const bestName = properties.city || properties.town || properties.village || properties.locality || properties.name;
      if (bestName) location.name = String(bestName);
      location.admin1 = String(properties.state || "");
      location.admin2 = String(properties.county || "");
      location.country = String(properties.country || "");
      location.country_code = String(properties.countrycode || "");
    }
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    // Swallow anything else — a missing name should never block weather
    // from loading for coordinates we already have.
  }

  return location;
}
