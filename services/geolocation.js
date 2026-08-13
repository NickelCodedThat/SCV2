// Thin Promise wrapper around the browser Geolocation API. Callers only need
// to branch on `error.reason` (permission-denied / position-unavailable /
// timeout / unsupported) rather than the raw GeolocationPositionError codes.
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_POSITION_AGE_MS = 5 * 60 * 1000;

export function getCurrentCoordinates({ timeout = DEFAULT_TIMEOUT_MS, geolocationImpl } = {}) {
  const geolocation = geolocationImpl || (typeof navigator !== "undefined" ? navigator.geolocation : undefined);

  if (!geolocation || typeof geolocation.getCurrentPosition !== "function") {
    return Promise.reject(
      createGeolocationError("unsupported", "Location services aren't available in this browser."),
    );
  }

  return new Promise((resolve, reject) => {
    geolocation.getCurrentPosition(
      (position) => {
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        });
      },
      (error) => reject(mapGeolocationError(error)),
      { enableHighAccuracy: false, timeout, maximumAge: MAX_POSITION_AGE_MS },
    );
  });
}

export function mapGeolocationError(error) {
  // Standard GeolocationPositionError codes: 1 permission, 2 unavailable, 3 timeout.
  if (error?.code === 1) {
    return createGeolocationError("permission-denied", "Location access was denied. You can still search for a city.");
  }
  if (error?.code === 2) {
    return createGeolocationError("position-unavailable", "Your location couldn't be determined right now.");
  }
  if (error?.code === 3) {
    return createGeolocationError("timeout", "Finding your location took too long. Please try again.");
  }
  return createGeolocationError("unknown", "We couldn't use your location right now.");
}

function createGeolocationError(reason, message) {
  const error = new Error(message);
  error.reason = reason;
  return error;
}
