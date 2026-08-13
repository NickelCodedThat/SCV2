import test from "node:test";
import assert from "node:assert/strict";
import { fetchLocationSuggestions, normalizePhotonFeature } from "../services/location-suggestions.js";

function feature(name, state, country, longitude, latitude, type = "city") {
  return {
    geometry: { coordinates: [longitude, latitude] },
    properties: { name, state, country, type },
  };
}

test("normalizePhotonFeature creates a forecast-ready location", () => {
  assert.deepEqual(
    normalizePhotonFeature(feature("London", "England", "United Kingdom", -0.1276, 51.5072)),
    {
      name: "London",
      admin1: "England",
      country: "United Kingdom",
      latitude: 51.5072,
      longitude: -0.1276,
      timezone: "auto",
    },
  );
});

test("normalizePhotonFeature rejects non-place and malformed features", () => {
  assert.equal(normalizePhotonFeature(feature("England", "", "United Kingdom", -1, 52, "state")), null);
  assert.equal(normalizePhotonFeature({ properties: { name: "Broken", type: "city" } }), null);
});

test("fetchLocationSuggestions sends the current query and returns unique top places", async () => {
  let requestedUrl;
  const london = feature("London", "England", "United Kingdom", -0.1276, 51.5072);
  const results = await fetchLocationSuggestions("  Lo  ", {
    fetchImpl: async (url) => {
      requestedUrl = new URL(url);
      return {
        ok: true,
        json: async () => ({ features: [london, london, feature("Los Angeles", "California", "United States", -118.2437, 34.0522)] }),
      };
    },
  });

  assert.equal(requestedUrl.searchParams.get("q"), "Lo");
  assert.equal(requestedUrl.searchParams.get("limit"), "30");
  assert.deepEqual(results.map((result) => result.name), ["London", "Los Angeles"]);
});

test("fetchLocationSuggestions handles empty, malformed, and failed responses", async () => {
  let called = false;
  assert.deepEqual(await fetchLocationSuggestions("", { fetchImpl: async () => { called = true; } }), []);
  assert.equal(called, false);

  await assert.rejects(
    fetchLocationSuggestions("Lo", { fetchImpl: async () => ({ ok: false, json: async () => null }) }),
    /unavailable/i,
  );
  await assert.rejects(
    fetchLocationSuggestions("Lo", { fetchImpl: async () => { throw new Error("network details"); } }),
    /unavailable/i,
  );
});
