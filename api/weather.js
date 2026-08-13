// Vercel serverless function — proxies WeatherAPI so the API key never
// reaches the browser. script.js calls this route directly (no client-side
// key) whenever config.js isn't present, which is the normal case in
// production since config.js is intentionally gitignored and never deployed.
//
// The response body is passed through unchanged (including WeatherAPI's own
// {error:{message}} shape on failure), so the existing client-side
// error-handling code in script.js needs no special-casing for this path.
const WEATHERAPI_ENDPOINT = "https://api.weatherapi.com/v1/forecast.json";
const ALLOWED_PARAMS = ["q", "days", "aqi", "alerts"];

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: { message: "Method not allowed." } });
    return;
  }

  const apiKey = process.env.WEATHERAPI_KEY;
  if (!apiKey) {
    res.status(500).json({
      error: { message: "WeatherAPI is not configured on the server. Set WEATHERAPI_KEY in your Vercel project settings." },
    });
    return;
  }

  const params = new URLSearchParams({ key: apiKey });
  for (const name of ALLOWED_PARAMS) {
    const value = req.query[name];
    if (typeof value === "string" && value) params.set(name, value);
  }

  if (!params.get("q")) {
    res.status(400).json({ error: { message: "A location (q) is required." } });
    return;
  }

  try {
    const upstream = await fetch(`${WEATHERAPI_ENDPOINT}?${params}`);
    const data = await upstream.json();
    res.status(upstream.status).json(data);
  } catch {
    res.status(502).json({ error: { message: "Weather information is unavailable right now." } });
  }
}
