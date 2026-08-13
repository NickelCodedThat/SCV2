// Pure, DOM-free search/sort helpers over already-loaded GlobalEvents (see
// models/global-event.js). LIVE EARTH's search operates entirely on data
// Storm Chaser already has in memory — this is not a new external search
// provider, just straightforward substring matching, so no fuzzy-search
// dependency is pulled in.
import { DISPLAY_PRIORITY_ORDER } from "../models/global-event.js";

const CATEGORY_LABELS = Object.freeze({
  earthquake: "earthquake",
  wildfire: "wildfire",
  volcano: "volcano",
  flood: "flood",
  cyclone: "cyclone",
});

export function normalizeSearchTerm(term) {
  return (term || "").toLowerCase().replace(/\s+/g, " ").trim();
}

export function matchesSearch(event, term) {
  const query = normalizeSearchTerm(term);
  if (!query) return true;
  return buildSearchHaystacks(event).some((text) => text.includes(query));
}

function buildSearchHaystacks(event) {
  const haystacks = [
    event.title,
    event.region?.place,
    ...(event.region?.countries || []),
    CATEGORY_LABELS[event.category] || event.category,
  ];

  const details = event.details || {};
  if (event.category === "earthquake" && details.magnitude != null) {
    const magnitude = details.magnitude.toFixed(1);
    haystacks.push(`M${magnitude}`, `M ${magnitude}`);
  }
  if (event.category === "cyclone" && details.classificationLabel) {
    haystacks.push(details.classificationLabel);
  }

  return haystacks.filter(Boolean).map((text) => text.toLowerCase());
}

/**
 * Comparator for Array.prototype.sort. `mode` is "recent" (default) or
 * "priority" — both use a deterministic secondary key (the other axis, then
 * event id) so equal-ranked events never reorder between renders.
 */
export function compareEvents(a, b, mode) {
  if (mode === "priority") {
    return priorityRank(a) - priorityRank(b) || compareRecency(a, b) || compareId(a, b);
  }
  return compareRecency(a, b) || priorityRank(a) - priorityRank(b) || compareId(a, b);
}

function priorityRank(event) {
  const index = DISPLAY_PRIORITY_ORDER.indexOf(event.severity?.displayPriority);
  return index === -1 ? DISPLAY_PRIORITY_ORDER.length : index;
}

function compareRecency(a, b) {
  return eventTimestamp(b) - eventTimestamp(a); // most recent first
}

function compareId(a, b) {
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
}

function eventTimestamp(event) {
  const date = event.time?.eventAt || event.time?.updatedAt;
  return date instanceof Date && !Number.isNaN(date.getTime()) ? date.getTime() : 0;
}
