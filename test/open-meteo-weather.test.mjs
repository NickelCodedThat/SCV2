import test from "node:test";
import assert from "node:assert/strict";
import {
  conditionFromWmo,
  fetchOpenMeteoWeather,
  moonPhaseForDate,
  normalizeOpenMeteoWeather,
} from "../services/open-meteo-weather.js";

const location = {
  name: "New York",
  admin1: "New York",
  country: "United States",
  latitude: 40.71427,
  longitude: -74.00597,
  timezone: "America/New_York",
};

const forecast = {
  utc_offset_seconds: -14400,
  current: {
    time: "2026-08-13T10:15",
    temperature_2m: 77.8,
    relative_humidity_2m: 74,
    apparent_temperature: 83.2,
    is_day: 1,
    precipitation: 0.01,
    weather_code: 3,
    cloud_cover: 98,
    pressure_msl: 1011.4,
    wind_speed_10m: 5.8,
    wind_direction_10m: 283,
    wind_gusts_10m: 9.6,
    visibility: 52800,
    uv_index: 4.3,
  },
  hourly: {
    time: ["2026-08-13T10:00", "2026-08-13T11:00", "2026-08-14T10:00", "2026-08-15T10:00"],
    temperature_2m: [77.8, 79.1, 76, 75.2],
    precipitation_probability: [0, 2, 8, 20],
    weather_code: [3, 1, 61, 95],
  },
  daily: {
    time: ["2026-08-13", "2026-08-14", "2026-08-15"],
    weather_code: [3, 61, 95],
    temperature_2m_max: [87.5, 86.4, 83.7],
    temperature_2m_min: [71.8, 66.7, 70.4],
    precipitation_probability_max: [12, 30, 70],
    sunrise: ["2026-08-13T06:04", "2026-08-14T06:05", "2026-08-15T06:06"],
    sunset: ["2026-08-13T19:57", "2026-08-14T19:56", "2026-08-15T19:54"],
  },
};

test("conditionFromWmo maps representative WMO codes and day/night icons", () => {
  assert.deepEqual(conditionFromWmo(0, true), {
    text: "Sunny",
    icon: "./images/weather/clear-day.svg",
    code: 0,
  });
  assert.equal(conditionFromWmo(0, false).text, "Clear");
  assert.match(conditionFromWmo(0, false).icon, /clear-night/);
  assert.equal(conditionFromWmo(65).text, "Heavy rain");
  assert.equal(conditionFromWmo(75).text, "Heavy snow");
  assert.equal(conditionFromWmo(99).text, "Severe thunderstorms with hail");
});

test("conditionFromWmo safely falls back for an unknown code", () => {
  const condition = conditionFromWmo(999);
  assert.equal(condition.text, "Overcast");
  assert.match(condition.icon, /cloudy/);
});

test("normalizeOpenMeteoWeather preserves the Weather renderer contract", () => {
  const data = normalizeOpenMeteoWeather(location, forecast);

  assert.equal(data.location.name, "New York");
  assert.equal(data.location.localtime, "2026-08-13 10:15");
  assert.equal(data.current.temp_f, 77.8);
  assert.equal(data.current.feelslike_f, 83.2);
  assert.equal(data.current.humidity, 74);
  assert.equal(data.current.wind_dir, "WNW");
  assert.equal(data.current.vis_miles, 10);
  assert.equal(data.current.pressure_mb, 1011.4);
  assert.equal(data.current.condition.text, "Overcast");
  assert.equal(data.forecast.forecastday.length, 3);
  assert.equal(data.forecast.forecastday[0].day.maxtemp_f, 87.5);
  assert.equal(data.forecast.forecastday[0].astro.sunrise, "6:04 AM");
  assert.equal(data.forecast.forecastday[1].hour[0].condition.text, "Light rain");
  assert.ok(Number.isFinite(data.current.last_updated_epoch));
});

test("normalizeOpenMeteoWeather rejects malformed provider responses", () => {
  assert.throws(() => normalizeOpenMeteoWeather(location, {}), /unavailable/i);
  assert.throws(
    () => normalizeOpenMeteoWeather(location, { current: {}, hourly: { time: [] }, daily: { time: [] } }),
    /unavailable/i,
  );
});

test("moonPhaseForDate returns a stable astronomical phase", () => {
  assert.equal(moonPhaseForDate("2000-01-06"), "New Moon");
  assert.equal(moonPhaseForDate("invalid"), "Unavailable");
});

test("fetchOpenMeteoWeather geocodes first, then requests a timezone-local 3-day forecast", async () => {
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(new URL(url));
    return {
      ok: true,
      json: async () => urls.length === 1 ? { results: [location] } : forecast,
    };
  };

  const data = await fetchOpenMeteoWeather("  New York  ", { fetchImpl });
  assert.equal(data.location.name, "New York");
  assert.equal(urls[0].hostname, "geocoding-api.open-meteo.com");
  assert.equal(urls[0].searchParams.get("name"), "New York");
  assert.equal(urls[1].hostname, "api.open-meteo.com");
  assert.equal(urls[1].searchParams.get("timezone"), "America/New_York");
  assert.equal(urls[1].searchParams.get("forecast_days"), "3");
  assert.match(urls[1].searchParams.get("current"), /visibility/);
});

test("fetchOpenMeteoWeather handles no-match and provider failure states", async () => {
  await assert.rejects(
    fetchOpenMeteoWeather("missing", { fetchImpl: async () => ({ ok: true, json: async () => ({ results: [] }) }) }),
    /No matching location/i,
  );
  await assert.rejects(
    fetchOpenMeteoWeather("New York", { fetchImpl: async () => { throw new Error("network internals"); } }),
    /unavailable/i,
  );
});
