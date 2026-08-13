// Small geometry helpers shared by every MapLibre instance in Storm Chaser.
export const EMPTY_COLLECTION = Object.freeze({ type: "FeatureCollection", features: [] });

/**
 * Computes a [[west,south],[east,north]] bounding box from any GeoJSON
 * geometry's coordinate tree. Does not attempt antimeridian-aware bounds
 * (a feature that straddles ±180° would get an overly wide box) — acceptable
 * for the individual-event/region fits this is used for; world-view framing
 * doesn't depend on it.
 */
export function geometryBounds(geometry) {
  if (!geometry) return null;
  const points = [];
  collectCoordinates(geometry.coordinates, points);
  if (points.length === 0) return null;

  let west = points[0][0];
  let east = points[0][0];
  let south = points[0][1];
  let north = points[0][1];

  points.forEach(([longitude, latitude]) => {
    west = Math.min(west, longitude);
    east = Math.max(east, longitude);
    south = Math.min(south, latitude);
    north = Math.max(north, latitude);
  });

  return [[west, south], [east, north]];
}

function collectCoordinates(coordinates, points) {
  if (!Array.isArray(coordinates)) return;

  if (
    coordinates.length >= 2 &&
    typeof coordinates[0] === "number" &&
    typeof coordinates[1] === "number" &&
    Number.isFinite(coordinates[0]) &&
    Number.isFinite(coordinates[1])
  ) {
    points.push(coordinates);
    return;
  }

  coordinates.forEach((coordinate) => collectCoordinates(coordinate, points));
}
