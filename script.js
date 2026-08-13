import { fetchOpenMeteoWeather } from "./services/open-meteo-weather.js";

const app = document.querySelector(".weather-app");
const form = document.querySelector("#locationForm");
const searchInput = document.querySelector("#locationSearch");
const errorMessage = document.querySelector("#errorMessage");
const errorText = document.querySelector("#errorText");
const retryButton = document.querySelector("#retryButton");
const liveRegion = document.querySelector("#liveRegion");
const quickLocations = document.querySelectorAll(".quick-location");

const output = {
  locationName: document.querySelector("#locationName"),
  locationRegion: document.querySelector("#locationRegion"),
  currentTemp: document.querySelector("#currentTemp"),
  currentCondition: document.querySelector("#currentCondition"),
  currentIcon: document.querySelector("#currentIcon"),
  feelsLike: document.querySelector("#feelsLike"),
  feelsLikeDetail: document.querySelector("#feelsLikeDetail"),
  highTemp: document.querySelector("#highTemp"),
  lowTemp: document.querySelector("#lowTemp"),
  localDate: document.querySelector("#localDate"),
  localTime: document.querySelector("#localTime"),
  lastUpdated: document.querySelector("#lastUpdated"),
  forecastLocation: document.querySelector("#forecastLocation"),
  dailyForecast: document.querySelector("#dailyForecast"),
  hourlyForecast: document.querySelector("#hourlyForecast"),
  humidity: document.querySelector("#humidity"),
  humidityNote: document.querySelector("#humidityNote"),
  wind: document.querySelector("#wind"),
  windNote: document.querySelector("#windNote"),
  visibility: document.querySelector("#visibility"),
  visibilityNote: document.querySelector("#visibilityNote"),
  pressure: document.querySelector("#pressure"),
  uvIndex: document.querySelector("#uvIndex"),
  uvNote: document.querySelector("#uvNote"),
  precipitation: document.querySelector("#precipitation"),
  precipitationNote: document.querySelector("#precipitationNote"),
  cloudCover: document.querySelector("#cloudCover"),
  cloudNote: document.querySelector("#cloudNote"),
  sunrise: document.querySelector("#sunrise"),
  sunset: document.querySelector("#sunset"),
  moonPhase: document.querySelector("#moonPhase"),
  daylightDuration: document.querySelector("#daylightDuration"),
  sunPosition: document.querySelector("#sunPosition"),
};

let currentLocation = "New York";
let lastSuccessfulLocation = currentLocation;
let activeRequest;

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const location = searchInput.value.trim();

  if (!location) {
    showError("Enter a city, postcode, or location to continue.");
    searchInput.focus();
    return;
  }

  currentLocation = location;
  fetchWeatherData(location);
});

quickLocations.forEach((button) => {
  button.addEventListener("click", () => {
    currentLocation = button.dataset.location;
    fetchWeatherData(currentLocation);
  });
});

retryButton.addEventListener("click", () => {
  fetchWeatherData(currentLocation || lastSuccessfulLocation);
});

async function fetchWeatherData(location) {
  if (activeRequest) {
    activeRequest.abort();
  }

  const controller = new AbortController();
  activeRequest = controller;
  setLoading(true);
  hideError();

  try {
    const data = await fetchOpenMeteoWeather(location, { signal: controller.signal });

    renderWeather(data);
    lastSuccessfulLocation = location;
    searchInput.value = "";
    announce(`Weather updated for ${data.location.name}.`);
  } catch (error) {
    if (error.name === "AbortError") return;

    const message = /no matching location/i.test(error.message)
      ? "No matching location was found. Check the spelling and try again."
      : error.message || "We couldn’t retrieve weather information. Please try again.";

    showError(message);
    announce(message);
  } finally {
    if (activeRequest === controller) {
      activeRequest = null;
      setLoading(false);
    }
  }
}

function renderWeather(data) {
  const { current, location, forecast } = data;
  const today = forecast.forecastday[0];
  const [localDate, localTime] = location.localtime.split(" ");
  const regionLine = [location.region, location.country].filter(Boolean).join(", ");

  output.locationName.textContent = location.name;
  output.locationRegion.textContent = regionLine;
  output.currentTemp.textContent = Math.round(current.temp_f);
  output.currentCondition.textContent = current.condition.text;
  output.currentIcon.src = normalizeIconUrl(current.condition.icon);
  output.currentIcon.alt = `${current.condition.text} weather icon`;
  output.feelsLike.textContent = `${Math.round(current.feelslike_f)}°`;
  output.feelsLikeDetail.textContent = `${Math.round(current.feelslike_f)}°F`;
  output.highTemp.textContent = `${Math.round(today.day.maxtemp_f)}°`;
  output.lowTemp.textContent = `${Math.round(today.day.mintemp_f)}°`;
  output.localDate.textContent = formatDate(localDate, { weekday: "long", month: "long", day: "numeric" });
  output.localTime.textContent = formatTime(localTime);
  output.lastUpdated.textContent = formatTime(current.last_updated.split(" ")[1]);
  output.forecastLocation.textContent = location.name;

  renderMetrics(current, today);
  renderDailyForecast(forecast.forecastday);
  renderHourlyForecast(forecast.forecastday, current.last_updated_epoch);
  renderAstronomy(today.astro, location.localtime);
  updateAtmosphere(current);
  updateActiveLocation(location.name);
}

function renderMetrics(current, today) {
  output.humidity.textContent = `${current.humidity}%`;
  output.humidityNote.textContent = describeHumidity(current.humidity);
  output.wind.textContent = `${formatDecimal(current.wind_mph)} mph`;
  output.windNote.textContent = `${current.wind_dir} · Gusts ${formatDecimal(current.gust_mph)} mph`;
  output.visibility.textContent = `${formatDecimal(current.vis_miles)} mi`;
  output.visibilityNote.textContent = describeVisibility(current.vis_miles);
  output.pressure.textContent = `${Math.round(current.pressure_mb)} mb`;
  output.uvIndex.textContent = formatDecimal(current.uv);
  output.uvNote.textContent = describeUv(current.uv);
  output.precipitation.textContent = `${formatDecimal(current.precip_in)} in`;
  output.precipitationNote.textContent = `${today.day.daily_chance_of_rain}% chance today`;
  output.cloudCover.textContent = `${current.cloud}%`;
  output.cloudNote.textContent = describeCloudCover(current.cloud);
}

function renderDailyForecast(days) {
  output.dailyForecast.replaceChildren();

  days.forEach((forecastDay, index) => {
    const item = createElement("article", `forecast-day${index === 0 ? " forecast-day--today" : ""}`);
    const date = createElement("div", "forecast-day__date");
    const dateTitle = createElement("strong", "", index === 0 ? "Today" : formatDate(forecastDay.date, { weekday: "short" }));
    const dateLabel = createElement("span", "", formatDate(forecastDay.date, { month: "short", day: "numeric" }));
    date.append(dateTitle, dateLabel);

    const icon = document.createElement("img");
    icon.src = normalizeIconUrl(forecastDay.day.condition.icon);
    icon.alt = "";
    icon.width = 42;
    icon.height = 42;
    icon.loading = index === 0 ? "eager" : "lazy";
    icon.decoding = "async";

    const condition = createElement("div", "forecast-day__condition");
    condition.append(
      createElement("strong", "", forecastDay.day.condition.text),
      createElement("span", "", `${forecastDay.day.daily_chance_of_rain}% rain`),
    );

    const temperatures = createElement("div", "forecast-day__temps");
    temperatures.setAttribute("aria-label", `High ${Math.round(forecastDay.day.maxtemp_f)} degrees, low ${Math.round(forecastDay.day.mintemp_f)} degrees`);
    temperatures.append(
      createElement("strong", "", `${Math.round(forecastDay.day.maxtemp_f)}°`),
      createElement("span", "", `${Math.round(forecastDay.day.mintemp_f)}°`),
    );

    item.append(date, icon, condition, temperatures);
    output.dailyForecast.append(item);
  });
}

function renderHourlyForecast(days, currentEpoch) {
  const upcomingHours = days
    .flatMap((day) => day.hour)
    .filter((hour) => hour.time_epoch >= currentEpoch - 1800)
    .slice(0, 10);

  output.hourlyForecast.replaceChildren();

  upcomingHours.forEach((hour, index) => {
    const item = createElement("article", `hour-item${index === 0 ? " hour-item--now" : ""}`);
    const icon = document.createElement("img");
    icon.src = normalizeIconUrl(hour.condition.icon);
    icon.alt = hour.condition.text;
    icon.width = 46;
    icon.height = 46;
    icon.loading = index < 3 ? "eager" : "lazy";
    icon.decoding = "async";

    item.append(
      createElement("span", "", index === 0 ? "Now" : formatTime(hour.time.split(" ")[1])),
      icon,
      createElement("strong", "", `${Math.round(hour.temp_f)}°`),
      createElement("small", "", `${hour.chance_of_rain}% rain`),
    );
    output.hourlyForecast.append(item);
  });
}

function renderAstronomy(astro, localDateTime) {
  output.sunrise.textContent = astro.sunrise;
  output.sunset.textContent = astro.sunset;
  output.moonPhase.textContent = astro.moon_phase;

  const sunriseMinutes = parseTwelveHourTime(astro.sunrise);
  const sunsetMinutes = parseTwelveHourTime(astro.sunset);
  const currentMinutes = parseTwentyFourHourTime(localDateTime.split(" ")[1]);
  const duration = Math.max(0, sunsetMinutes - sunriseMinutes);
  const hours = Math.floor(duration / 60);
  const minutes = duration % 60;
  output.daylightDuration.textContent = `${hours} hr ${minutes} min daylight`;

  const progress = Math.min(1, Math.max(0, (currentMinutes - sunriseMinutes) / duration));
  const left = 2 + progress * 96;
  const top = 86 - Math.sin(progress * Math.PI) * 70;
  output.sunPosition.style.left = `${left}%`;
  output.sunPosition.style.top = `${top}%`;
}

function updateAtmosphere(current) {
  const timeOfDay = current.is_day ? "day" : "night";
  const weatherType = classifyWeather(current.condition.text, current.condition.code);
  const imageType = weatherType === "storm" || weatherType === "rain"
    ? "rainy"
    : weatherType === "snow"
      ? "snowy"
      : weatherType;

  app.dataset.time = timeOfDay;
  app.dataset.weather = weatherType;
  app.style.setProperty("--weather-image", `url("./images/${timeOfDay}/${imageType}.jpg")`);
}

function classifyWeather(conditionText, conditionCode) {
  const text = conditionText.toLowerCase();

  if (/thunder|storm/.test(text) || [1087, 1273, 1276, 1279, 1282].includes(conditionCode)) return "storm";
  if (/snow|sleet|blizzard|ice|freezing/.test(text)) return "snow";
  if (/rain|drizzle|shower/.test(text)) return "rain";
  if (/cloud|overcast|mist|fog/.test(text)) return "cloudy";
  return "clear";
}

function updateActiveLocation(locationName) {
  const normalizedName = normalizeLocationName(locationName);

  quickLocations.forEach((button) => {
    const buttonName = normalizeLocationName(button.dataset.location);
    const isCurrent = buttonName.startsWith(normalizedName) || normalizedName.startsWith(buttonName);
    if (isCurrent) button.setAttribute("aria-current", "true");
    else button.removeAttribute("aria-current");
  });
}

function setLoading(isLoading) {
  form.classList.toggle("is-loading", isLoading);
  form.setAttribute("aria-busy", String(isLoading));
  searchInput.toggleAttribute("disabled", isLoading);
  form.querySelector("button").toggleAttribute("disabled", isLoading);
  quickLocations.forEach((button) => button.toggleAttribute("disabled", isLoading));
}

function showError(message) {
  errorText.textContent = message;
  errorMessage.hidden = false;
}

function hideError() {
  errorMessage.hidden = true;
}

function announce(message) {
  liveRegion.textContent = "";
  window.setTimeout(() => {
    liveRegion.textContent = message;
  }, 50);
}

function createElement(tagName, className = "", text = "") {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  if (text !== "") element.textContent = text;
  return element;
}

function normalizeIconUrl(url) {
  return url.startsWith("//") ? `https:${url}` : url;
}

function normalizeLocationName(name) {
  return name.toLowerCase().replace(/\bcity\b/g, "").replace(/[^a-z0-9]/g, "");
}

function formatDate(dateString, options) {
  const date = new Date(`${dateString}T12:00:00`);
  return new Intl.DateTimeFormat("en-US", options).format(date);
}

function formatTime(timeString) {
  const [hour, minute] = timeString.split(":").map(Number);
  const date = new Date(2000, 0, 1, hour, minute);
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(date);
}

function formatDecimal(value) {
  const numericValue = Number(value);
  return Number.isInteger(numericValue) ? String(numericValue) : numericValue.toFixed(1);
}

function parseTwelveHourTime(time) {
  const match = time.match(/(\d+):(\d+)\s*(AM|PM)/i);
  if (!match) return 0;
  let hour = Number(match[1]) % 12;
  if (match[3].toUpperCase() === "PM") hour += 12;
  return hour * 60 + Number(match[2]);
}

function parseTwentyFourHourTime(time) {
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + minute;
}

function describeHumidity(value) {
  if (value >= 80) return "Very humid";
  if (value >= 60) return "Humid";
  if (value >= 30) return "Comfortable";
  return "Dry air";
}

function describeVisibility(value) {
  if (value >= 10) return "Excellent clarity";
  if (value >= 5) return "Good visibility";
  if (value >= 2) return "Reduced visibility";
  return "Low visibility";
}

function describeUv(value) {
  if (value <= 2) return "Low exposure";
  if (value <= 5) return "Moderate exposure";
  if (value <= 7) return "High exposure";
  if (value <= 10) return "Very high exposure";
  return "Extreme exposure";
}

function describeCloudCover(value) {
  if (value <= 10) return "Mostly clear";
  if (value <= 40) return "Partly cloudy";
  if (value <= 75) return "Mostly cloudy";
  return "Overcast skies";
}

fetchWeatherData(currentLocation);
