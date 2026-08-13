# Storm Chaser

Storm Chaser is a weather intelligence dashboard: a local forecast, a U.S.
severe-weather center, and a live global feed of significant natural events,
all built from official public data sources. A single serverless endpoint keeps
the WeatherAPI credential out of production browsers; all keyless providers
remain direct client-side integrations.

It's a no-build, vanilla JavaScript app — every screen is plain HTML/CSS/ES
modules, with one small Vercel function as the production WeatherAPI boundary.

## Core features

**Weather**
- Live current conditions and location search powered by WeatherAPI
- Hourly and three-day forecasts, sunrise/sunset, moon phase
- Dynamic day/night and condition-aware atmosphere

**Storm Center** (United States)
- Live watches, warnings, and advisories from NOAA/NWS, with an interactive
  MapLibre map using official alert geometry
- Category, severity, and state filters, with full alert detail on demand
- Live NOAA radar mosaic with a short playback loop of recent frames
- Active tropical system tracking (Atlantic, Eastern & Central Pacific) from
  the National Hurricane Center — forecast track, cone, and coastal
  watches/warnings where officially published

**Live Earth** (global)
- A world map and feed of significant events: earthquakes (USGS), wildfires
  and volcanic activity (NASA EONET), floods (GDACS), and tropical cyclones
  (NHC/CPHC + EONET/JTWC) — aggregated into one consistent event model with
  category, priority, and recency filtering
- Instant client-side search across title, location, and category
- Sort by most recent or highest priority
- **Saved events** — bookmark any event to a local watchlist (stored in the
  browser only, no account required); saved events remain visible, clearly
  marked "Archived," even after they drop out of the live feed
- **Shareable links** — every event and category filter has a stable URL, so
  a specific storm or filtered view can be copied and shared; opening a
  shared link restores that exact state, live if the event still exists, from
  the recipient's own saved copy otherwise, or gracefully if it's gone

**Overall**
- Responsive layouts for mobile, tablet, laptop, and desktop
- Source and freshness transparency on every event, with a plain-language
  data disclaimer

## Tech stack

- Semantic HTML5, modern CSS, vanilla JavaScript (ES modules) — no build
  step, no framework, no bundler
- [MapLibre GL JS](https://maplibre.org/) for all interactive maps
- [Node's built-in test runner](https://nodejs.org/api/test.html) — zero
  external test dependencies
- [WeatherAPI](https://www.weatherapi.com/), NOAA/NWS, NOAA nowCOAST, the
  National Hurricane Center, USGS, NASA EONET, and GDACS for data

## Architecture

Each data source has a small **provider adapter** (`services/*.js`) that
fetches from one public API and normalizes the response — nothing else in
the app talks to a provider's raw shape directly. Weather and Storm Center
alerts/radar/tropical each render their provider's normalized data
directly. Live Earth's five providers (USGS, NASA EONET, GDACS, and the
tropical feeds) are further normalized into one shared `GlobalEvent` shape
(`models/global-event.js`) — the same `{id, category, title, position,
region, time, severity, details, source}` structure regardless of whether
the event is an earthquake or a wildfire — so the rest of the app (map
rendering, filtering, search, sorting, the event dialog, the watchlist) only
ever has to understand one model.

```
provider API  →  adapter (services/*.js)  →  normalized model
                                                     │
                          ┌──────────────────────────┼──────────────────────────┐
                          ▼                           ▼                          ▼
                    map layer                  event feed / cards         shared event dialog
              (MapLibre, clustering)          (filter/search/sort)      (details, save, share)
```

Live Earth's orchestrator (`services/live-earth.js`) fetches all providers
in parallel via `Promise.allSettled`, so one provider failing never blocks
or corrupts the others — each provider's last-known-good data stays on
screen with a clear, honest "temporarily unavailable" notice, rather than
silently going stale or crashing the view.

A single shared `<dialog>` and `event-dialog.js` module render event detail
for NWS alerts, tropical systems, and every Live Earth category alike — one
detail view, reused everywhere, rather than a bespoke panel per feature.

Saved events (`services/watchlist.js`) and shareable state (`?event=` /
`?category=` query params, via `utils/url-state.js`) are both pure,
localStorage/URL-only concerns with no backend — Storm Chaser has no
accounts and no server-side state.

## Data sources

- Local weather: [WeatherAPI](https://www.weatherapi.com/)
- U.S. alerts: [NOAA/National Weather Service](https://www.weather.gov/documentation/services-web-api)
- Radar: [NOAA/NWS nowCOAST](https://nowcoast.noaa.gov/) (NEXRAD/MRMS CONUS base reflectivity mosaic)
- Tropical tracking: [NOAA's tropical summary MapServer](https://mapservices.weather.noaa.gov/tropical/rest/services/tropical/NHC_tropical_weather_summary/MapServer) (National Hurricane Center / Central Pacific Hurricane Center data)
- Earthquakes: [USGS Earthquake Hazards Program](https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php)
- Wildfires, volcanoes & global cyclones: [NASA EONET](https://eonet.gsfc.nasa.gov/) (wildfire/volcano attribution passes through to the underlying agency, e.g. IRWIN, Smithsonian GVP, JTWC)
- Floods: [GDACS](https://www.gdacs.org/) (Global Disaster Alert and Coordination System)
- Basemap: [OpenStreetMap](https://www.openstreetmap.org/); Live Earth's cluster-count labels use [MapLibre's public demo glyph service](https://demotiles.maplibre.org/) (non-critical — category markers render without it)

With the exception of WeatherAPI, the sources above are public, keyless
government or institutional endpoints that Storm Chaser calls directly from
the browser. WeatherAPI requests use the serverless proxy described below.

## Reliability

- Every provider call is scoped with `AbortController` and isolated with
  `Promise.allSettled`, so a slow or failing source can't block or crash the
  rest of the app.
- A failed provider keeps showing its last successfully fetched data, paired
  with an honest status message naming which source is affected — never a
  blank section and never fabricated data.
- Every refresh timer is guarded against duplication when a view is
  revisited, and is cleared when the view is left.
- `localStorage` access (the saved-events watchlist) is fully defensive:
  corrupt data, a blocked store, or a full quota all degrade to "nothing
  saved" rather than throwing.
- Shared links to an event that's no longer live and isn't in the visitor's
  own saved list fail gracefully with a plain explanation, not a blank
  screen.

## Data disclaimer

Storm Chaser aggregates and displays official public data — it does not
independently verify, forecast, or issue any warning of its own. Always
follow guidance from your local National Weather Service office or
equivalent national authority for events outside the U.S.

## Local development

Storm Chaser uses ES modules, so it must be served over HTTP rather than
opened as a local file:

```bash
python3 -m http.server 4173
```

Open `http://127.0.0.1:4173` in a browser.

### Environment / configuration

The only credential the app needs is a WeatherAPI key, kept out of Git:

```bash
cp config.example.js config.js
```

Then edit `config.js`:

```js
window.STORM_CHASER_CONFIG = {
  weatherApiKey: "YOUR_WEATHERAPI_KEY",
};
```

`config.js` is listed in `.gitignore` and must never be committed. Every
other data source Storm Chaser uses is public and keyless.

### Production (Vercel)

`config.js` is intentionally never deployed, so the browser has no API key
in production. Instead, `/api/weather.js` — a small Vercel serverless
function — holds the key server-side and proxies WeatherAPI requests;
`script.js` automatically falls back to calling that route whenever no
client-side key is configured. Set the key as a Vercel project environment
variable named `WEATHER_API_KEY` (Project Settings → Environment Variables).
Enable it for **Production** and for **Preview** if preview deployments should
also have working weather data, save the setting, then redeploy so the new
deployment receives it. The value is read server-side only via `process.env`
and is never sent to the browser. The older `WEATHERAPI_KEY` spelling remains
supported as a temporary compatibility alias, but `WEATHER_API_KEY` is the
documented canonical name. No build step or `vercel.json` is required.

## Testing

A Node built-in test suite (`node --test`, no external dependencies) covers
pure logic across the app: hurricane classification, NHC/radar parsing,
event normalization, URL state helpers, search/sort, and the saved-events
watchlist (including corrupt-storage and quota-exceeded edge cases).

```bash
npm test
```

This covers logic, not UI — verifying a feature end-to-end still means
opening it in a browser.

## Future ideas (not implemented)

Deliberately out of scope for V1, to keep it a static, backend-free app:

- Push/browser notifications for saved events
- Historical event search and trend charts
- User accounts with saved events synced across devices
- Offline support (service worker caching)

## Project status

**Storm Chaser V1.** Weather, Storm Center, and Live Earth are all feature-
complete for this release, including saved events, shareable links, search,
and sorting. See the codebase's test suite and this README's Reliability
section for what's been hardened; the items above are the known, intentional
boundary of what V1 does.
