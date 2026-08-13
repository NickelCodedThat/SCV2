import { test } from "node:test";
import assert from "node:assert/strict";

// services/watchlist.js is browser-only (window.localStorage); provide a
// minimal in-memory stand-in so its save/remove/parse logic can run under
// Node without a real browser. Set up before importing, since a dynamic
// import (unlike a static one) only runs after this file's own top-level
// code — avoiding the usual ESM hoisting gotcha.
function createMemoryStorage() {
  const store = new Map();
  return {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
    _raw: store,
  };
}

let storage = createMemoryStorage();
globalThis.window = { localStorage: storage };

const { getWatchlist, isSaved, saveEvent, removeEvent, findSavedEntry, buildSnapshot } =
  await import("../services/watchlist.js");

function resetStorage() {
  storage = createMemoryStorage();
  globalThis.window.localStorage = storage;
}

const EARTHQUAKE_EVENT = Object.freeze({
  id: "usgs:ci40671666",
  provider: "usgs",
  category: "earthquake",
  title: "M 2.5 - 28 km SSW of Ocotillo Wells, CA",
  position: Object.freeze({ lat: 32.914, lon: -116.251166666667 }),
  region: Object.freeze({ place: "28 km SSW of Ocotillo Wells, CA", countries: Object.freeze([]) }),
  severity: Object.freeze({ providerLevel: null, providerLabel: "USGS significance 98", displayPriority: "advisory" }),
  details: Object.freeze({ magnitude: 2.53, depthKm: 5.61 }),
  time: Object.freeze({ eventAt: new Date("2026-08-13T05:31:18.030Z"), updatedAt: new Date("2026-08-13T05:41:54.310Z") }),
  source: Object.freeze({ name: "USGS", url: "https://earthquake.usgs.gov/earthquakes/eventpage/ci40671666" }),
});

test("saveEvent — adds a compact snapshot, not the raw event", () => {
  resetStorage();
  const ok = saveEvent(EARTHQUAKE_EVENT);
  assert.equal(ok, true);

  const list = getWatchlist();
  assert.equal(list.length, 1);
  assert.equal(list[0].id, "usgs:ci40671666");
  assert.equal(list[0].provider, "usgs");
  assert.equal(list[0].category, "earthquake");
  assert.ok(list[0].savedAt, "has a savedAt timestamp");
  assert.equal(list[0].snapshot.title, EARTHQUAKE_EVENT.title);
  assert.equal(list[0].snapshot.keyMeasurement, "M 2.5");
  assert.equal(list[0].snapshot.sourceUrl, EARTHQUAKE_EVENT.source.url);
  assert.equal(list[0].snapshot.eventAt, "2026-08-13T05:31:18.030Z");
});

test("isSaved / findSavedEntry reflect current state", () => {
  resetStorage();
  assert.equal(isSaved(EARTHQUAKE_EVENT.id), false);
  saveEvent(EARTHQUAKE_EVENT);
  assert.equal(isSaved(EARTHQUAKE_EVENT.id), true);
  assert.equal(findSavedEntry(EARTHQUAKE_EVENT.id).id, EARTHQUAKE_EVENT.id);
  assert.equal(findSavedEntry("nonexistent"), null);
});

test("saveEvent — saving twice does not create a duplicate", () => {
  resetStorage();
  saveEvent(EARTHQUAKE_EVENT);
  saveEvent(EARTHQUAKE_EVENT);
  assert.equal(getWatchlist().length, 1);
});

test("removeEvent — removes a saved event and is a no-op otherwise", () => {
  resetStorage();
  saveEvent(EARTHQUAKE_EVENT);
  assert.equal(removeEvent(EARTHQUAKE_EVENT.id), true);
  assert.equal(getWatchlist().length, 0);
  assert.equal(removeEvent("never-saved"), true, "removing a non-existent id is a harmless no-op");
});

test("buildSnapshot — omits raw geometry/provider payload, keeps only display fields", () => {
  const snapshot = buildSnapshot(EARTHQUAKE_EVENT);
  assert.deepEqual(Object.keys(snapshot).sort(), [
    "countries", "displayPriority", "eventAt", "keyMeasurement", "place", "position",
    "providerLabel", "providerLevel", "sourceName", "sourceUrl", "title", "updatedAt",
  ]);
  assert.deepEqual(snapshot.position, { lat: 32.914, lon: -116.251166666667 });
});

test("corrupted storage — malformed JSON degrades to an empty list, never throws", () => {
  resetStorage();
  storage.setItem("storm-chaser:watchlist:v1", "{not valid json");
  assert.doesNotThrow(() => getWatchlist());
  assert.deepEqual(getWatchlist(), []);
});

test("corrupted storage — valid JSON with the wrong shape degrades to an empty list", () => {
  resetStorage();
  storage.setItem("storm-chaser:watchlist:v1", JSON.stringify({ items: "not-an-array" }));
  assert.deepEqual(getWatchlist(), []);

  resetStorage();
  storage.setItem("storm-chaser:watchlist:v1", JSON.stringify(["just", "an", "array"]));
  assert.deepEqual(getWatchlist(), []);
});

test("corrupted storage — malformed individual entries are filtered out, valid ones survive", () => {
  resetStorage();
  storage.setItem("storm-chaser:watchlist:v1", JSON.stringify({
    version: 1,
    items: [{ id: "good:1", provider: "usgs", category: "earthquake", savedAt: "x", snapshot: {} }, { no: "id" }, null, 42],
  }));
  const list = getWatchlist();
  assert.equal(list.length, 1);
  assert.equal(list[0].id, "good:1");
});

test("schema version mismatch — resets rather than guessing a migration", () => {
  resetStorage();
  storage.setItem("storm-chaser:watchlist:v1", JSON.stringify({ version: 99, items: [{ id: "x" }] }));
  assert.deepEqual(getWatchlist(), []);
});

test("blocked/quota-exceeded storage — saveEvent reports failure instead of throwing", () => {
  resetStorage();
  globalThis.window.localStorage.setItem = () => { throw new Error("QuotaExceededError"); };
  assert.doesNotThrow(() => saveEvent(EARTHQUAKE_EVENT));
  assert.equal(saveEvent(EARTHQUAKE_EVENT), false);
});

test("saveEvent — an event with no id is rejected", () => {
  resetStorage();
  assert.equal(saveEvent({ title: "no id" }), false);
  assert.equal(saveEvent(null), false);
});
