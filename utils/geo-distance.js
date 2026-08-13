// Great-circle distance between two coordinates, in kilometers. Used to pick
// the nearest eligible NOAA tide station to a weather location — small and
// pure enough to unit test without any network or DOM dependency.
const EARTH_RADIUS_KM = 6371;

export function haversineDistanceKm(lat1, lon1, lat2, lon2) {
  const phi1 = toRadians(lat1);
  const phi2 = toRadians(lat2);
  const deltaPhi = toRadians(lat2 - lat1);
  const deltaLambda = toRadians(lon2 - lon1);

  const a =
    Math.sin(deltaPhi / 2) ** 2 +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) ** 2;

  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a));
}

function toRadians(degrees) {
  return (degrees * Math.PI) / 180;
}
