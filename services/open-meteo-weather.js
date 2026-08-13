const GEOCODING_ENDPOINT = "https://geocoding-api.open-meteo.com/v1/search";
const FORECAST_ENDPOINT = "https://api.open-meteo.com/v1/forecast";
const MAX_LOCATION_LENGTH = 200;

const CURRENT_FIELDS = [
  "temperature_2m",
  "relative_humidity_2m",
  "apparent_temperature",
  "is_day",
  "precipitation",
  "weather_code",
  "cloud_cover",
  "pressure_msl",
  "wind_speed_10m",
  "wind_direction_10m",
  "wind_gusts_10m",
  "visibility",
  "uv_index",
];

const HOURLY_FIELDS = ["temperature_2m", "precipitation_probability", "weather_code"];
const DAILY_FIELDS = [
  "weather_code",
  "temperature_2m_max",
  "temperature_2m_min",
  "precipitation_probability_max",
  "sunrise",
  "sunset",
];

const ICONS = Object.freeze({
  clearDay: "./images/weather/clear-day.svg",
  clearNight: "./images/weather/clear-night.svg",
  cloudy: "./images/weather/cloudy.svg",
  rain: "./images/weather/rain.svg",
  snow: "./images/weather/snow.svg",
  storm: "./images/weather/storm.svg",
});

const WMO_CONDITIONS = Object.freeze({
  0: { day: "Sunny", night: "Clear", icon: "clear" },
  1: { day: "Mostly sunny", night: "Mostly clear", icon: "clear" },
  2: { day: "Partly cloudy", night: "Partly cloudy", icon: "cloudy" },
  3: { day: "Overcast", night: "Overcast", icon: "cloudy" },
  45: { day: "Fog", night: "Fog", icon: "cloudy" },
  48: { day: "Freezing fog", night: "Freezing fog", icon: "cloudy" },
  51: { day: "Light drizzle", night: "Light drizzle", icon: "rain" },
  53: { day: "Drizzle", night: "Drizzle", icon: "rain" },
  55: { day: "Heavy drizzle", night: "Heavy drizzle", icon: "rain" },
  56: { day: "Light freezing drizzle", night: "Light freezing drizzle", icon: "rain" },
  57: { day: "Freezing drizzle", night: "Freezing drizzle", icon: "rain" },
  61: { day: "Light rain", night: "Light rain", icon: "rain" },
  63: { day: "Moderate rain", night: "Moderate rain", icon: "rain" },
  65: { day: "Heavy rain", night: "Heavy rain", icon: "rain" },
  66: { day: "Light freezing rain", night: "Light freezing rain", icon: "rain" },
  67: { day: "Freezing rain", night: "Freezing rain", icon: "rain" },
  71: { day: "Light snow", night: "Light snow", icon: "snow" },
  73: { day: "Moderate snow", night: "Moderate snow", icon: "snow" },
  75: { day: "Heavy snow", night: "Heavy snow", icon: "snow" },
  77: { day: "Snow grains", night: "Snow grains", icon: "snow" },
  80: { day: "Light rain showers", night: "Light rain showers", icon: "rain" },
  81: { day: "Rain showers", night: "Rain showers", icon: "rain" },
  82: { day: "Heavy rain showers", night: "Heavy rain showers", icon: "rain" },
  85: { day: "Light snow showers", night: "Light snow showers", icon: "snow" },
  86: { day: "Heavy snow showers", night: "Heavy snow showers", icon: "snow" },
  95: { day: "Thunderstorms", night: "Thunderstorms", icon: "storm" },
  96: { day: "Thunderstorms with hail", night: "Thunderstorms with hail", icon: "storm" },
  99: { day: "Severe thunderstorms with hail", night: "Severe thunderstorms with hail", icon: "storm" },
});

export async function fetchOpenMeteoWeather(locationQuery, { signal, fetchImpl = fetch } = {}) {
  const query = typeof locationQuery === "string" ? locationQuery.trim() : "";
  if (!query) throw new Error("Enter a city, postcode, or location to continue.");
  if (query.length > MAX_LOCATION_LENGTH) throw new Error("The location query is too long.");

  const location = await geocodeLocation(query, { signal, fetchImpl });
  const forecast = await fetchForecast(location, { signal, fetchImpl });
  return normalizeOpenMeteoWeather(location, forecast);
}

export async function geocodeLocation(query, { signal, fetchImpl = fetch } = {}) {
  const params = new URLSearchParams({ name: query, count: "1", language: "en", format: "json" });
  const data = await fetchJson(`${GEOCODING_ENDPOINT}?${params}`, { signal, fetchImpl });
  const location = Array.isArray(data?.results) ? data.results[0] : null;

  if (!location) throw new Error("No matching location found.");
  if (!Number.isFinite(location.latitude) || !Number.isFinite(location.longitude) || !location.timezone) {
    throw new Error("Weather information is unavailable right now.");
  }
  return location;
}

export async function fetchForecast(location, { signal, fetchImpl = fetch } = {}) {
  const params = new URLSearchParams({
    latitude: String(location.latitude),
    longitude: String(location.longitude),
    current: CURRENT_FIELDS.join(","),
    hourly: HOURLY_FIELDS.join(","),
    daily: DAILY_FIELDS.join(","),
    temperature_unit: "fahrenheit",
    wind_speed_unit: "mph",
    precipitation_unit: "inch",
    timezone: location.timezone,
    forecast_days: "3",
  });
  return fetchJson(`${FORECAST_ENDPOINT}?${params}`, { signal, fetchImpl });
}

export function normalizeOpenMeteoWeather(location, data) {
  const current = data?.current;
  const hourly = data?.hourly;
  const daily = data?.daily;
  const offsetSeconds = finiteNumber(data?.utc_offset_seconds, 0);

  if (!current?.time || !Array.isArray(hourly?.time) || !Array.isArray(daily?.time) || daily.time.length < 3) {
    throw new Error("Weather information is unavailable right now.");
  }

  const currentCondition = conditionFromWmo(current.weather_code, current.is_day === 1);
  const forecastDays = daily.time.slice(0, 3).map((date, dayIndex) => ({
    date,
    day: {
      maxtemp_f: finiteNumber(daily.temperature_2m_max?.[dayIndex]),
      mintemp_f: finiteNumber(daily.temperature_2m_min?.[dayIndex]),
      daily_chance_of_rain: finiteNumber(daily.precipitation_probability_max?.[dayIndex], 0),
      condition: conditionFromWmo(daily.weather_code?.[dayIndex], true),
    },
    astro: {
      sunrise: toTwelveHourTime(daily.sunrise?.[dayIndex]),
      sunset: toTwelveHourTime(daily.sunset?.[dayIndex]),
      moon_phase: moonPhaseForDate(date),
    },
    hour: hourly.time
      .map((time, hourIndex) => ({ time, hourIndex }))
      .filter(({ time }) => time?.startsWith(`${date}T`))
      .map(({ time, hourIndex }) => ({
        time: time.replace("T", " "),
        time_epoch: localIsoToEpoch(time, offsetSeconds),
        temp_f: finiteNumber(hourly.temperature_2m?.[hourIndex]),
        chance_of_rain: finiteNumber(hourly.precipitation_probability?.[hourIndex], 0),
        condition: conditionFromWmo(hourly.weather_code?.[hourIndex], hourIsDay(time, daily, dayIndex)),
      })),
  }));

  const currentLocalTime = current.time.replace("T", " ");
  return {
    location: {
      name: String(location.name || "Selected location"),
      region: String(location.admin1 || location.admin2 || ""),
      country: String(location.country || location.country_code || ""),
      localtime: currentLocalTime,
    },
    current: {
      temp_f: finiteNumber(current.temperature_2m),
      feelslike_f: finiteNumber(current.apparent_temperature),
      condition: currentCondition,
      is_day: current.is_day === 1 ? 1 : 0,
      humidity: finiteNumber(current.relative_humidity_2m),
      wind_mph: finiteNumber(current.wind_speed_10m),
      wind_dir: compassDirection(current.wind_direction_10m),
      gust_mph: finiteNumber(current.wind_gusts_10m),
      vis_miles: finiteNumber(current.visibility) / 5280,
      pressure_mb: finiteNumber(current.pressure_msl),
      uv: finiteNumber(current.uv_index),
      precip_in: finiteNumber(current.precipitation),
      cloud: finiteNumber(current.cloud_cover),
      last_updated: currentLocalTime,
      last_updated_epoch: localIsoToEpoch(current.time, offsetSeconds),
    },
    forecast: { forecastday: forecastDays },
  };
}

export function conditionFromWmo(code, isDay = true) {
  const numericCode = Number(code);
  const condition = WMO_CONDITIONS[numericCode] || WMO_CONDITIONS[3];
  const icon = condition.icon === "clear"
    ? isDay ? ICONS.clearDay : ICONS.clearNight
    : ICONS[condition.icon];
  return { text: isDay ? condition.day : condition.night, icon, code: numericCode };
}

export function moonPhaseForDate(dateString) {
  const date = new Date(`${dateString}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return "Unavailable";

  const knownNewMoon = Date.UTC(2000, 0, 6, 18, 14);
  const synodicMonthDays = 29.530588853;
  const daysSince = (date.getTime() - knownNewMoon) / 86_400_000;
  const age = ((daysSince % synodicMonthDays) + synodicMonthDays) % synodicMonthDays;

  if (age < 1.84566 || age >= 27.68493) return "New Moon";
  if (age < 5.53699) return "Waxing Crescent";
  if (age < 9.22831) return "First Quarter";
  if (age < 12.91963) return "Waxing Gibbous";
  if (age < 16.61096) return "Full Moon";
  if (age < 20.30228) return "Waning Gibbous";
  if (age < 23.99361) return "Last Quarter";
  return "Waning Crescent";
}

function hourIsDay(time, daily, dayIndex) {
  const sunrise = daily.sunrise?.[dayIndex];
  const sunset = daily.sunset?.[dayIndex];
  return !sunrise || !sunset || (time >= sunrise && time < sunset);
}

function localIsoToEpoch(localIso, offsetSeconds) {
  const utcLike = Date.parse(`${localIso}:00Z`);
  return Number.isFinite(utcLike) ? Math.floor((utcLike - offsetSeconds * 1000) / 1000) : 0;
}

function toTwelveHourTime(isoDateTime) {
  const time = String(isoDateTime || "").split("T")[1];
  if (!time) return "Unavailable";
  const [hourValue, minute = "00"] = time.split(":");
  const hour = Number(hourValue);
  if (!Number.isFinite(hour)) return "Unavailable";
  const period = hour >= 12 ? "PM" : "AM";
  return `${hour % 12 || 12}:${minute} ${period}`;
}

function compassDirection(value) {
  const degrees = finiteNumber(value, 0);
  const directions = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  return directions[Math.round(((degrees % 360) + 360) % 360 / 22.5) % 16];
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

async function fetchJson(url, { signal, fetchImpl }) {
  let response;
  try {
    response = await fetchImpl(url, { signal });
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    throw new Error("Weather information is unavailable right now.");
  }

  const data = await response.json().catch(() => null);
  if (!response.ok || !data || data.error) {
    throw new Error(data?.reason || "Weather information is unavailable right now.");
  }
  return data;
}
