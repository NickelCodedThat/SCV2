# Storm Chaser V2

Storm Chaser is a responsive weather dashboard with live local forecasts and a
national severe-weather center.

## Features

- Live current conditions and location search powered by WeatherAPI
- Hourly and three-day forecasts
- Weather details, sunrise, sunset, and moon-phase information
- Dynamic day, night, and condition-aware atmosphere
- Live U.S. watches, warnings, and advisories from NOAA/NWS
- Interactive MapLibre alert map using official NWS geometry
- Alert categories, severity and state filters, and detailed event information
- Responsive layouts for mobile, tablet, laptop, and desktop

## Technologies

- Semantic HTML5
- Modern CSS
- Vanilla JavaScript and ES modules
- WeatherAPI
- NOAA/National Weather Service API
- MapLibre GL JS

## Local configuration

The WeatherAPI credential is intentionally excluded from Git. Copy the example
configuration and add your own WeatherAPI key:

```bash
cp config.example.js config.js
```

Then update `config.js`:

```js
window.STORM_CHASER_CONFIG = {
  weatherApiKey: "YOUR_WEATHERAPI_KEY",
};
```

`config.js` is listed in `.gitignore` and must never be committed.

## Run locally

Because Storm Center uses JavaScript modules, serve the project over HTTP:

```bash
python3 -m http.server 4173
```

Open `http://127.0.0.1:4173` in a browser.

## Data sources

- Local weather: [WeatherAPI](https://www.weatherapi.com/)
- U.S. alerts: [NOAA/National Weather Service](https://www.weather.gov/documentation/services-web-api)
- Basemap: [OpenStreetMap](https://www.openstreetmap.org/)
