// Fetches official NOAA CO-OPS tide predictions for a single station — no
// calculation or inference happens here, this only requests and returns
// exactly what NOAA's datagetter API returns.
//
// Two products are requested for a ~2-day window (enough for a >24h chart
// and to always have a "next high/low" even late in the day):
//  - interval "hilo": discrete high/low events, used for the next-high and
//    next-low summary.
//  - interval "h": hourly points, used for the tide curve chart.
const DATAGETTER_ENDPOINT = "https://api.tidesandcurrents.noaa.gov/api/prod/datagetter";
const FORECAST_WINDOW_DAYS = 2;

export async function fetchTidePredictions(stationId, { signal, fetchImpl = fetch, now = new Date() } = {}) {
  if (!stationId) throw new Error("A station id is required.");

  const beginDate = formatDate(now);
  const endDate = formatDate(addDays(now, FORECAST_WINDOW_DAYS));

  const [hilo, hourly] = await Promise.all([
    fetchProduct({ stationId, beginDate, endDate, interval: "hilo", signal, fetchImpl }),
    fetchProduct({ stationId, beginDate, endDate, interval: "h", signal, fetchImpl }),
  ]);

  return { hilo, hourly };
}

async function fetchProduct({ stationId, beginDate, endDate, interval, signal, fetchImpl }) {
  const params = new URLSearchParams({
    product: "predictions",
    application: "storm-chaser",
    datum: "MLLW",
    station: stationId,
    time_zone: "lst_ldt",
    units: "english",
    interval,
    format: "json",
    begin_date: beginDate,
    end_date: endDate,
  });

  let response;
  try {
    response = await fetchImpl(`${DATAGETTER_ENDPOINT}?${params}`, { signal });
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    throw new Error("Tide predictions are unavailable right now.");
  }

  const data = await response.json().catch(() => null);
  if (!response.ok || !data || data.error) {
    throw new Error(data?.error?.message || "Tide predictions are unavailable right now.");
  }
  if (!Array.isArray(data.predictions)) {
    throw new Error("Tide predictions are unavailable right now.");
  }
  return data.predictions;
}

function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

function addDays(date, days) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}
