// config.js is a local-only convenience file and is intentionally absent from
// production. Load it only on a local host, then start the weather UI. Vercel
// goes straight to script.js, whose same-origin /api/weather request keeps the
// WeatherAPI credential server-side.
const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);

if (localHosts.has(window.location.hostname)) {
  await import("./config.js").catch(() => {
    // A missing local config is handled by script.js's existing, user-facing
    // configuration error. Keep this bootstrap free of console noise.
  });
}

await import("./script.js");
