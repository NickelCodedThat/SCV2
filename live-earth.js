import { fetchLiveEarthEvents } from "./services/live-earth.js";
import { createLiveEarthMap } from "./map/live-earth-map.js";
import { openEventDialog } from "./event-dialog.js";
import { createElement, announce } from "./utils/dom.js";
import { formatDateTime, capitalize, pluralize, relativeTimeLabel } from "./utils/format.js";
import { DISPLAY_PRIORITY_LABELS } from "./models/global-event.js";
import { matchesSearch, compareEvents } from "./utils/event-query.js";
import { readParam, replaceLiveEarthUrl } from "./utils/url-state.js";
import { getWatchlist, isSaved, saveEvent, removeEvent, findSavedEntry } from "./services/watchlist.js";

const REFRESH_INTERVAL = 10 * 60 * 1000;
const PAGE_SIZE = 24;
const SEARCH_DEBOUNCE = 200;

const CATEGORY_LABELS = Object.freeze({
  earthquake: "Earthquake",
  wildfire: "Wildfire",
  volcano: "Volcano",
  flood: "Flood",
  cyclone: "Cyclone",
});

const REAL_CATEGORIES = Object.freeze(["earthquake", "wildfire", "volcano", "flood", "cyclone"]);

const elements = {
  activeCount: document.querySelector("#liveEarthActiveCount"),
  lastUpdated: document.querySelector("#liveEarthLastUpdated"),
  liveBadgeLabel: document.querySelector("#liveEarthBadgeLabel"),
  updatedLabel: document.querySelector("#liveEarthUpdatedLabel"),
  refreshButton: document.querySelector("#refreshLiveEarth"),
  retryButton: document.querySelector("#retryLiveEarth"),
  error: document.querySelector("#liveEarthError"),
  errorText: document.querySelector("#liveEarthErrorText"),
  categoryFilters: document.querySelector("#liveEarthCategoryFilters"),
  categoryButtons: document.querySelectorAll("#liveEarthCategoryFilters .filter-chip"),
  priorityFilter: document.querySelector("#liveEarthPriorityFilter"),
  recencyFilter: document.querySelector("#liveEarthRecencyFilter"),
  sortSelect: document.querySelector("#liveEarthSortSelect"),
  searchInput: document.querySelector("#liveEarthSearchInput"),
  feed: document.querySelector("#liveEarthFeed"),
  resultCount: document.querySelector("#liveEarthResultCount"),
  emptyState: document.querySelector("#liveEarthEmptyState"),
  emptyHeading: document.querySelector("#liveEarthEmptyHeading"),
  emptyText: document.querySelector("#liveEarthEmptyText"),
  clearFilters: document.querySelector("#clearLiveEarthFilters"),
  loadMore: document.querySelector("#loadMoreLiveEarthEvents"),
  mapContainer: document.querySelector("#liveEarthMap"),
  mapState: document.querySelector("#liveEarthMapState"),
  mappedCount: document.querySelector("#liveEarthMappedCount"),
};

const state = {
  active: false,
  initialized: false,
  loading: false,
  request: null,
  refreshTimer: null,
  lastUpdated: null,
  map: null,
  mapFailed: false,
  events: [],
  filteredEvents: [],
  providerCache: {},
  category: "all",
  priority: "all",
  recency: "all",
  sort: "recent",
  search: "",
  visibleCount: PAGE_SIZE,
  selectedEventId: "",
  urlRestored: false,
  hasStaleLinkNotice: false,
};

let searchDebounceTimer = null;

elements.categoryFilters.addEventListener("click", (event) => {
  const button = event.target.closest(".filter-chip");
  if (!button) return;
  setCategory(button.dataset.category);
});

elements.priorityFilter.addEventListener("change", () => {
  state.priority = elements.priorityFilter.value;
  applyFilters();
});

elements.recencyFilter.addEventListener("change", () => {
  state.recency = elements.recencyFilter.value;
  applyFilters();
});

elements.sortSelect.addEventListener("change", () => {
  state.sort = elements.sortSelect.value;
  applyFilters();
});

elements.searchInput.addEventListener("input", () => {
  window.clearTimeout(searchDebounceTimer);
  searchDebounceTimer = window.setTimeout(() => {
    state.search = elements.searchInput.value;
    applyFilters();
  }, SEARCH_DEBOUNCE);
});

elements.refreshButton.addEventListener("click", () => refreshEvents());
elements.retryButton.addEventListener("click", () => refreshEvents());
elements.clearFilters.addEventListener("click", clearLiveEarthFilters);
elements.loadMore.addEventListener("click", () => {
  state.visibleCount += PAGE_SIZE;
  renderFeed();
});

document.addEventListener("visibilitychange", () => {
  if (
    document.visibilityState === "visible" &&
    state.active &&
    state.lastUpdated &&
    Date.now() - state.lastUpdated.getTime() >= REFRESH_INTERVAL
  ) {
    refreshEvents({ silent: true });
  }
});

window.addEventListener("beforeunload", () => {
  state.request?.abort();
  if (state.refreshTimer) window.clearInterval(state.refreshTimer);
  state.map?.destroy();
});

export function setLiveEarthActive(isActive) {
  state.active = isActive;
}

export function resizeLiveEarthMap() {
  state.map?.resize();
}

export function initializeLiveEarth() {
  if (state.initialized) return;
  state.initialized = true;

  startMap();
  refreshEvents();
  state.refreshTimer = window.setInterval(() => {
    if (state.active && document.visibilityState === "visible") refreshEvents({ silent: true });
  }, REFRESH_INTERVAL);
}

async function startMap() {
  setMapState("loading", "Preparing the global map", "Loading event data from official sources.");

  try {
    state.map = await createLiveEarthMap(elements.mapContainer, {
      onEventSelect: (eventId) => {
        const event = state.filteredEvents.find((candidate) => candidate.id === eventId)
          || state.events.find((candidate) => candidate.id === eventId);
        if (event) openLiveEarthEventDetails(event);
      },
    });
    state.mapFailed = false;
    elements.mapState.hidden = true;
    updateMap();
  } catch (error) {
    state.mapFailed = true;
    setMapState("error", "The interactive map is unavailable", "The event feed is still available alongside the map.");
  }
}

async function refreshEvents({ silent = false } = {}) {
  if (state.loading) return;
  state.request?.abort();

  const controller = new AbortController();
  state.request = controller;
  state.loading = true;
  setRefreshState(true);
  if (!silent && state.events.length === 0) setFeedLoading(true);

  try {
    const result = await fetchLiveEarthEvents({ signal: controller.signal });

    Object.entries(result.providers).forEach(([key, providerResult]) => {
      if (providerResult.status === "aborted") return;
      if (providerResult.status === "ok") {
        state.providerCache[key] = {
          label: providerResult.label,
          status: "ok",
          events: providerResult.events,
          lastSuccessAt: providerResult.lastSuccessAt,
        };
      } else {
        // Keep whatever this provider last successfully returned — stale
        // data stays visible, but the status/error is updated so the
        // banner below can honestly describe what's happening.
        state.providerCache[key] = {
          ...(state.providerCache[key] || { events: [], lastSuccessAt: null }),
          label: providerResult.label,
          status: providerResult.status,
          error: providerResult.error,
        };
      }
    });

    state.events = Object.values(state.providerCache).flatMap((entry) => entry.events || []);
    state.lastUpdated = result.fetchedAt;
    state.visibleCount = PAGE_SIZE;

    const issue = describeProviderIssues(state.providerCache);
    if (issue) showError(issue); else hideError();

    applyFilters();
    updateLiveStatus();
    announce(`Live Earth updated with ${state.events.length} tracked events.`);

    if (!state.urlRestored) {
      state.urlRestored = true;
      restoreUrlState();
    }
  } catch (error) {
    if (error.name === "AbortError") return;

    const message = navigator.onLine
      ? error.message || "Live Earth is temporarily unavailable."
      : "You appear to be offline. Reconnect and try again.";
    showError(message);

    if (state.events.length === 0) {
      state.filteredEvents = [];
      renderFeed();
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

function describeProviderIssues(providerCache) {
  const issues = Object.values(providerCache)
    .filter((entry) => entry.status && entry.status !== "ok")
    .map((entry) => entry.label);
  if (issues.length === 0) return "";
  return `${issues.join(", ")} temporarily unavailable — showing the last successful data for ${issues.length === 1 ? "that source" : "those sources"} where available.`;
}

function setCategory(category) {
  state.category = category;
  elements.categoryButtons.forEach((candidate) => {
    const active = candidate.dataset.category === category;
    candidate.classList.toggle("is-active", active);
    candidate.setAttribute("aria-pressed", String(active));
  });
  // "saved" is a personal, local-only view — never written to a shareable URL.
  replaceLiveEarthUrl({ category: REAL_CATEGORIES.includes(category) ? category : null });
  applyFilters();
}

function applyFilters() {
  clearStaleLinkNotice();
  state.visibleCount = PAGE_SIZE;
  const cutoff = recencyCutoff(state.recency);
  const pool = state.category === "saved" ? getWatchlistEvents() : state.events;

  state.filteredEvents = pool
    .filter((event) => {
      const matchesCategory = state.category === "all" || state.category === "saved" || event.category === state.category;
      const matchesPriority = state.priority === "all" || event.severity.displayPriority === state.priority;
      const referenceTime = event.time.eventAt || event.time.updatedAt;
      const matchesRecency = !cutoff || (referenceTime && referenceTime.getTime() >= cutoff);
      const matchesQuery = matchesSearch(event, state.search);
      return matchesCategory && matchesPriority && matchesRecency && matchesQuery;
    })
    .sort((a, b) => compareEvents(a, b, state.sort));

  renderFeed();
  updateMap();
}

/**
 * Merges the saved watchlist with current live data: a saved event still in
 * the feed uses the fresh live copy (isArchived: false); one that has
 * dropped out is rebuilt from its compact snapshot (isArchived: true) so it
 * can still render instead of silently vanishing.
 */
function getWatchlistEvents() {
  return getWatchlist().map((entry) => {
    const live = state.events.find((event) => event.id === entry.id);
    return live ? { ...live, isArchived: false } : eventFromSnapshot(entry);
  });
}

function eventFromSnapshot(entry) {
  const snapshot = entry.snapshot || {};
  return {
    id: entry.id,
    provider: entry.provider,
    category: entry.category,
    title: snapshot.title || "Saved event",
    status: "archived",
    position: snapshot.position || null,
    region: { place: snapshot.place || "", countries: snapshot.countries || [] },
    time: {
      eventAt: snapshot.eventAt ? new Date(snapshot.eventAt) : null,
      updatedAt: snapshot.updatedAt ? new Date(snapshot.updatedAt) : null,
      fetchedAt: null,
      closedAt: null,
    },
    severity: {
      providerLevel: snapshot.providerLevel || null,
      providerLabel: snapshot.providerLabel || null,
      displayPriority: snapshot.displayPriority || "advisory",
    },
    details: { keyMeasurement: snapshot.keyMeasurement || "" },
    source: { name: snapshot.sourceName || "", url: snapshot.sourceUrl || null },
    isArchived: true,
    savedAt: entry.savedAt,
  };
}

function recencyCutoff(recency) {
  const now = Date.now();
  if (recency === "day") return now - 24 * 60 * 60 * 1000;
  if (recency === "week") return now - 7 * 24 * 60 * 60 * 1000;
  return null;
}

function renderFeed() {
  elements.feed.replaceChildren();
  elements.feed.setAttribute("aria-busy", "false");
  elements.resultCount.textContent = `${state.filteredEvents.length} ${pluralize("result", state.filteredEvents.length)}`;

  if (state.filteredEvents.length === 0) {
    elements.feed.hidden = true;
    elements.loadMore.hidden = true;
    renderEmptyState();
    return;
  }

  elements.feed.hidden = false;
  elements.emptyState.hidden = true;

  const savedIds = new Set(getWatchlist().map((entry) => entry.id));
  const fragment = document.createDocumentFragment();
  state.filteredEvents.slice(0, state.visibleCount).forEach((event) => fragment.append(createEventCard(event, savedIds)));
  elements.feed.append(fragment);

  const remaining = state.filteredEvents.length - state.visibleCount;
  elements.loadMore.hidden = remaining <= 0;
  if (remaining > 0) elements.loadMore.textContent = `Load more events (${remaining} remaining)`;
}

function createEventCard(event, savedIds) {
  const level = event.severity.displayPriority;
  const article = createElement("article", `alert-card alert-card--${level}`);
  article.dataset.eventId = event.id;
  if (event.id === state.selectedEventId) article.classList.add("is-selected");

  const button = createElement("button", "alert-card__button");
  button.type = "button";
  button.setAttribute("aria-label", `View details for ${event.title}`);
  button.addEventListener("click", () => openLiveEarthEventDetails(event));

  const topLine = createElement("div", "alert-card__topline");
  const badge = createElement("span", "severity-badge", CATEGORY_LABELS[event.category] || "Event");
  const time = createElement("span", "alert-card__time", relativeTimeLabel(event.time.eventAt || event.time.updatedAt));
  topLine.append(badge, time);

  const title = createElement("h3", "", event.title);
  const headline = createElement("p", "alert-card__headline", buildHeadline(event));
  const area = createElement("p", "alert-card__area", event.region.place || event.region.countries.join(", ") || "Location unavailable");

  const footer = createElement("div", "alert-card__footer");
  const authority = createElement("span", "", event.source.name);
  const priorityLabel = createElement("span", "", DISPLAY_PRIORITY_LABELS[level] || "Informational");
  footer.append(authority, priorityLabel);
  if (savedIds?.has(event.id)) {
    footer.append(createElement("span", "", event.isArchived ? "Archived" : "Saved"));
  }

  button.append(topLine, title, headline, area, footer);
  article.append(button);
  return article;
}

function buildHeadline(event) {
  const details = event.details;

  if (event.isArchived) return details?.keyMeasurement || "Archived — limited data available";

  if (event.category === "earthquake") {
    const parts = [];
    if (details.magnitude != null) parts.push(`M ${details.magnitude.toFixed(1)}`);
    if (details.depthKm != null) parts.push(`${Math.round(details.depthKm)} km depth`);
    if (details.tsunami) parts.push("Tsunami flagged");
    return parts.join(" · ") || "Details unavailable";
  }

  if (event.category === "cyclone") {
    const parts = [];
    if (details.maxWindMph != null) parts.push(`${details.maxWindMph} mph sustained`);
    else if (details.maxWindKt != null) parts.push(`${details.maxWindKt} kt sustained`);
    if (details.pressureMb != null) parts.push(`${details.pressureMb} mb`);
    return parts.join(" · ") || event.severity.providerLabel || "Details unavailable";
  }

  if (event.category === "flood") {
    return details.severityText || event.region.countries.join(", ") || "Details unavailable";
  }

  // wildfire / volcano — EONET gives no severity signal, so this stays a
  // plain lifecycle statement rather than implying a magnitude we don't have.
  return event.status === "closed" ? "No longer active" : "Currently tracked as active";
}

function renderEmptyState() {
  const filtered = state.category !== "all" || state.priority !== "all" || state.recency !== "all" || state.search.trim() !== "";

  if (state.category === "saved") {
    elements.emptyHeading.textContent = "No saved events yet";
    elements.emptyText.textContent = "Open an event and select the bookmark icon to save it here.";
    elements.clearFilters.hidden = !(state.priority !== "all" || state.recency !== "all" || state.search.trim() !== "");
  } else if (state.events.length === 0 && !state.loading) {
    elements.emptyHeading.textContent = "No tracked events reported";
    elements.emptyText.textContent = "There are currently no significant events from any connected source.";
    elements.clearFilters.hidden = true;
  } else {
    elements.emptyHeading.textContent = "No matching events";
    elements.emptyText.textContent = "Try changing a filter or search to view other tracked events.";
    elements.clearFilters.hidden = !filtered;
  }

  elements.emptyState.hidden = false;
}

function updateLiveStatus() {
  const count = state.events.length;
  const allHealthy = Object.values(state.providerCache).every((entry) => entry.status === "ok");
  elements.liveBadgeLabel.textContent = allHealthy ? "Live" : "Partial";
  elements.updatedLabel.textContent = "Updated";
  elements.activeCount.textContent = `${count} Tracked ${pluralize("Event", count)}`;
  elements.lastUpdated.textContent = formatDateTime(state.lastUpdated, { timeOnly: true });
  elements.lastUpdated.dateTime = state.lastUpdated?.toISOString() || "";
}

function updateMap() {
  elements.mappedCount.textContent = `${state.filteredEvents.length} of ${state.events.length} events`;
  if (state.map) {
    state.map.setEvents(state.filteredEvents);
  } else if (!state.mapFailed) {
    setMapState("loading", "Preparing the global map", "Loading event data from official sources.");
  }
}

function openLiveEarthEventDetails(event) {
  clearStaleLinkNotice();
  state.selectedEventId = event.id;
  document.querySelectorAll(".alert-card").forEach((card) => {
    card.classList.toggle("is-selected", card.dataset.eventId === event.id);
  });

  state.map?.selectEvent(event);
  replaceLiveEarthUrl({ event: event.id });

  const level = event.severity.displayPriority;
  openEventDialog({
    level,
    eyebrow: event.isArchived ? `Saved ${event.source.name || "event"}` : `Official ${event.source.name} data`,
    severityLabel: event.severity.providerLabel || DISPLAY_PRIORITY_LABELS[level] || "Informational",
    title: event.title,
    headline: buildHeadline(event),
    areaHeading: "Location",
    area: event.region.place || event.region.countries.join(", ") || "Location unavailable",
    descriptionHeading: "Summary",
    description: buildDescription(event),
    authority: event.source.name || "Unknown source",
    sourceUrl: event.source.url,
    fields: buildDetailFields(event),
  }, {
    onClose: clearLiveEarthSelection,
    isSaved: isSaved(event.id),
    onSave: () => toggleSaved(event),
    onShare: () => shareEvent(event),
  });
}

function toggleSaved(event) {
  const wasSaved = isSaved(event.id);
  if (wasSaved) removeEvent(event.id); else saveEvent(event);

  renderFeed();
  if (state.category === "saved") applyFilters();
  return !wasSaved;
}

async function shareEvent(event) {
  replaceLiveEarthUrl({ event: event.id });
  const url = window.location.href;

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(url);
      announce("Link to this event copied to the clipboard.");
      return;
    }
  } catch {
    // fall through to the manual-copy announcement below
  }
  announce(`Copy this link to share the event: ${url}`);
}

function buildDescription(event) {
  const parts = [`${CATEGORY_LABELS[event.category] || "Event"} tracked by ${event.source.name}.`];
  if (event.severity.providerLabel) parts.push(`${event.severity.providerLabel}.`);
  return parts.join(" ");
}

function buildDetailFields(event) {
  const details = event.details;

  // The live/archived distinction always leads — a saved snapshot must
  // never look like it's currently live.
  const dataStatus = event.isArchived
    ? `Archived — last known ${formatDateTime(event.time.updatedAt || event.time.eventAt)}`
    : "Live";

  if (event.isArchived) {
    return [
      ["Data status", dataStatus],
      ["Category", CATEGORY_LABELS[event.category] || "Event"],
      ["Key measurement", details?.keyMeasurement || "Unavailable"],
      ["Last known time", formatDateTime(event.time.eventAt || event.time.updatedAt)],
    ];
  }

  const common = [
    ["Data status", dataStatus],
    ["Category", CATEGORY_LABELS[event.category] || "Event"],
    ["Status", capitalize(event.status)],
    ["Event time", formatDateTime(event.time.eventAt)],
    ["Last updated", formatDateTime(event.time.updatedAt)],
    ["Data retrieved", formatDateTime(event.time.fetchedAt)],
  ];

  let specific = [];
  if (event.category === "earthquake") {
    specific = [
      ["Magnitude", details.magnitude != null ? `${details.magnitude.toFixed(1)} ${details.magnitudeType || ""}`.trim() : "Unavailable"],
      ["Depth", details.depthKm != null ? `${details.depthKm.toFixed(1)} km` : "Unavailable"],
      ["Tsunami", details.tsunami ? "Flagged by USGS" : "Not flagged"],
      ["USGS significance", details.significance != null ? String(details.significance) : "Unavailable"],
    ];
  } else if (event.category === "cyclone" && event.provider === "nhc") {
    specific = [
      ["Classification", details.classificationLabel || "Unavailable"],
      ["Max sustained wind", details.maxWindMph != null ? `${details.maxWindMph} mph (${details.maxWindKt} kt)` : "Unavailable"],
      ["Pressure", details.pressureMb != null ? `${details.pressureMb} mb` : "Unavailable"],
      ["Basin", details.basin || "Unavailable"],
      ["Latest advisory", details.advisoryNumber ? `#${details.advisoryNumber}` : "Unavailable"],
    ];
  } else if (event.category === "cyclone") {
    // EONET/JTWC-tracked storms (outside NHC/CPHC basins) carry far less
    // detail than Phase 3's tropical architecture — only show what's real.
    specific = [
      ["Max sustained wind", details.maxWindKt != null ? `${details.maxWindKt} kt` : "Unavailable"],
      ["Tracking points reported", String(details.trackPointCount || 0)],
    ];
  } else if (event.category === "flood") {
    specific = [
      ["Affected countries", event.region.countries.join(", ") || "Unavailable"],
      ["Underlying data source", details.underlyingSource || "Unavailable"],
      ["GLIDE number", details.glideNumber || "Not assigned"],
    ];
  } else if (event.category === "wildfire" || event.category === "volcano") {
    if (details.magnitudeValue != null) {
      specific = [["Reported extent", `${details.magnitudeValue} ${details.magnitudeUnit || ""}`.trim()]];
    }
  }

  return [...common, ...specific];
}

function clearLiveEarthSelection() {
  state.selectedEventId = "";
  document.querySelectorAll(".alert-card.is-selected").forEach((card) => card.classList.remove("is-selected"));
  state.map?.clearSelection();
  replaceLiveEarthUrl({ event: null });
}

function clearLiveEarthFilters() {
  state.priority = "all";
  state.recency = "all";
  state.search = "";
  elements.priorityFilter.value = "all";
  elements.recencyFilter.value = "all";
  elements.searchInput.value = "";
  setCategory("all");
}

/**
 * One-time (per page load) restore of ?event= and ?category= once the first
 * batch of live data has arrived. A shared event id is resolved against
 * live data first, then the local watchlist snapshot, and otherwise shown
 * as a clear, non-fabricated "no longer available" message — never a blank
 * screen or an invented result.
 */
function restoreUrlState() {
  const categoryParam = readParam(window.location.search, "category");
  if (categoryParam && REAL_CATEGORIES.includes(categoryParam)) setCategory(categoryParam);

  const eventParam = readParam(window.location.search, "event");
  if (!eventParam) return;

  const liveMatch = state.events.find((event) => event.id === eventParam);
  if (liveMatch) {
    openLiveEarthEventDetails(liveMatch);
    return;
  }

  const savedEntry = findSavedEntry(eventParam);
  if (savedEntry) {
    openLiveEarthEventDetails(eventFromSnapshot(savedEntry));
    return;
  }

  showError("This event is no longer available in the current live feed.");
  state.hasStaleLinkNotice = true;
  replaceLiveEarthUrl({ event: null });
}

// The "shared link is stale" notice above is about one specific event, not
// the live feed's health — so unlike a real provider outage, it should not
// keep following the user once they've moved on to something else that
// works (a new filter, search, or a different event they open successfully).
function clearStaleLinkNotice() {
  if (!state.hasStaleLinkNotice || describeProviderIssues(state.providerCache)) return;
  hideError();
}

function setFeedLoading(isLoading) {
  elements.feed.setAttribute("aria-busy", String(isLoading));
  if (!isLoading || state.events.length > 0) return;

  elements.feed.hidden = false;
  elements.emptyState.hidden = true;
  elements.loadMore.hidden = true;
  elements.feed.replaceChildren(
    createElement("div", "alert-card-skeleton"),
    createElement("div", "alert-card-skeleton"),
    createElement("div", "alert-card-skeleton"),
  );
}

function setRefreshState(isLoading) {
  elements.refreshButton.classList.toggle("is-loading", isLoading);
  elements.refreshButton.toggleAttribute("disabled", isLoading);
  elements.refreshButton.setAttribute("aria-label", isLoading ? "Refreshing global events" : "Refresh global events");
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
  state.hasStaleLinkNotice = false;
}
