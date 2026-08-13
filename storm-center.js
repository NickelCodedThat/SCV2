import { fetchActiveAlerts, STATE_NAMES } from "./services/nws-alerts.js";
import { createStormMap } from "./map/storm-map.js";
import { fetchRadarFrames } from "./services/nws-radar.js";
import { addRadarLayer, setRadarFrame } from "./map/radar-layer.js";
import { fetchActiveStorms, fetchStormGeometry } from "./services/nhc-storms.js";
import { addTropicalLayers, setTropicalData, setTropicalLayersVisibility } from "./map/tropical-layer.js";
import { classificationToSeverityTier } from "./utils/hurricane-scale.js";
import { openEventDialog } from "./event-dialog.js";
import { createElement, createSvgUse, announce } from "./utils/dom.js";
import { formatDateTime, capitalize, pluralize, compassFromDegrees } from "./utils/format.js";
import { initializeLiveEarth, resizeLiveEarthMap, setLiveEarthActive } from "./live-earth.js";

const REFRESH_INTERVAL = 5 * 60 * 1000;
const RADAR_REFRESH_INTERVAL = 5 * 60 * 1000;
const TROPICAL_REFRESH_INTERVAL = 10 * 60 * 1000;
const RADAR_FRAME_DURATION = 600;
const PAGE_SIZE = 30;
const CATEGORY_LABELS = Object.freeze({
  all: "weather",
  tornado: "tornado",
  "severe-storm": "severe storm",
  flood: "flood",
  tropical: "tropical",
  winter: "winter",
  fire: "fire weather",
  heat: "heat",
  other: "other",
});

const elements = {
  app: document.querySelector(".weather-app"),
  metaDescription: document.querySelector("#metaDescription"),
  brand: document.querySelector(".brand"),
  weatherButton: document.querySelector("#weatherViewButton"),
  stormButton: document.querySelector("#stormViewButton"),
  liveEarthButton: document.querySelector("#liveEarthViewButton"),
  weatherDashboard: document.querySelector("#main-content"),
  stormCenter: document.querySelector("#storm-center"),
  liveEarth: document.querySelector("#live-earth"),
  weatherAttribution: document.querySelector("#weatherAttribution"),
  stormAttribution: document.querySelector("#stormAttribution"),
  liveEarthAttribution: document.querySelector("#liveEarthAttribution"),
  activeCount: document.querySelector("#activeAlertCount"),
  lastUpdated: document.querySelector("#stormLastUpdated"),
  refreshButton: document.querySelector("#refreshStormCenter"),
  retryButton: document.querySelector("#retryStormCenter"),
  error: document.querySelector("#stormError"),
  errorText: document.querySelector("#stormErrorText"),
  categoryFilters: document.querySelector("#categoryFilters"),
  categoryButtons: document.querySelectorAll("#categoryFilters .filter-chip"),
  severityFilter: document.querySelector("#severityFilter"),
  stateFilter: document.querySelector("#stateFilter"),
  alertFeed: document.querySelector("#alertFeed"),
  resultCount: document.querySelector("#alertResultCount"),
  emptyState: document.querySelector("#stormEmptyState"),
  emptyHeading: document.querySelector("#stormEmptyHeading"),
  emptyText: document.querySelector("#stormEmptyText"),
  clearFilters: document.querySelector("#clearStormFilters"),
  loadMore: document.querySelector("#loadMoreAlerts"),
  mapContainer: document.querySelector("#stormMap"),
  mapState: document.querySelector("#stormMapState"),
  mappedCount: document.querySelector("#mappedAlertCount"),

  subviewTabs: document.querySelector("#stormSubviewTabs"),
  subviewButtons: document.querySelectorAll("#stormSubviewTabs .filter-chip"),
  alertFiltersSection: document.querySelector("#alertFiltersSection"),
  mapEyebrow: document.querySelector("#stormMapEyebrow"),
  severityLegend: document.querySelector("#severityLegend"),
  liveBadgeLabel: document.querySelector("#stormLiveBadgeLabel"),
  updatedLabel: document.querySelector("#stormUpdatedLabel"),

  alertsPanel: document.querySelector("#alertsPanel"),

  radarPanel: document.querySelector("#radarPanel"),
  radarStatus: document.querySelector("#radarStatus"),
  radarFrameCount: document.querySelector("#radarFrameCount"),
  radarPrev: document.querySelector("#radarPrevFrame"),
  radarPlayPause: document.querySelector("#radarPlayPause"),
  radarPlayPauseIcon: document.querySelector("#radarPlayPauseIcon"),
  radarNext: document.querySelector("#radarNextFrame"),
  radarTimeline: document.querySelector("#radarTimeline"),

  tropicalPanel: document.querySelector("#tropicalPanel"),
  tropicalFeed: document.querySelector("#tropicalFeed"),
  tropicalResultCount: document.querySelector("#tropicalResultCount"),
  tropicalEmptyState: document.querySelector("#tropicalEmptyState"),
};

const state = {
  view: "weather",
  initialized: false,
  loading: false,
  alerts: [],
  filteredAlerts: [],
  category: "all",
  severity: "all",
  stateCode: "all",
  visibleCount: PAGE_SIZE,
  request: null,
  map: null,
  mapFailed: false,
  refreshTimer: null,
  lastUpdated: null,
  selectedAlertId: "",

  subview: "alerts",
  subviewReady: { alerts: false, radar: false, tropical: false },

  radar: {
    loading: false,
    request: null,
    frames: [],
    frameIndex: -1,
    playing: false,
    playTimer: null,
    refreshTimer: null,
    lastUpdated: null,
  },

  tropical: {
    loading: false,
    request: null,
    storms: [],
    geometry: new Map(),
    refreshTimer: null,
    lastUpdated: null,
    selectedStormId: "",
    hasFitBounds: false,
  },
};

elements.weatherButton.addEventListener("click", () => setView("weather", true));
elements.stormButton.addEventListener("click", () => setView("storm", true));
elements.liveEarthButton.addEventListener("click", () => setView("live-earth", true));
elements.brand.addEventListener("click", (event) => {
  if (state.view !== "weather") {
    event.preventDefault();
    setView("weather", true);
  }
});

elements.categoryFilters.addEventListener("click", (event) => {
  const button = event.target.closest(".filter-chip");
  if (!button) return;

  state.category = button.dataset.category;
  elements.categoryButtons.forEach((candidate) => {
    const active = candidate === button;
    candidate.classList.toggle("is-active", active);
    candidate.setAttribute("aria-pressed", String(active));
  });
  applyFilters();
});

elements.severityFilter.addEventListener("change", () => {
  state.severity = elements.severityFilter.value;
  applyFilters();
});

elements.stateFilter.addEventListener("change", () => {
  state.stateCode = elements.stateFilter.value;
  applyFilters();
});

elements.refreshButton.addEventListener("click", () => refreshActiveSubview());
elements.retryButton.addEventListener("click", () => refreshActiveSubview());
elements.clearFilters.addEventListener("click", clearFilters);
elements.loadMore.addEventListener("click", () => {
  state.visibleCount += PAGE_SIZE;
  renderAlertFeed();
});

elements.subviewTabs.addEventListener("click", (event) => {
  const button = event.target.closest(".filter-chip");
  if (!button) return;
  setSubview(button.dataset.subview);
});

elements.radarPrev.addEventListener("click", () => stepRadarFrame(-1));
elements.radarNext.addEventListener("click", () => stepRadarFrame(1));
elements.radarPlayPause.addEventListener("click", () => {
  if (state.radar.playing) pauseRadar();
  else playRadar();
});
elements.radarTimeline.addEventListener("input", () => {
  pauseRadar();
  showRadarFrame(Number(elements.radarTimeline.value));
});

window.addEventListener("popstate", () => {
  setView(viewFromHash(window.location.hash), false);
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible" || state.view !== "storm") {
    pauseRadar();
    return;
  }

  if (state.subview === "alerts" && state.lastUpdated && Date.now() - state.lastUpdated.getTime() >= REFRESH_INTERVAL) {
    refreshAlerts({ silent: true });
  }
  if (state.subview === "radar" && state.radar.lastUpdated && Date.now() - state.radar.lastUpdated.getTime() >= RADAR_REFRESH_INTERVAL) {
    refreshRadar({ silent: true });
  }
  if (state.subview === "tropical" && state.tropical.lastUpdated && Date.now() - state.tropical.lastUpdated.getTime() >= TROPICAL_REFRESH_INTERVAL) {
    refreshTropical({ silent: true });
  }
});

window.addEventListener("beforeunload", () => {
  state.request?.abort();
  state.radar.request?.abort();
  state.tropical.request?.abort();
  if (state.refreshTimer) window.clearInterval(state.refreshTimer);
  if (state.radar.refreshTimer) window.clearInterval(state.radar.refreshTimer);
  if (state.tropical.refreshTimer) window.clearInterval(state.tropical.refreshTimer);
  if (state.radar.playTimer) window.clearInterval(state.radar.playTimer);
  state.map?.destroy();
});

const VIEW_HASHES = Object.freeze({ storm: "#storm-center", "live-earth": "#live-earth" });

const VIEW_META = Object.freeze({
  weather: {
    title: "Storm Chaser — Weather Dashboard",
    description: "Real-time local weather, hourly and 3-day forecasts, sunrise/sunset, and moon phase from Open-Meteo.",
  },
  storm: {
    title: "Storm Center — Storm Chaser",
    description: "Live U.S. severe-weather alerts, interactive alert mapping, radar, and tropical cyclone tracking from NOAA/NWS/NHC.",
  },
  "live-earth": {
    title: "Live Earth — Storm Chaser",
    description: "A global map and feed of significant earthquakes, wildfires, volcanoes, floods, and tropical cyclones from official sources.",
  },
});

function viewFromHash(hash) {
  const match = Object.entries(VIEW_HASHES).find(([, viewHash]) => viewHash === hash);
  return match ? match[0] : "weather";
}

function setView(view, updateHistory) {
  if (!["weather", "storm", "live-earth"].includes(view)) return;

  state.view = view;
  elements.app.dataset.view = view;
  elements.weatherDashboard.hidden = view !== "weather";
  elements.stormCenter.hidden = view !== "storm";
  elements.liveEarth.hidden = view !== "live-earth";
  elements.weatherAttribution.hidden = view !== "weather";
  elements.stormAttribution.hidden = view !== "storm";
  elements.liveEarthAttribution.hidden = view !== "live-earth";
  elements.weatherButton.classList.toggle("is-active", view === "weather");
  elements.stormButton.classList.toggle("is-active", view === "storm");
  elements.liveEarthButton.classList.toggle("is-active", view === "live-earth");
  elements.weatherButton.setAttribute("aria-pressed", String(view === "weather"));
  elements.stormButton.setAttribute("aria-pressed", String(view === "storm"));
  elements.liveEarthButton.setAttribute("aria-pressed", String(view === "live-earth"));
  document.title = VIEW_META[view].title;
  if (elements.metaDescription) elements.metaDescription.content = VIEW_META[view].description;

  if (updateHistory) {
    const url = `${window.location.pathname}${window.location.search}${VIEW_HASHES[view] || ""}`;
    window.history.pushState({ view }, "", url);
  }

  if (view === "storm") {
    initializeStormCenter();
    window.setTimeout(() => state.map?.resize(), 0);
  }

  setLiveEarthActive(view === "live-earth");
  if (view === "live-earth") {
    initializeLiveEarth();
    window.setTimeout(() => resizeLiveEarthMap(), 0);
  }
}

function initializeStormCenter() {
  if (state.initialized) return;
  state.initialized = true;
  startMap();
  refreshAlerts();
  state.subviewReady.alerts = true;
  state.refreshTimer = window.setInterval(() => {
    if (state.view === "storm" && state.subview === "alerts" && document.visibilityState === "visible") {
      refreshAlerts({ silent: true });
    }
  }, REFRESH_INTERVAL);
}

async function startMap() {
  setMapState("loading", "Preparing the storm map", "Loading official alert geometry.");

  try {
    state.map = await createStormMap(elements.mapContainer, {
      onAlertSelect: (alertId) => {
        const alert = state.filteredAlerts.find((candidate) => candidate.id === alertId);
        if (alert) openAlertDetails(alert);
      },
    });
    state.mapFailed = false;
    addTropicalLayers(state.map);
    state.map.setAlertLayerVisibility(state.subview !== "tropical");
    setTropicalLayersVisibility(state.map, state.subview === "tropical");
    // The map itself is ready regardless of which sub-view is active —
    // clear the loading overlay unconditionally; updateMap() below only
    // touches Alerts-specific messaging when Alerts is the active sub-view.
    elements.mapState.hidden = true;
    updateMap();
    updateMapPanelStatus();
  } catch (error) {
    state.mapFailed = true;
    setMapState(
      "error",
      "The interactive map is unavailable",
      "The official alert feed is still available alongside the map.",
    );
  }
}

function setSubview(subview) {
  if (!["alerts", "radar", "tropical"].includes(subview) || subview === state.subview) return;
  pauseRadar();
  state.subview = subview;

  elements.subviewButtons.forEach((button) => {
    const active = button.dataset.subview === subview;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });

  elements.alertFiltersSection.hidden = subview !== "alerts";
  elements.alertsPanel.hidden = subview !== "alerts";
  elements.radarPanel.hidden = subview !== "radar";
  elements.tropicalPanel.hidden = subview !== "tropical";
  elements.severityLegend.hidden = subview === "radar";

  elements.mapEyebrow.textContent =
    subview === "alerts" ? "Official alert geometry"
    : subview === "radar" ? "NOAA / NWS nowCOAST radar mosaic"
    : "NHC / CPHC storm tracking";

  hideError();
  state.map?.setAlertLayerVisibility(subview !== "tropical");
  state.map?.setLayerVisibility("storm-radar", subview === "radar");
  if (state.map) setTropicalLayersVisibility(state.map, subview === "tropical");
  updateLiveStatus();
  updateMapPanelStatus();
  initializeSubview(subview);
}

function updateMapPanelStatus() {
  if (state.subview === "radar") {
    elements.mappedCount.textContent = state.radar.frames.length > 0
      ? `${state.radar.frames.length} ${pluralize("frame", state.radar.frames.length)} loaded`
      : "Loading frames…";
    return;
  }

  if (state.subview === "tropical") {
    const mapped = state.tropical.storms.filter(
      (storm) => state.tropical.geometry.get(storm.id)?.forecastTrack?.features?.length,
    ).length;
    elements.mappedCount.textContent = `${mapped} of ${state.tropical.storms.length} mapped`;
    return;
  }

  updateMap();
}

function initializeSubview(subview) {
  if (state.subviewReady[subview]) return;
  state.subviewReady[subview] = true;

  if (subview === "radar") {
    refreshRadar();
    state.radar.refreshTimer = window.setInterval(() => {
      if (state.view === "storm" && state.subview === "radar" && document.visibilityState === "visible") {
        refreshRadar({ silent: true });
      }
    }, RADAR_REFRESH_INTERVAL);
  }

  if (subview === "tropical") {
    refreshTropical();
    state.tropical.refreshTimer = window.setInterval(() => {
      if (state.view === "storm" && state.subview === "tropical" && document.visibilityState === "visible") {
        refreshTropical({ silent: true });
      }
    }, TROPICAL_REFRESH_INTERVAL);
  }
}

function refreshActiveSubview() {
  if (state.subview === "alerts") refreshAlerts();
  else if (state.subview === "radar") refreshRadar();
  else refreshTropical();
}

async function refreshAlerts({ silent = false } = {}) {
  if (state.loading) return;
  state.request?.abort();

  const controller = new AbortController();
  state.request = controller;
  state.loading = true;
  hideError();
  setRefreshState(true);
  if (!silent && state.alerts.length === 0) setFeedLoading(true);

  try {
    const result = await fetchActiveAlerts({ signal: controller.signal });
    state.alerts = result.alerts;
    state.lastUpdated = result.updatedAt;
    state.visibleCount = PAGE_SIZE;
    populateStateFilter();
    updateLiveStatus();
    applyFilters();
    announce(`Storm Center updated with ${state.alerts.length} active alerts.`);
  } catch (error) {
    if (error.name === "AbortError") return;

    const message = navigator.onLine
      ? error.message || "The National Weather Service is temporarily unavailable."
      : "You appear to be offline. Reconnect and try again.";
    showError(message);

    if (state.alerts.length === 0) {
      state.filteredAlerts = [];
      renderAlertFeed();
      updateMap();
    }
  } finally {
    if (state.request === controller) {
      state.request = null;
      state.loading = false;
      setRefreshState(false);
      setFeedLoading(false);
    }
  }
}

async function refreshRadar({ silent = false } = {}) {
  if (state.radar.loading) return;
  state.radar.request?.abort();

  const controller = new AbortController();
  state.radar.request = controller;
  state.radar.loading = true;
  if (!silent) hideError();
  setRefreshState(true);
  if (!silent && state.radar.frames.length === 0) {
    elements.radarStatus.textContent = "Loading radar frames…";
  }

  try {
    const result = await fetchRadarFrames({ signal: controller.signal });
    const wasPlaying = state.radar.playing;
    pauseRadar();

    state.radar.frames = result.frames;
    state.radar.lastUpdated = result.updatedAt;

    const hasFrames = result.frames.length > 0;
    elements.radarTimeline.max = String(Math.max(0, result.frames.length - 1));
    elements.radarFrameCount.textContent = `${result.frames.length} ${pluralize("frame", result.frames.length)}`;
    [elements.radarPrev, elements.radarPlayPause, elements.radarNext, elements.radarTimeline].forEach((control) => {
      control.disabled = !hasFrames;
    });

    if (hasFrames) {
      showRadarFrame(result.frames.length - 1);
      if (wasPlaying) playRadar();
    } else {
      elements.radarStatus.textContent = "No radar frames are currently available.";
    }

    updateLiveStatus();
    updateMapPanelStatus();
    announce(`Radar updated with ${result.frames.length} frames.`);
  } catch (error) {
    if (error.name === "AbortError") return;

    const message = navigator.onLine
      ? error.message || "NOAA radar is temporarily unavailable."
      : "You appear to be offline. Reconnect and try again.";
    showError(message);
    if (state.radar.frames.length === 0) {
      elements.radarStatus.textContent = "Radar is currently unavailable.";
    }
  } finally {
    if (state.radar.request === controller) {
      state.radar.request = null;
      state.radar.loading = false;
      setRefreshState(false);
    }
  }
}

function showRadarFrame(index) {
  const frame = state.radar.frames[index];
  if (!frame) return;

  state.radar.frameIndex = index;
  elements.radarTimeline.value = String(index);
  elements.radarStatus.textContent = `Latest radar · ${formatDateTime(frame.time, { compact: true })}`;

  if (state.map) {
    addRadarLayer(state.map, frame.iso);
    setRadarFrame(state.map, frame.iso);
  }
}

function stepRadarFrame(delta) {
  if (state.radar.frames.length === 0) return;
  pauseRadar();
  const next = Math.min(state.radar.frames.length - 1, Math.max(0, state.radar.frameIndex + delta));
  showRadarFrame(next);
}

function playRadar() {
  if (state.radar.frames.length <= 1 || state.radar.playing) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  state.radar.playing = true;
  elements.radarPlayPause.setAttribute("aria-pressed", "true");
  elements.radarPlayPause.setAttribute("aria-label", "Pause radar animation");
  elements.radarPlayPauseIcon.setAttribute("href", "#icon-pause");

  state.radar.playTimer = window.setInterval(() => {
    const next = state.radar.frameIndex + 1 >= state.radar.frames.length ? 0 : state.radar.frameIndex + 1;
    showRadarFrame(next);
  }, RADAR_FRAME_DURATION);
}

function pauseRadar() {
  if (state.radar.playTimer) {
    window.clearInterval(state.radar.playTimer);
    state.radar.playTimer = null;
  }
  state.radar.playing = false;
  elements.radarPlayPause.setAttribute("aria-pressed", "false");
  elements.radarPlayPause.setAttribute("aria-label", "Play radar animation");
  elements.radarPlayPauseIcon.setAttribute("href", "#icon-play");
}

async function refreshTropical({ silent = false } = {}) {
  if (state.tropical.loading) return;
  state.tropical.request?.abort();

  const controller = new AbortController();
  state.tropical.request = controller;
  state.tropical.loading = true;
  if (!silent) hideError();
  setRefreshState(true);
  if (!silent && state.tropical.storms.length === 0) setTropicalFeedLoading(true);

  try {
    const result = await fetchActiveStorms({ signal: controller.signal });
    state.tropical.storms = result.storms;
    state.tropical.lastUpdated = result.updatedAt;

    const geometryEntries = await Promise.all(
      result.storms.map(async (storm) => {
        try {
          return [storm.id, await fetchStormGeometry(storm.binNumber, { signal: controller.signal })];
        } catch {
          return [storm.id, null];
        }
      }),
    );
    state.tropical.geometry = new Map(geometryEntries);

    renderTropicalFeed();
    updateTropicalMap();
    updateLiveStatus();
    updateMapPanelStatus();
    announce(`Tropical tracking updated with ${state.tropical.storms.length} active systems.`);
  } catch (error) {
    if (error.name === "AbortError") return;

    const message = navigator.onLine
      ? error.message || "The National Hurricane Center is temporarily unavailable."
      : "You appear to be offline. Reconnect and try again.";
    showError(message);
    if (state.tropical.storms.length === 0) {
      renderTropicalFeed();
      updateTropicalMap();
    }
  } finally {
    if (state.tropical.request === controller) {
      state.tropical.request = null;
      state.tropical.loading = false;
      setRefreshState(false);
      setTropicalFeedLoading(false);
    }
  }
}

function setTropicalFeedLoading(isLoading) {
  elements.tropicalFeed.setAttribute("aria-busy", String(isLoading));
  if (!isLoading || state.tropical.storms.length > 0) return;

  elements.tropicalFeed.hidden = false;
  elements.tropicalEmptyState.hidden = true;
  elements.tropicalFeed.replaceChildren(
    createElement("div", "alert-card-skeleton"),
    createElement("div", "alert-card-skeleton"),
  );
}

function renderTropicalFeed() {
  elements.tropicalFeed.replaceChildren();
  elements.tropicalFeed.setAttribute("aria-busy", "false");
  elements.tropicalResultCount.textContent = `${state.tropical.storms.length} ${pluralize("active system", state.tropical.storms.length)}`;

  if (state.tropical.storms.length === 0) {
    elements.tropicalFeed.hidden = true;
    elements.tropicalEmptyState.hidden = false;
    return;
  }

  elements.tropicalFeed.hidden = false;
  elements.tropicalEmptyState.hidden = true;

  const fragment = document.createDocumentFragment();
  state.tropical.storms.forEach((storm) => fragment.append(createStormCard(storm)));
  elements.tropicalFeed.append(fragment);
}

function createStormCard(storm) {
  const level = classificationToSeverityTier(storm.classificationInfo);
  const article = createElement("article", `alert-card alert-card--${level}`);
  article.dataset.stormId = storm.id;
  if (storm.id === state.tropical.selectedStormId) article.classList.add("is-selected");

  const button = createElement("button", "alert-card__button");
  button.type = "button";
  button.setAttribute("aria-label", `View details for ${storm.name}`);
  button.addEventListener("click", () => openStormDetails(storm));

  const topLine = createElement("div", "alert-card__topline");
  const badgeLabel = storm.classificationInfo.category
    ? `Category ${storm.classificationInfo.category}`
    : storm.classificationInfo.label;
  const badge = createElement("span", "severity-badge", badgeLabel);
  const time = createElement(
    "span",
    "alert-card__time",
    storm.advisory?.issuedAtLabel
      ? `Advisory ${storm.advisory.number || "—"} · ${storm.advisory.issuedAtLabel}`
      : "Advisory time unavailable",
  );
  topLine.append(badge, time);

  const title = createElement("h3", "", storm.name);

  const headlineParts = [];
  if (storm.maxWindMph != null) headlineParts.push(`${storm.maxWindMph} mph sustained`);
  if (storm.pressureMb != null) headlineParts.push(`${storm.pressureMb} mb`);
  if (storm.movement.speedMph != null) {
    headlineParts.push(`moving ${compassFromDegrees(storm.movement.directionDeg)} at ${Math.round(storm.movement.speedMph)} mph`);
  }
  const headline = createElement("p", "alert-card__headline", headlineParts.join(" · ") || "Details unavailable");
  const area = createElement("p", "alert-card__area", storm.positionLabel || "Position unavailable");

  const footer = createElement("div", "alert-card__footer");
  const authority = createElement("span", "", storm.authority);
  const hasGeometry = Boolean(state.tropical.geometry.get(storm.id)?.forecastTrack?.features?.length);
  const geometry = createElement("span", "", hasGeometry ? "Mapped track" : "Advisory data only");
  geometry.prepend(createSvgUse(hasGeometry ? "#icon-map" : "#icon-list"));
  footer.append(authority, geometry);

  button.append(topLine, title, headline, area, footer);
  article.append(button);
  return article;
}

function updateTropicalMap() {
  if (!state.map) return;

  const merge = (key) => mergeFeatureCollections(
    state.tropical.storms.map((storm) => state.tropical.geometry.get(storm.id)?.[key]).filter(Boolean),
  );

  setTropicalData(state.map, {
    cone: merge("forecastCone"),
    forecastTrack: merge("forecastTrack"),
    pastTrack: merge("pastTrack"),
    watchWarnings: merge("watchWarnings"),
    forecastPoints: merge("forecastPoints"),
  });

  if (!state.tropical.hasFitBounds) {
    const geometry = state.tropical.storms
      .map((storm) => {
        const stormGeometry = state.tropical.geometry.get(storm.id);
        return stormGeometry?.forecastCone?.features?.[0]?.geometry || stormGeometry?.pastTrack?.features?.[0]?.geometry;
      })
      .find(Boolean);

    if (geometry) {
      state.map.fitFeatureBounds(geometry);
      state.tropical.hasFitBounds = true;
    }
  }
}

function mergeFeatureCollections(collections) {
  return {
    type: "FeatureCollection",
    features: collections.flatMap((collection) => collection.features || []),
  };
}

function applyFilters() {
  state.visibleCount = PAGE_SIZE;
  state.filteredAlerts = state.alerts.filter((alert) => {
    const matchesCategory = state.category === "all" || alert.category === state.category;
    const matchesSeverity = state.severity === "all" || alert.level === state.severity;
    const matchesState = state.stateCode === "all" || alert.states.includes(state.stateCode);
    return matchesCategory && matchesSeverity && matchesState;
  });

  renderAlertFeed();
  updateMap();
}

function renderAlertFeed() {
  elements.alertFeed.replaceChildren();
  elements.alertFeed.setAttribute("aria-busy", "false");
  elements.resultCount.textContent = `${state.filteredAlerts.length} ${pluralize("result", state.filteredAlerts.length)}`;

  if (state.filteredAlerts.length === 0) {
    elements.alertFeed.hidden = true;
    elements.loadMore.hidden = true;
    renderEmptyState();
    return;
  }

  elements.alertFeed.hidden = false;
  elements.emptyState.hidden = true;

  const fragment = document.createDocumentFragment();
  state.filteredAlerts.slice(0, state.visibleCount).forEach((alert) => {
    fragment.append(createAlertCard(alert));
  });
  elements.alertFeed.append(fragment);

  const remaining = state.filteredAlerts.length - state.visibleCount;
  elements.loadMore.hidden = remaining <= 0;
  if (remaining > 0) {
    elements.loadMore.textContent = `Load more alerts (${remaining} remaining)`;
  }
}

function createAlertCard(alert) {
  const article = createElement("article", `alert-card alert-card--${alert.level}`);
  article.dataset.alertId = alert.id;
  if (alert.id === state.selectedAlertId) article.classList.add("is-selected");

  const button = createElement("button", "alert-card__button");
  button.type = "button";
  button.setAttribute("aria-label", `View ${alert.event} details for ${alert.area}`);
  button.addEventListener("click", () => openAlertDetails(alert));

  const topLine = createElement("div", "alert-card__topline");
  const badge = createElement("span", "severity-badge", capitalize(alert.level));
  const time = createElement("span", "alert-card__time", `Expires ${formatDateTime(alert.expires, { compact: true })}`);
  topLine.append(badge, time);

  const title = createElement("h3", "", alert.event);
  const headline = createElement("p", "alert-card__headline", alert.headline);
  const area = createElement("p", "alert-card__area", alert.area);

  const footer = createElement("div", "alert-card__footer");
  const authority = createElement("span", "", alert.authority);
  const geometry = createElement("span", "", alert.hasGeometry ? "Mapped area" : "Text area only");
  geometry.prepend(createSvgUse(alert.hasGeometry ? "#icon-map" : "#icon-list"));
  footer.append(authority, geometry);

  button.append(topLine, title, headline, area, footer);
  article.append(button);
  return article;
}

function renderEmptyState() {
  const filtered = state.category !== "all" || state.severity !== "all" || state.stateCode !== "all";
  const category = CATEGORY_LABELS[state.category] || "weather";

  if (state.alerts.length === 0 && !state.loading) {
    elements.emptyHeading.textContent = "No active NWS alerts reported";
    elements.emptyText.textContent = "There are currently no active events in the official national feed.";
    elements.clearFilters.hidden = true;
  } else {
    elements.emptyHeading.textContent = `No active ${category} alerts`;
    elements.emptyText.textContent = "Try changing a filter to view other National Weather Service events.";
    elements.clearFilters.hidden = !filtered;
  }

  elements.emptyState.hidden = false;
}

function updateLiveStatus() {
  if (state.subview === "radar") {
    const latest = state.radar.frames[state.radar.frames.length - 1]?.time || null;
    elements.liveBadgeLabel.textContent = "Latest";
    elements.updatedLabel.textContent = "Refreshed";
    elements.activeCount.textContent = latest
      ? `Radar · ${formatDateTime(latest, { timeOnly: true })}`
      : "Radar unavailable";
    elements.lastUpdated.textContent = formatDateTime(state.radar.lastUpdated, { timeOnly: true });
    elements.lastUpdated.dateTime = state.radar.lastUpdated?.toISOString() || "";
    return;
  }

  if (state.subview === "tropical") {
    const count = state.tropical.storms.length;
    elements.liveBadgeLabel.textContent = "Advisory";
    elements.updatedLabel.textContent = "Updated";
    elements.activeCount.textContent = `${count} Active ${pluralize("System", count)}`;
    elements.lastUpdated.textContent = formatDateTime(state.tropical.lastUpdated, { timeOnly: true });
    elements.lastUpdated.dateTime = state.tropical.lastUpdated?.toISOString() || "";
    return;
  }

  elements.liveBadgeLabel.textContent = "Live";
  elements.updatedLabel.textContent = "Updated";
  elements.activeCount.textContent = `${state.alerts.length} Active ${pluralize("Alert", state.alerts.length)}`;
  elements.lastUpdated.textContent = formatDateTime(state.lastUpdated, { timeOnly: true });
  elements.lastUpdated.dateTime = state.lastUpdated?.toISOString() || "";
}

function updateMap() {
  const mappedAlerts = state.filteredAlerts.filter((alert) => alert.hasGeometry);
  // Alert data on the map itself must always stay in sync, regardless of
  // which sub-view is currently visible, so switching back to Alerts (or
  // viewing alerts alongside Radar) never shows stale geometry.
  if (state.map) state.map.setAlerts(mappedAlerts);

  // The count label and the "no mapped alerts" empty state are Alerts-only
  // messaging — never touch them (or the shared map overlay) while the user
  // is looking at Radar or Tropical.
  if (state.subview !== "alerts") return;

  elements.mappedCount.textContent = `${mappedAlerts.length} of ${state.filteredAlerts.length} mapped`;

  if (!state.map) {
    if (!state.mapFailed) setMapState("loading", "Preparing the storm map", "Loading official alert geometry.");
    return;
  }

  if (mappedAlerts.length > 0) {
    elements.mapState.hidden = true;
  } else {
    setMapState(
      "empty",
      "No mapped areas for this filter",
      "Some NWS alerts are issued for text-based forecast zones without polygon geometry.",
    );
  }
}

function openAlertDetails(alert) {
  state.selectedAlertId = alert.id;
  document.querySelectorAll(".alert-card").forEach((card) => {
    card.classList.toggle("is-selected", card.dataset.alertId === alert.id);
  });

  if (alert.hasGeometry) state.map?.selectAlert(alert);

  openEventDialog({
    level: alert.level,
    eyebrow: "Official NWS alert",
    severityLabel: capitalize(alert.level),
    title: alert.event,
    headline: alert.headline,
    areaHeading: "Affected area",
    area: alert.area,
    descriptionHeading: "Description",
    description: alert.description,
    instructionHeading: "Recommended action",
    instruction: alert.instruction,
    authority: alert.authority,
    sourceUrl: alert.sourceUrl,
    fields: [
      ["Severity", alert.severity],
      ["Urgency", alert.urgency],
      ["Certainty", alert.certainty],
      ["Expires", formatDateTime(alert.expires)],
      ["Issued", formatDateTime(alert.sent)],
      ["Status", alert.status],
      ["Response", alert.response],
      ["States", alert.states.join(", ") || "Multi-area"],
    ],
  }, { onClose: clearSelection });
}

function openStormDetails(storm) {
  state.tropical.selectedStormId = storm.id;
  document.querySelectorAll(".alert-card").forEach((card) => {
    card.classList.toggle("is-selected", card.dataset.stormId === storm.id);
  });

  const geometry = state.tropical.geometry.get(storm.id);
  const fitGeometry = geometry?.forecastCone?.features?.[0]?.geometry || geometry?.pastTrack?.features?.[0]?.geometry;
  if (fitGeometry) state.map?.fitFeatureBounds(fitGeometry);

  const movement = storm.movement.speedMph != null
    ? `moving ${compassFromDegrees(storm.movement.directionDeg)} at ${Math.round(storm.movement.speedMph)} mph`
    : "movement data unavailable";

  openEventDialog({
    level: classificationToSeverityTier(storm.classificationInfo),
    eyebrow: `Official ${storm.authority} advisory`,
    severityLabel: storm.classificationInfo.category
      ? `Category ${storm.classificationInfo.category}`
      : storm.classificationInfo.label,
    title: storm.name,
    headline: storm.maxWindMph != null
      ? `Maximum sustained winds ${storm.maxWindMph} mph (${storm.maxWindKt} kt)`
      : "Wind data unavailable",
    areaHeading: "Current position & movement",
    area: `${storm.positionLabel || "Position unavailable"} — ${movement}`,
    descriptionHeading: "System summary",
    description: buildStormSummary(storm),
    instructionHeading: "Coastal watches & warnings",
    instruction: describeWatchWarnings(geometry?.watchWarnings)
      || "No active coastal watches or warnings from this advisory.",
    authority: storm.authority,
    sourceUrl: storm.links.publicAdvisory || storm.sourceUrl,
    fields: [
      ["Classification", storm.classificationInfo.displayName],
      ["Max sustained wind", storm.maxWindMph != null ? `${storm.maxWindMph} mph (${storm.maxWindKt} kt)` : "Unavailable"],
      ["Pressure", storm.pressureMb != null ? `${storm.pressureMb} mb` : "Unavailable"],
      ["Movement", movement],
      ["Latest advisory", storm.advisory?.number ? `#${storm.advisory.number}` : "Unavailable"],
      ["Advisory issued", storm.advisory?.issuedAtLabel],
      ["Basin", storm.basin],
      ["Last updated", formatDateTime(storm.lastUpdate)],
    ],
  }, { onClose: clearSelection });
}

function buildStormSummary(storm) {
  const details = [];
  if (storm.maxWindMph != null) details.push(`maximum sustained winds of ${storm.maxWindMph} mph`);
  if (storm.pressureMb != null) details.push(`a minimum central pressure of ${storm.pressureMb} mb`);
  const detailText = details.length > 0 ? ` with ${details.join(" and ")}` : "";
  return `${storm.name} is an active system in the ${storm.basin} tracked by ${storm.authority}${detailText}.`;
}

function describeWatchWarnings(collection) {
  const features = collection?.features || [];
  if (features.length === 0) return "";

  const labels = {
    HWA: "Hurricane Watch",
    HWR: "Hurricane Warning",
    TWA: "Tropical Storm Watch",
    TWR: "Tropical Storm Warning",
  };
  const unique = [...new Set(
    features.map((feature) => labels[feature.properties?.tcww] || feature.properties?.tcww).filter(Boolean),
  )];
  return unique.join(", ");
}

function clearSelection() {
  state.selectedAlertId = "";
  state.tropical.selectedStormId = "";
  document.querySelectorAll(".alert-card.is-selected").forEach((card) => card.classList.remove("is-selected"));
  state.map?.clearSelection();
}

function clearFilters() {
  state.category = "all";
  state.severity = "all";
  state.stateCode = "all";
  elements.severityFilter.value = "all";
  elements.stateFilter.value = "all";
  elements.categoryButtons.forEach((button) => {
    const active = button.dataset.category === "all";
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  applyFilters();
  state.map?.resetView();
}

function populateStateFilter() {
  const selectedValue = elements.stateFilter.value;
  const codes = [...new Set(state.alerts.flatMap((alert) => alert.states))].sort((left, right) => {
    return STATE_NAMES[left].localeCompare(STATE_NAMES[right]);
  });

  elements.stateFilter.replaceChildren(new Option("All states", "all"));
  codes.forEach((code) => elements.stateFilter.add(new Option(STATE_NAMES[code], code)));
  elements.stateFilter.value = codes.includes(selectedValue) ? selectedValue : "all";
  state.stateCode = elements.stateFilter.value;
}

function setFeedLoading(isLoading) {
  elements.alertFeed.setAttribute("aria-busy", String(isLoading));
  if (!isLoading || state.alerts.length > 0) return;

  elements.alertFeed.hidden = false;
  elements.emptyState.hidden = true;
  elements.loadMore.hidden = true;
  elements.alertFeed.replaceChildren(
    createElement("div", "alert-card-skeleton"),
    createElement("div", "alert-card-skeleton"),
    createElement("div", "alert-card-skeleton"),
  );
}

function setRefreshState(isLoading) {
  elements.refreshButton.classList.toggle("is-loading", isLoading);
  elements.refreshButton.toggleAttribute("disabled", isLoading);
  elements.refreshButton.setAttribute("aria-label", isLoading ? "Refreshing active alerts" : "Refresh active alerts");
}

function setMapState(type, heading, message) {
  const loader = elements.mapState.querySelector(".map-loader");
  loader.hidden = type !== "loading";
  elements.mapState.querySelector("strong").textContent = heading;
  elements.mapState.querySelector("p").textContent = message;
  elements.mapState.hidden = false;
}

function showError(message) {
  elements.errorText.textContent = message;
  elements.error.hidden = false;
}

function hideError() {
  elements.error.hidden = true;
}

setView(viewFromHash(window.location.hash), false);
