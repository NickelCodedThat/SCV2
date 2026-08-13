import { test } from "node:test";
import assert from "node:assert/strict";
import { matchesSearch, compareEvents } from "../utils/event-query.js";

function makeEvent(overrides = {}) {
  return {
    id: "usgs:1",
    category: "earthquake",
    title: "M 4.6 - 3 km ESE of Gambiran Satu, Indonesia",
    region: { place: "3 km ESE of Gambiran Satu, Indonesia", countries: [] },
    severity: { displayPriority: "elevated" },
    details: { magnitude: 4.6 },
    time: { eventAt: new Date("2026-08-13T06:00:00Z") },
    ...overrides,
  };
}

test("matchesSearch — empty/whitespace query matches everything", () => {
  const event = makeEvent();
  assert.equal(matchesSearch(event, ""), true);
  assert.equal(matchesSearch(event, "   "), true);
  assert.equal(matchesSearch(event, undefined), true);
});

test("matchesSearch — case-insensitive title match", () => {
  const event = makeEvent();
  assert.equal(matchesSearch(event, "indonesia"), true);
  assert.equal(matchesSearch(event, "INDONESIA"), true);
  assert.equal(matchesSearch(event, "InDoNeSiA"), true);
});

test("matchesSearch — whitespace in the query is normalized", () => {
  const event = makeEvent();
  assert.equal(matchesSearch(event, "  gambiran   satu  "), true);
});

test("matchesSearch — matches region place, countries, and category label", () => {
  const event = makeEvent({
    category: "flood",
    title: "Flood in China",
    region: { place: "China", countries: ["China"] },
  });
  assert.equal(matchesSearch(event, "china"), true);
  assert.equal(matchesSearch(event, "flood"), true);
});

test("matchesSearch — a storm's classification is searchable", () => {
  const event = makeEvent({
    category: "cyclone",
    title: "Tropical Depression Cristobal",
    region: { place: "38.6°N, 38.2°W" },
    details: { classificationLabel: "Tropical Depression" },
  });
  assert.equal(matchesSearch(event, "tropical depression"), true);
  assert.equal(matchesSearch(event, "cristobal"), true);
});

test("matchesSearch — magnitude text without a space matches (M6.5 style)", () => {
  const event = makeEvent({ details: { magnitude: 6.5 } });
  assert.equal(matchesSearch(event, "M6.5"), true);
  assert.equal(matchesSearch(event, "m6.5"), true);
  assert.equal(matchesSearch(event, "M 6.5"), true);
});

test("matchesSearch — no match returns false", () => {
  assert.equal(matchesSearch(makeEvent(), "antarctica"), false);
});

test("compareEvents — 'recent' mode sorts newest first", () => {
  const older = makeEvent({ id: "a", time: { eventAt: new Date("2026-08-10T00:00:00Z") } });
  const newer = makeEvent({ id: "b", time: { eventAt: new Date("2026-08-13T00:00:00Z") } });
  const sorted = [older, newer].sort((a, b) => compareEvents(a, b, "recent"));
  assert.deepEqual(sorted.map((e) => e.id), ["b", "a"]);
});

test("compareEvents — 'priority' mode sorts critical before advisory", () => {
  const low = makeEvent({ id: "a", severity: { displayPriority: "advisory" } });
  const high = makeEvent({ id: "b", severity: { displayPriority: "critical" } });
  const sorted = [low, high].sort((a, b) => compareEvents(a, b, "priority"));
  assert.deepEqual(sorted.map((e) => e.id), ["b", "a"]);
});

test("compareEvents — deterministic tie-break by id when priority and time are equal", () => {
  const time = new Date("2026-08-13T00:00:00Z");
  const eventB = makeEvent({ id: "b", severity: { displayPriority: "elevated" }, time: { eventAt: time } });
  const eventA = makeEvent({ id: "a", severity: { displayPriority: "elevated" }, time: { eventAt: time } });

  const sortedOnce = [eventB, eventA].sort((a, b) => compareEvents(a, b, "priority"));
  const sortedAgain = [eventA, eventB].sort((a, b) => compareEvents(a, b, "priority"));
  assert.deepEqual(sortedOnce.map((e) => e.id), ["a", "b"]);
  assert.deepEqual(sortedAgain.map((e) => e.id), ["a", "b"], "order is identical regardless of input order");
});

test("compareEvents — an unknown/missing displayPriority sorts after known tiers", () => {
  const known = makeEvent({ id: "a", severity: { displayPriority: "advisory" } });
  const unknown = makeEvent({ id: "b", severity: {} });
  const sorted = [unknown, known].sort((a, b) => compareEvents(a, b, "priority"));
  assert.deepEqual(sorted.map((e) => e.id), ["a", "b"]);
});

test("compareEvents — an event with no time sorts as least recent, not crashing", () => {
  const withTime = makeEvent({ id: "a" });
  const noTime = makeEvent({ id: "b", time: {} });
  assert.doesNotThrow(() => [withTime, noTime].sort((a, b) => compareEvents(a, b, "recent")));
  const sorted = [noTime, withTime].sort((a, b) => compareEvents(a, b, "recent"));
  assert.deepEqual(sorted.map((e) => e.id), ["a", "b"]);
});
