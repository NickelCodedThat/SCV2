// Vercel serverless function — proxies WeatherAPI so the API key never
// reaches the browser. script.js calls this route directly (no client-side
// key) whenever config.js isn't present, which is the normal case in
// production since config.js is intentionally gitignored and never deployed.
//
// The response body is passed through unchanged (including WeatherAPI's own
// {error:{message}} shape on failure), so the existing client-side
// error-handling code in script.js needs no special-casing for this path.
const WEATHERAPI_ENDPOINT = "https://api.weatherapi.com/v1/forecast.json";
const MAX_LOCATION_LENGTH = 200;

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: { message: "Method not allowed." } });
    return;
  }

  // WEATHER_API_KEY is the canonical Vercel setting. Keep the original
  // WEATHERAPI_KEY spelling as a backward-compatible alias so an existing
  // project configuration does not break during rollout.
  const apiKey = process.env.WEATHER_API_KEY || process.env.WEATHERAPI_KEY;
  if (!apiKey) {
    res.status(500).json({
      error: { message: "WeatherAPI is not configured on the server. Set WEATHER_API_KEY in your Vercel project settings." },
    });
    return;
  }

  const location = typeof req.query.q === "string" ? req.query.q.trim() : "";
  if (!location) {
    res.status(400).json({ error: { message: "A location (q) is required." } });
    return;
  }
  if (location.length > MAX_LOCATION_LENGTH) {
    res.status(400).json({ error: { message: "The location query is too long." } });
    return;
  }

  const days = typeof req.query.days === "string" && /^(?:[1-9]|1[0-4])$/.test(req.query.days)
    ? req.query.days
    : "3";
  const aqi = req.query.aqi === "yes" ? "yes" : "no";
  const alerts = req.query.alerts === "yes" ? "yes" : "no";
  const params = new URLSearchParams({ key: apiKey, q: location, days, aqi, alerts });

  try {
    const upstream = await fetch(`${WEATHERAPI_ENDPOINT}?${params}`, {
      signal: AbortSignal.timeout(10_000),
    });
    const data = await upstream.json().catch(() => null);
    if (!data) throw new Error("Unexpected WeatherAPI response.");
    res.status(upstream.status).json(data);
  } catch {
    res.status(502).json({ error: { message: "Weather information is unavailable right now." } });
  }
}
