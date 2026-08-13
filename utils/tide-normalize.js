// Pure transform from raw NOAA CO-OPS predictions (see
// services/noaa-tide-predictions.js) into the shape the tide UI renders.
// Every value here traces back to an actual NOAA prediction entry — this
// never estimates, interpolates beyond what's returned, or synthesizes a
// point that wasn't in the source data.
const UNIT_LABEL = "ft";
const DATUM_LABEL = "MLLW";
const CURVE_WINDOW_HOURS = 24;

export function normalizeTidePredictions({ hilo, hourly }, { now = new Date(), stationName = "" } = {}) {
  const parsedHilo = (hilo || []).map(parseEntry).filter(Boolean);
  const parsedHourly = (hourly || []).map(parseEntry).filter(Boolean);

  if (parsedHilo.length === 0 && parsedHourly.length === 0) {
    throw new Error("No tide predictions were returned.");
  }

  const windowEnd = new Date(now.getTime() + CURVE_WINDOW_HOURS * 60 * 60 * 1000);

  const nextHigh = parsedHilo.find((entry) => entry.type === "H" && entry.time >= now) || null;
  const nextLow = parsedHilo.find((entry) => entry.type === "L" && entry.time >= now) || null;

  const curve = parsedHourly
    .filter((entry) => entry.time >= now && entry.time <= windowEnd)
    .map((entry) => ({ time: entry.time, height: entry.height }));

  const extremes = parsedHilo
    .filter((entry) => entry.time >= now && entry.time <= windowEnd)
    .map((entry) => ({ time: entry.time, height: entry.height, type: entry.type === "H" ? "high" : "low" }));

  return {
    unit: UNIT_LABEL,
    datum: DATUM_LABEL,
    stationName,
    generatedAt: now,
    nextHigh: nextHigh ? { time: nextHigh.time, height: nextHigh.height } : null,
    nextLow: nextLow ? { time: nextLow.time, height: nextLow.height } : null,
    curve,
    extremes,
  };
}

function parseEntry(raw) {
  const time = parseNoaaTime(raw?.t);
  const height = Number(raw?.v);
  if (!time || !Number.isFinite(height)) return null;
  return { time, height, type: raw.type };
}

function parseNoaaTime(value) {
  if (typeof value !== "string") return null;
  // NOAA returns "YYYY-MM-DD HH:MM" in the requested time_zone (station
  // local standard/daylight time) — treated as a naive local time, matching
  // how the rest of the app already displays forecast-local times.
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/);
  if (!match) return null;
  const [, year, month, day, hour, minute] = match.map(Number);
  const date = new Date(year, month - 1, day, hour, minute);
  return Number.isNaN(date.getTime()) ? null : date;
}
