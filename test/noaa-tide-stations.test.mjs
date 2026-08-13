import { test } from "node:test";
import assert from "node:assert/strict";

function createMemoryStorage() {
  const store = new Map();
  return {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
  };
}

let storage = createMemoryStorage();
globalThis.window = { localStorage: storage };

const { findNearestTideStation, COASTAL_DISTANCE_KM } = await import("../services/noaa-tide-stations.js");

function resetStorage() {
  storage = createMemoryStorage();
  globalThis.window.localStorage = storage;
}

// Synthetic stations near Myrtle Beach, SC (33.6891, -78.8951): one eligible
// reference station ~4km away, one closer subordinate station that must be
// ignored, and one far-away reference station representing everything else
// on the network.
const SAMPLE_STATIONS = {
  stations: [
    { id: "8661070", name: "Springmaid Pier, Myrtle beach", type: "R", lat: 33.6552, lng: -78.9283 },
    { id: "8660000", name: "Closer Subordinate Station", type: "S", lat: 33.69, lng: -78.896 },
    { id: "9999999", name: "Far Away Reference Station", type: "R", lat: 10, lng: 10 },
  ],
};

function countingFetch(responder) {
  let calls = 0;
  const fetchImpl = async (...args) => {
    calls += 1;
    return responder(...args);
  };
  return { fetchImpl, getCalls: () => calls };
}

test("findNearestTideStation picks the nearest eligible Reference-type station within range", async () => {
  resetStorage();
  const { fetchImpl } = countingFetch(async () => ({ ok: true, json: async () => SAMPLE_STATIONS }));

  const station = await findNearestTideStation(33.6891, -78.8951, { fetchImpl });
  assert.ok(station);
  assert.equal(station.id, "8661070");
  assert.ok(station.distanceKm < COASTAL_DISTANCE_KM);
});

test("findNearestTideStation ignores Subordinate-type stations even when they're closer", async () => {
  resetStorage();
  const { fetchImpl } = countingFetch(async () => ({ ok: true, json: async () => SAMPLE_STATIONS }));
  const station = await findNearestTideStation(33.6891, -78.8951, { fetchImpl });
  assert.notEqual(station.id, "8660000");
});

test("findNearestTideStation returns null when nothing eligible is within the coastal threshold", async () => {
  resetStorage();
  const { fetchImpl } = countingFetch(async () => ({
    ok: true,
    json: async () => ({ stations: [{ id: "8594900", name: "Washington Channel, DC", type: "R", lat: 38.87, lng: -77.02 }] }),
  }));
  // Pittsburgh, PA — ~300km from its nearest reference station.
  const station = await findNearestTideStation(40.4406, -79.9959, { fetchImpl });
  assert.equal(station, null);
});

test("findNearestTideStation returns null for non-finite coordinates without fetching", async () => {
  resetStorage();
  const { fetchImpl, getCalls } = countingFetch(async () => ({ ok: true, json: async () => SAMPLE_STATIONS }));
  const station = await findNearestTideStation(NaN, -78.8951, { fetchImpl });
  assert.equal(station, null);
  assert.equal(getCalls(), 0);
});

test("station list is cached — a second lookup does not refetch", async () => {
  resetStorage();
  const { fetchImpl, getCalls } = countingFetch(async () => ({ ok: true, json: async () => SAMPLE_STATIONS }));

  await findNearestTideStation(33.6891, -78.8951, { fetchImpl });
  await findNearestTideStation(25.7617, -80.1918, { fetchImpl });
  assert.equal(getCalls(), 1, "second lookup should be served from the localStorage cache");
});

test("an expired cache entry triggers a fresh fetch", async () => {
  resetStorage();
  storage.setItem(
    "storm-chaser:tide-stations:v1",
    JSON.stringify({ cachedAt: Date.now() - 25 * 60 * 60 * 1000, stations: [] }),
  );
  const { fetchImpl, getCalls } = countingFetch(async () => ({ ok: true, json: async () => SAMPLE_STATIONS }));
  await findNearestTideStation(33.6891, -78.8951, { fetchImpl });
  assert.equal(getCalls(), 1);
});

test("a corrupted cache entry degrades to a fresh fetch rather than throwing", async () => {
  resetStorage();
  storage.setItem("storm-chaser:tide-stations:v1", "{not valid json");
  const { fetchImpl } = countingFetch(async () => ({ ok: true, json: async () => SAMPLE_STATIONS }));
  const station = await findNearestTideStation(33.6891, -78.8951, { fetchImpl });
  assert.ok(station);
});

test("a failed station-list fetch throws rather than silently returning null", async () => {
  resetStorage();
  await assert.rejects(
    findNearestTideStation(33.6891, -78.8951, { fetchImpl: async () => ({ ok: false, json: async () => null }) }),
  );
});
