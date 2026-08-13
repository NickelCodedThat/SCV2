import { test } from "node:test";
import assert from "node:assert/strict";

// services/quick-locations.js is browser-only (window.localStorage); provide
// a minimal in-memory stand-in so it can run under Node. Set up before
// importing, since a dynamic import (unlike a static one) only runs after
// this file's own top-level code — avoiding the usual ESM hoisting gotcha.
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

const {
  getQuickLocations,
  isSaved,
  findSavedLocation,
  saveLocation,
  removeLocation,
  buildLocationId,
  QUICK_LOCATIONS_MAX,
} = await import("../services/quick-locations.js");

function resetStorage() {
  storage = createMemoryStorage();
  globalThis.window.localStorage = storage;
}

const MYRTLE_BEACH = Object.freeze({
  name: "Myrtle Beach",
  admin1: "South Carolina",
  admin2: "",
  country: "United States",
  country_code: "US",
  latitude: 33.6891,
  longitude: -78.8951,
  timezone: "auto",
});

const NEW_YORK = Object.freeze({
  name: "New York",
  admin1: "New York",
  admin2: "",
  country: "United States",
  country_code: "US",
  latitude: 40.7128,
  longitude: -74.006,
  timezone: "America/New_York",
});

test("buildLocationId is stable and rejects non-finite coordinates", () => {
  assert.equal(buildLocationId(33.6891, -78.8951), "33.6891,-78.8951");
  assert.equal(buildLocationId(NaN, -78.8951), "");
  assert.equal(buildLocationId(33.6891, undefined), "");
});

test("first-ever access seeds the four original default locations", () => {
  resetStorage();
  const list = getQuickLocations();
  assert.equal(list.length, 4);
  assert.ok(list.some((location) => location.name === "New York City"));
  assert.ok(list.some((location) => location.name === "Myrtle Beach"));
  assert.ok(list.every((location) => Number.isFinite(location.latitude) && Number.isFinite(location.longitude)));
});

test("saveLocation adds a new location by coordinates, not name alone", () => {
  resetStorage();
  storage.setItem("storm-chaser:quick-locations:v1", JSON.stringify({ version: 1, items: [] }));

  const result = saveLocation(MYRTLE_BEACH);
  assert.deepEqual(result, { ok: true });

  const list = getQuickLocations();
  assert.equal(list.length, 1);
  assert.equal(list[0].name, "Myrtle Beach");
  assert.equal(list[0].id, buildLocationId(33.6891, -78.8951));
  assert.ok(list[0].savedAt);
});

test("saveLocation is idempotent — saving the same coordinates twice does not duplicate", () => {
  resetStorage();
  storage.setItem("storm-chaser:quick-locations:v1", JSON.stringify({ version: 1, items: [] }));
  saveLocation(MYRTLE_BEACH);
  const second = saveLocation(MYRTLE_BEACH);
  assert.deepEqual(second, { ok: true });
  assert.equal(getQuickLocations().length, 1);
});

test("isSaved / findSavedLocation reflect current state by id", () => {
  resetStorage();
  storage.setItem("storm-chaser:quick-locations:v1", JSON.stringify({ version: 1, items: [] }));
  const id = buildLocationId(MYRTLE_BEACH.latitude, MYRTLE_BEACH.longitude);
  assert.equal(isSaved(id), false);
  saveLocation(MYRTLE_BEACH);
  assert.equal(isSaved(id), true);
  assert.equal(findSavedLocation(id).name, "Myrtle Beach");
  assert.equal(findSavedLocation("nonexistent"), null);
});

test("removeLocation removes a saved location and is a no-op otherwise", () => {
  resetStorage();
  storage.setItem("storm-chaser:quick-locations:v1", JSON.stringify({ version: 1, items: [] }));
  saveLocation(MYRTLE_BEACH);
  const id = buildLocationId(MYRTLE_BEACH.latitude, MYRTLE_BEACH.longitude);
  assert.equal(removeLocation(id), true);
  assert.equal(getQuickLocations().length, 0);
  assert.equal(removeLocation("never-saved"), true, "removing a non-existent id is a harmless no-op");
});

test("saveLocation enforces the maximum saved-location limit", () => {
  resetStorage();
  storage.setItem("storm-chaser:quick-locations:v1", JSON.stringify({ version: 1, items: [] }));

  for (let i = 0; i < QUICK_LOCATIONS_MAX; i += 1) {
    const result = saveLocation({ ...MYRTLE_BEACH, name: `City ${i}`, latitude: i, longitude: i });
    assert.deepEqual(result, { ok: true });
  }

  const overflow = saveLocation({ ...MYRTLE_BEACH, name: "One Too Many", latitude: 99, longitude: 99 });
  assert.deepEqual(overflow, { ok: false, reason: "limit" });
  assert.equal(getQuickLocations().length, QUICK_LOCATIONS_MAX);
});

test("saveLocation rejects a location with no usable coordinates or name", () => {
  resetStorage();
  assert.deepEqual(saveLocation({ name: "No coords" }), { ok: false, reason: "invalid" });
  assert.deepEqual(saveLocation({ latitude: 1, longitude: 2 }), { ok: false, reason: "invalid" });
});

test("removing every default location leaves an empty list — defaults never come back", () => {
  resetStorage();
  const seeded = getQuickLocations();
  seeded.forEach((location) => removeLocation(location.id));
  assert.deepEqual(getQuickLocations(), []);

  // A later read must not re-seed just because the list is empty.
  assert.deepEqual(getQuickLocations(), []);
  saveLocation(NEW_YORK);
  assert.equal(getQuickLocations().length, 1);
  assert.equal(getQuickLocations()[0].name, "New York");
});

test("corrupted storage — malformed JSON degrades to an empty list, never throws", () => {
  resetStorage();
  storage.setItem("storm-chaser:quick-locations:v1", "{not valid json");
  assert.doesNotThrow(() => getQuickLocations());
  assert.deepEqual(getQuickLocations(), []);
});

test("corrupted storage — valid JSON with the wrong shape degrades to an empty list", () => {
  resetStorage();
  storage.setItem("storm-chaser:quick-locations:v1", JSON.stringify({ items: "not-an-array" }));
  assert.deepEqual(getQuickLocations(), []);

  resetStorage();
  storage.setItem("storm-chaser:quick-locations:v1", JSON.stringify(["just", "an", "array"]));
  assert.deepEqual(getQuickLocations(), []);
});

test("corrupted storage — malformed individual entries are filtered out, valid ones survive", () => {
  resetStorage();
  storage.setItem("storm-chaser:quick-locations:v1", JSON.stringify({
    version: 1,
    items: [
      { id: "good:1", name: "Good City", latitude: 1, longitude: 2, savedAt: "x" },
      { id: "bad:1", name: "No coords" },
      { no: "id" },
      null,
      42,
    ],
  }));
  const list = getQuickLocations();
  assert.equal(list.length, 1);
  assert.equal(list[0].id, "good:1");
});

test("schema version mismatch — resets rather than guessing a migration", () => {
  resetStorage();
  storage.setItem("storm-chaser:quick-locations:v1", JSON.stringify({ version: 99, items: [{ id: "x" }] }));
  assert.deepEqual(getQuickLocations(), []);
});

test("blocked/quota-exceeded storage — saveLocation reports failure instead of throwing", () => {
  resetStorage();
  storage.setItem("storm-chaser:quick-locations:v1", JSON.stringify({ version: 1, items: [] }));
  globalThis.window.localStorage.setItem = () => { throw new Error("QuotaExceededError"); };
  assert.doesNotThrow(() => saveLocation(MYRTLE_BEACH));
  assert.deepEqual(saveLocation(MYRTLE_BEACH), { ok: false, reason: "storage" });
});

test("fully unavailable storage (getItem throws) degrades to an empty list", () => {
  resetStorage();
  globalThis.window.localStorage.getItem = () => { throw new Error("SecurityError"); };
  assert.doesNotThrow(() => getQuickLocations());
  assert.deepEqual(getQuickLocations(), []);
});
