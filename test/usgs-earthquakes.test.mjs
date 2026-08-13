import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeEarthquake } from "../services/usgs-earthquakes.js";

// Captured from a live USGS 2.5_day.geojson response.
const QUAKE_FIXTURE = {
  type: "Feature",
  id: "ci40671666",
  properties: {
    mag: 2.53,
    place: "28 km SSW of Ocotillo Wells, CA",
    time: 1786613478030,
    updated: 1786614114310,
    url: "https://earthquake.usgs.gov/earthquakes/eventpage/ci40671666",
    felt: null,
    alert: null,
    status: "automatic",
    tsunami: 0,
    sig: 98,
    magType: "ml",
    type: "earthquake",
    title: "M 2.5 - 28 km SSW of Ocotillo Wells, CA",
  },
  geometry: { type: "Point", coordinates: [-116.251166666667, 32.914, 5.61] },
};

test("normalizeEarthquake — normalizes a real USGS feature", () => {
  const event = normalizeEarthquake(QUAKE_FIXTURE);

  assert.equal(event.provider, "usgs");
  assert.equal(event.providerEventId, "ci40671666");
  assert.equal(event.category, "earthquake");
  assert.equal(event.title, "M 2.5 - 28 km SSW of Ocotillo Wells, CA");
  assert.equal(event.status, "automatic");
  assert.deepEqual(event.position, { lat: 32.914, lon: -116.251166666667 });
  assert.equal(event.details.depthKm, 5.61);
  assert.equal(event.details.magnitude, 2.53);
  assert.equal(event.details.magnitudeType, "ml");
  assert.equal(event.details.tsunami, false);
  assert.equal(event.details.significance, 98);
  assert.equal(event.time.eventAt.getTime(), 1786613478030);
  assert.equal(event.severity.displayPriority, "advisory", "sig 98 is below the lowest threshold");
  assert.equal(event.source.name, "USGS");
});

test("normalizeEarthquake — tsunami flag and PAGER alert both surface correctly", () => {
  const event = normalizeEarthquake({
    ...QUAKE_FIXTURE,
    properties: { ...QUAKE_FIXTURE.properties, tsunami: 1, alert: "orange", sig: 800 },
  });
  assert.equal(event.details.tsunami, true);
  assert.equal(event.severity.providerLevel, "orange");
  assert.equal(event.severity.displayPriority, "critical");
});

test("normalizeEarthquake — falls back to a generated title when USGS omits one", () => {
  const event = normalizeEarthquake({
    ...QUAKE_FIXTURE,
    properties: { ...QUAKE_FIXTURE.properties, title: undefined },
  });
  assert.equal(event.title, "M 2.5 Earthquake");
});

test("normalizeEarthquake — missing optional fields degrade gracefully", () => {
  const minimal = { type: "Feature", id: "test1", properties: {}, geometry: null };
  const event = normalizeEarthquake(minimal);

  assert.equal(event.title, "Earthquake");
  assert.equal(event.position, null);
  assert.equal(event.details.magnitude, null);
  assert.equal(event.details.tsunami, false);
  assert.equal(event.severity.displayPriority, "advisory");
});

test("normalizeEarthquake — malformed input returns null instead of throwing", () => {
  assert.equal(normalizeEarthquake(null), null);
  assert.equal(normalizeEarthquake(undefined), null);
  assert.equal(normalizeEarthquake({ type: "Feature", properties: null }), null);
  assert.equal(normalizeEarthquake({ type: "Feature", id: "", properties: {} }), null, "no usable id at all");
});
