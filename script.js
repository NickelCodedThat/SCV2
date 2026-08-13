import {
  fetchOpenMeteoWeather,
  fetchOpenMeteoWeatherForLocation,
} from "./services/open-meteo-weather.js";
import { fetchLocationSuggestions } from "./services/location-suggestions.js";
import { getCurrentCoordinates } from "./services/geolocation.js";
import { reverseGeocodeCoordinates } from "./services/reverse-geocode.js";
import {
  getQuickLocations,
  isSaved as isQuickLocationSaved,
  saveLocation as saveQuickLocation,
  removeLocation as removeQuickLocation,
  buildLocationId,
  QUICK_LOCATIONS_MAX,
} from "./services/quick-locations.js";
import { findNearestTideStation } from "./services/noaa-tide-stations.js";
import { fetchTidePredictions } from "./services/noaa-tide-predictions.js";
import { normalizeTidePredictions } from "./utils/tide-normalize.js";
import { createSvgUse } from "./utils/dom.js";

const AUTOCOMPLETE_DELAY_MS = 250;
const SVG_NS = "http://www.w3.org/2000/svg";
const TIDE_CHART_WIDTH = 400;
const TIDE_CHART_HEIGHT = 160;
const TIDE_CHART_PADDING = { top: 14, right: 10, bottom: 22, left: 10 };

const app = document.querySelector(".weather-app");
const form = document.querySelector("#locationForm");
const searchInput = document.querySelector("#locationSearch");
const suggestions = document.querySelector("#locationSuggestions");
const errorMessage = document.querySelector("#errorMessage");
const errorHeading = document.querySelector("#errorHeading");
const errorText = document.querySelector("#errorText");
const DEFAULT_ERROR_HEADING = errorHeading.textContent;
const retryButton = document.querySelector("#retryButton");
const liveRegion = document.querySelector("#liveRegion");
const currentLocationButton = document.querySelector("#currentLocationButton");
const saveQuickLocationButton = document.querySelector("#saveQuickLocationButton");
const quickLocationsList = document.querySelector("#quickLocationsList");
const tideSection = document.querySelector("#tideSection");
const tideStationLabel = document.querySelector("#tideStationLabel");
const tideNextHigh = document.querySelector("#tideNextHigh");
const tideNextLow = document.querySelector("#tideNextLow");
const tideChart = document.querySelector("#tideChart");
const tideCaption = document.querySelector("#tideCaption");

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
let suggestionRequest;
let suggestionTimer;
let suggestionSequence = 0;
let suggestionResults = [];
let activeSuggestionIndex = -1;
let currentLocationRecord = null; // full {name, admin1, ..., latitude, longitude, timezone} for whatever's on screen
let tideRequestController = null;
let tideRequestSequence = 0;

form.addEventListener("submit", (event) => {
  event.preventDefault();

  if (activeSuggestionIndex >= 0 && suggestionResults[activeSuggestionIndex]) {
    selectSuggestion(suggestionResults[activeSuggestionIndex]);
    return;
  }

  const location = searchInput.value.trim();

  if (!location) {
    showError("Enter a city, postcode, or location to continue.");
    searchInput.focus();
    return;
  }

  currentLocation = location;
  closeSuggestions();
  fetchWeatherData(location);
});

searchInput.addEventListener("input", () => {
  const query = searchInput.value.trim();
  window.clearTimeout(suggestionTimer);
  suggestionRequest?.abort();
  suggestionRequest = null;
  suggestionSequence += 1;
  suggestionResults = [];
  activeSuggestionIndex = -1;
  suggestions.hidden = true;
  suggestions.replaceChildren();
  searchInput.setAttribute("aria-expanded", "false");
  searchInput.removeAttribute("aria-activedescendant");

  if (!query) {
    closeSuggestions();
    return;
  }

  const requestSequence = suggestionSequence;
  suggestionTimer = window.setTimeout(() => {
    loadSuggestions(query, requestSequence);
  }, AUTOCOMPLETE_DELAY_MS);
});

searchInput.addEventListener("keydown", (event) => {
  if (suggestions.hidden) return;

  if (event.key === "ArrowDown") {
    event.preventDefault();
    moveActiveSuggestion(1);
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    moveActiveSuggestion(-1);
  } else if (event.key === "Enter" && activeSuggestionIndex >= 0) {
    event.preventDefault();
    selectSuggestion(suggestionResults[activeSuggestionIndex]);
  } else if (event.key === "Escape") {
    event.preventDefault();
    closeSuggestions();
  }
});

document.addEventListener("click", (event) => {
  if (!form.contains(event.target)) closeSuggestions();
});

retryButton.addEventListener("click", () => {
  fetchWeatherData(currentLocation || lastSuccessfulLocation);
});

currentLocationButton.addEventListener("click", async () => {
  if (currentLocationButton.disabled) return;
  currentLocationButton.disabled = true;
  closeSuggestions();
  setLoading(true);
  hideError();

  try {
    const coordinates = await getCurrentCoordinates();
    const resolvedLocation = await reverseGeocodeCoordinates(coordinates.latitude, coordinates.longitude);
    currentLocation = resolvedLocation.name;
    searchInput.value = "";
    await fetchWeatherData(currentLocation, resolvedLocation);
  } catch (error) {
    setLoading(false);
    const message = error.message || "We couldn’t use your location right now.";
    showError(message);
    announce(message);
  } finally {
    currentLocationButton.disabled = false;
  }
});

saveQuickLocationButton.addEventListener("click", () => {
  if (!currentLocationRecord) return;

  const id = buildLocationId(currentLocationRecord.latitude, currentLocationRecord.longitude);
  if (isQuickLocationSaved(id)) {
    removeQuickLocation(id);
  } else {
    const result = saveQuickLocation(currentLocationRecord);
    if (!result.ok) {
      const message = result.reason === "limit"
        ? `You’ve reached the quick locations limit (${QUICK_LOCATIONS_MAX}). Remove one to add another.`
        : "This location couldn’t be saved right now.";
      showError(message, "Quick locations is full.");
      announce(message);
      return;
    }
  }

  renderQuickLocationsList();
  updateSaveQuickLocationButton();
});

async function fetchWeatherData(location, resolvedLocation = null) {
  if (activeRequest) {
    activeRequest.abort();
  }

  const controller = new AbortController();
  activeRequest = controller;
  setLoading(true);
  hideError();

  try {
    const data = resolvedLocation
      ? await fetchOpenMeteoWeatherForLocation(resolvedLocation, { signal: controller.signal })
      : await fetchOpenMeteoWeather(location, { signal: controller.signal });

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

async function loadSuggestions(query, requestSequence) {
  const controller = new AbortController();
  suggestionRequest = controller;

  try {
    const results = await fetchLocationSuggestions(query, { signal: controller.signal });
    if (requestSequence !== suggestionSequence || searchInput.value.trim() !== query) return;

    if (results.length === 0) {
      renderSuggestionMessage("No matching locations.");
      return;
    }
    renderSuggestions(results);
  } catch (error) {
    if (error.name === "AbortError" || requestSequence !== suggestionSequence) return;
    renderSuggestionMessage("Suggestions unavailable. You can still search normally.");
  } finally {
    if (suggestionRequest === controller) suggestionRequest = null;
  }
}

function renderSuggestions(results) {
  suggestionResults = results;
  activeSuggestionIndex = -1;
  suggestions.replaceChildren();

  results.forEach((location, index) => {
    const option = createElement("button", "location-suggestion");
    option.type = "button";
    option.id = `location-suggestion-${index}`;
    option.setAttribute("role", "option");
    option.setAttribute("aria-selected", "false");
    option.append(
      createElement("strong", "", location.name),
      createElement("span", "", formatLocationSuggestion(location)),
    );
    option.addEventListener("click", () => selectSuggestion(location));
    suggestions.append(option);
  });

  suggestions.hidden = false;
  searchInput.setAttribute("aria-expanded", "true");
  searchInput.removeAttribute("aria-activedescendant");
}

function renderSuggestionMessage(message) {
  suggestionResults = [];
  activeSuggestionIndex = -1;
  suggestions.replaceChildren(createElement("p", "location-suggestions__message", message));
  suggestions.hidden = false;
  searchInput.setAttribute("aria-expanded", "true");
  searchInput.removeAttribute("aria-activedescendant");
}

function moveActiveSuggestion(direction) {
  if (suggestionResults.length === 0) return;
  activeSuggestionIndex = (activeSuggestionIndex + direction + suggestionResults.length) % suggestionResults.length;

  suggestions.querySelectorAll("[role='option']").forEach((option, index) => {
    const isActive = index === activeSuggestionIndex;
    option.classList.toggle("is-active", isActive);
    option.setAttribute("aria-selected", String(isActive));
    if (isActive) {
      searchInput.setAttribute("aria-activedescendant", option.id);
      option.scrollIntoView({ block: "nearest" });
    }
  });
}

function selectSuggestion(location) {
  const label = formatLocationSuggestion(location, { includeName: true });
  currentLocation = label;
  searchInput.value = label;
  closeSuggestions();
  fetchWeatherData(label, location);
}

function closeSuggestions() {
  window.clearTimeout(suggestionTimer);
  suggestionRequest?.abort();
  suggestionRequest = null;
  suggestionSequence += 1;
  suggestionResults = [];
  activeSuggestionIndex = -1;
  suggestions.hidden = true;
  suggestions.replaceChildren();
  searchInput.setAttribute("aria-expanded", "false");
  searchInput.removeAttribute("aria-activedescendant");
}

function formatLocationSuggestion(location, { includeName = false } = {}) {
  const context = [location.admin1 || location.admin2, location.country]
    .filter(Boolean)
    .filter((value, index, values) => values.indexOf(value) === index);
  return [...(includeName ? [location.name] : []), ...context].join(", ");
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

  currentLocationRecord = {
    name: location.name,
    admin1: location.admin1,
    admin2: location.admin2,
    country: location.country,
    country_code: location.country_code,
    latitude: location.latitude,
    longitude: location.longitude,
    timezone: location.timezone,
  };
  updateSaveQuickLocationButton();
  renderQuickLocationsList();
  loadTides(location.latitude, location.longitude);
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

function renderQuickLocationsList() {
  const locations = getQuickLocations();
  const activeId = currentLocationRecord
    ? buildLocationId(currentLocationRecord.latitude, currentLocationRecord.longitude)
    : "";

  quickLocationsList.replaceChildren();

  if (locations.length === 0) {
    quickLocationsList.append(
      createElement("p", "quick-locations__empty", "No saved locations yet. Use the bookmark button above to save the current location."),
    );
    return;
  }

  locations.forEach((location) => {
    const item = createElement("div", "quick-location");
    if (location.id === activeId) item.setAttribute("aria-current", "true");

    const selectButton = createElement("button", "quick-location__select");
    selectButton.type = "button";
    const textWrap = createElement("span", "", location.name);
    const regionLine = [location.admin1 || location.admin2, location.country].filter(Boolean).join(", ");
    textWrap.append(createElement("small", "", regionLine));
    selectButton.append(createSvgUse("#icon-map-pin"), textWrap);
    selectButton.addEventListener("click", () => {
      currentLocation = location.name;
      closeSuggestions();
      searchInput.value = "";
      fetchWeatherData(location.name, location);
    });

    const removeButton = createElement("button", "quick-location__remove icon-button");
    removeButton.type = "button";
    removeButton.setAttribute("aria-label", `Remove ${location.name} from quick locations`);
    removeButton.append(createSvgUse("#icon-x"));
    removeButton.addEventListener("click", () => {
      removeQuickLocation(location.id);
      renderQuickLocationsList();
      updateSaveQuickLocationButton();
    });

    item.append(selectButton, removeButton);
    quickLocationsList.append(item);
  });
}

function updateSaveQuickLocationButton() {
  if (!currentLocationRecord || !Number.isFinite(currentLocationRecord.latitude) || !Number.isFinite(currentLocationRecord.longitude)) {
    saveQuickLocationButton.hidden = true;
    return;
  }

  saveQuickLocationButton.hidden = false;
  const id = buildLocationId(currentLocationRecord.latitude, currentLocationRecord.longitude);
  const saved = isQuickLocationSaved(id);
  saveQuickLocationButton.setAttribute("aria-pressed", String(saved));
  saveQuickLocationButton.setAttribute(
    "aria-label",
    saved ? `Remove ${currentLocationRecord.name} from quick locations` : `Save ${currentLocationRecord.name} to quick locations`,
  );
}

/**
 * Tide lookup runs after Weather has already rendered and never blocks or
 * fails it — a missing station, a NOAA outage, or malformed data all just
 * mean the Tide section stays hidden. Sequenced with a request counter (the
 * same pattern as the autocomplete requests above) so a slow lookup for a
 * previous location can never clobber a faster one for the current location.
 */
async function loadTides(latitude, longitude) {
  tideRequestController?.abort();
  const controller = new AbortController();
  tideRequestController = controller;
  const requestSequence = ++tideRequestSequence;

  hideTideSection();
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;

  try {
    const station = await findNearestTideStation(latitude, longitude, { signal: controller.signal });
    if (requestSequence !== tideRequestSequence) return;
    if (!station) return; // not a coastal location — no error, just no section

    const predictions = await fetchTidePredictions(station.id, { signal: controller.signal });
    if (requestSequence !== tideRequestSequence) return;

    const tide = normalizeTidePredictions(predictions, { stationName: station.name });
    renderTides(tide);
  } catch (error) {
    if (error.name === "AbortError") return;
    hideTideSection();
  }
}

function hideTideSection() {
  tideSection.hidden = true;
  tideChart.replaceChildren();
}

function renderTides(tide) {
  tideSection.hidden = false;
  tideStationLabel.textContent = tide.stationName;
  tideNextHigh.textContent = tide.nextHigh
    ? `${formatDecimal(tide.nextHigh.height)} ${tide.unit} at ${formatClockTime(tide.nextHigh.time)}`
    : "Unavailable";
  tideNextLow.textContent = tide.nextLow
    ? `${formatDecimal(tide.nextLow.height)} ${tide.unit} at ${formatClockTime(tide.nextLow.time)}`
    : "Unavailable";
  tideCaption.textContent =
    `Predictions for ${formatClockDate(tide.generatedAt)} · NOAA Tides & Currents · ${tide.datum} datum, ${tide.unit}.`;

  renderTideChart(tide);
}

function renderTideChart(tide) {
  tideChart.replaceChildren();
  tideChart.setAttribute("aria-label", buildTideChartAriaLabel(tide));

  const points = tide.curve;
  if (points.length < 2) return;

  const allHeights = points.map((point) => point.height).concat(tide.extremes.map((extreme) => extreme.height));
  const minTime = points[0].time.getTime();
  const maxTime = points[points.length - 1].time.getTime();
  const minHeight = Math.min(...allHeights);
  const maxHeight = Math.max(...allHeights);
  const heightPad = Math.max((maxHeight - minHeight) * 0.15, 0.2);
  const paddedMin = minHeight - heightPad;
  const paddedMax = maxHeight + heightPad;

  const chartLeft = TIDE_CHART_PADDING.left;
  const chartRight = TIDE_CHART_WIDTH - TIDE_CHART_PADDING.right;
  const chartTop = TIDE_CHART_PADDING.top;
  const chartBottom = TIDE_CHART_HEIGHT - TIDE_CHART_PADDING.bottom;

  const xFor = (time) => chartLeft + ((time - minTime) / (maxTime - minTime || 1)) * (chartRight - chartLeft);
  const yFor = (height) => chartBottom - ((height - paddedMin) / (paddedMax - paddedMin || 1)) * (chartBottom - chartTop);

  const linePoints = points.map((point) => `${xFor(point.time.getTime())},${yFor(point.height)}`).join(" ");
  const fillPoints = `${xFor(minTime)},${chartBottom} ${linePoints} ${xFor(maxTime)},${chartBottom}`;

  const fill = document.createElementNS(SVG_NS, "polygon");
  fill.setAttribute("class", "tide-chart__fill");
  fill.setAttribute("points", fillPoints);
  tideChart.append(fill);

  const line = document.createElementNS(SVG_NS, "polyline");
  line.setAttribute("class", "tide-chart__line");
  line.setAttribute("points", linePoints);
  tideChart.append(line);

  tide.extremes.forEach((extreme) => {
    const cx = xFor(extreme.time.getTime());
    const cy = yFor(extreme.height);

    const point = document.createElementNS(SVG_NS, "circle");
    point.setAttribute("class", "tide-chart__point");
    point.setAttribute("cx", cx);
    point.setAttribute("cy", cy);
    point.setAttribute("r", 3.5);
    tideChart.append(point);

    const label = document.createElementNS(SVG_NS, "text");
    label.setAttribute("x", cx);
    label.setAttribute("y", extreme.type === "high" ? Math.max(cy - 8, 10) : Math.min(cy + 16, TIDE_CHART_HEIGHT - TIDE_CHART_PADDING.bottom + 14));
    label.setAttribute("text-anchor", cx < 30 ? "start" : cx > chartRight - 30 ? "end" : "middle");
    label.textContent = `${extreme.type === "high" ? "H" : "L"} ${formatDecimal(extreme.height)}`;
    tideChart.append(label);
  });

  pickAxisTimeLabels(points).forEach(({ time, label: labelText }) => {
    const x = xFor(time.getTime());
    const label = document.createElementNS(SVG_NS, "text");
    label.setAttribute("x", x);
    label.setAttribute("y", TIDE_CHART_HEIGHT - 6);
    label.setAttribute("text-anchor", x < chartLeft + 20 ? "start" : x > chartRight - 20 ? "end" : "middle");
    label.textContent = labelText;
    tideChart.append(label);
  });
}

function pickAxisTimeLabels(points) {
  const labelCount = Math.min(5, points.length);
  if (labelCount < 2) return [];

  const step = (points.length - 1) / (labelCount - 1);
  const picked = [];
  for (let i = 0; i < labelCount; i += 1) {
    const point = points[Math.round(i * step)];
    picked.push({ time: point.time, label: formatClockTime(point.time) });
  }
  return picked;
}

function buildTideChartAriaLabel(tide) {
  if (tide.curve.length < 2) return "Tide chart unavailable.";

  const heights = tide.curve.map((point) => point.height);
  const min = formatDecimal(Math.min(...heights));
  const max = formatDecimal(Math.max(...heights));
  const highText = tide.nextHigh
    ? `high tide ${formatDecimal(tide.nextHigh.height)} ${tide.unit} at ${formatClockTime(tide.nextHigh.time)}`
    : "no upcoming high tide in this window";
  const lowText = tide.nextLow
    ? `low tide ${formatDecimal(tide.nextLow.height)} ${tide.unit} at ${formatClockTime(tide.nextLow.time)}`
    : "no upcoming low tide in this window";

  return `Tide chart for the next 24 hours at ${tide.stationName}, ranging from ${min} to ${max} ${tide.unit}, with ${highText} and ${lowText}.`;
}

function formatClockTime(date) {
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(date);
}

function formatClockDate(date) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(date);
}

function classifyWeather(conditionText, conditionCode) {
  const text = conditionText.toLowerCase();

  if (/thunder|storm/.test(text) || [1087, 1273, 1276, 1279, 1282].includes(conditionCode)) return "storm";
  if (/snow|sleet|blizzard|ice|freezing/.test(text)) return "snow";
  if (/rain|drizzle|shower/.test(text)) return "rain";
  if (/cloud|overcast|mist|fog/.test(text)) return "cloudy";
  return "clear";
}

function setLoading(isLoading) {
  form.classList.toggle("is-loading", isLoading);
  form.setAttribute("aria-busy", String(isLoading));
  searchInput.toggleAttribute("disabled", isLoading);
  form.querySelector("button").toggleAttribute("disabled", isLoading);
  currentLocationButton.toggleAttribute("disabled", isLoading);
  quickLocationsList
    .querySelectorAll(".quick-location__select, .quick-location__remove")
    .forEach((button) => button.toggleAttribute("disabled", isLoading));
}

function showError(message, heading = DEFAULT_ERROR_HEADING) {
  errorHeading.textContent = heading;
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

renderQuickLocationsList();
fetchWeatherData(currentLocation);
