import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeStorm } from "../services/nhc-storms.js";

// Captured from a live query against NHC's NHC_tropical_weather_summary
// MapServer (layer 5, "Forecast Points", tau=0 — the current-position record).
const CRISTOBAL_FIXTURE = {
  type: "Feature",
  id: 25,
  geometry: { type: "Point", coordinates: [-40.999999999800025, 37.200000000399825] },
  properties: {
    objectid: 25,
    stormname: "Tropical Storm Cristobal",
    stormtype: "TS",
    dvlbl: "S",
    basin: "AL",
    advdate: "900 PM GMT Wed Aug 12 2026",
    advisnum: "2",
    fcstprd: 120,
    gust: 50,
    maxwind: 40,
    mslp: 1008,
    ssnum: 0,
    datelbl: "9:00 PM Wed",
    tcdvlp: "Tropical Storm",
    tcdir: 90,
    tcspd: 18,
    lat: 37,
    lon: -41,
    stormnum: 3,
    tau: 0,
    idp_source: "al032026-002_5day_pts",
    idp_subset: "al032026",
    idp_filedate: 1786568546000,
    idp_ingestdate: 1786568587000,
    binnumber: "AT3",
  },
};

test("normalizeStorm — normalizes a real NHC tropical summary feature", () => {
  const storm = normalizeStorm(CRISTOBAL_FIXTURE);

  assert.equal(storm.id, "al032026", "uses the advisory-stable idp_subset, not the per-advisory idp_source");
  assert.equal(storm.binNumber, "AT3");
  assert.equal(storm.basin, "Atlantic");
  assert.equal(storm.name, "Tropical Storm Cristobal");
  assert.equal(storm.classification, "TS");
  assert.equal(storm.classificationInfo.label, "Tropical Storm");
  assert.equal(storm.classificationInfo.category, null, "TS never gets a Saffir-Simpson category");
  assert.equal(storm.maxWindKt, 40);
  assert.equal(storm.maxWindMph, 46, "40 kt rounds to 46 mph");
  assert.equal(storm.gustKt, 50);
  assert.equal(storm.pressureMb, 1008);
  assert.deepEqual(storm.position, { lat: 37.200000000399825, lon: -40.999999999800025 });
  assert.equal(storm.movement.directionDeg, 90);
  assert.equal(storm.movement.speedMph, 18);
  assert.equal(storm.advisory.number, "2");
  assert.equal(storm.advisory.issuedAtLabel, "900 PM GMT Wed Aug 12 2026");
  assert.equal(storm.lastUpdate.toISOString(), new Date(1786568546000).toISOString());
  assert.equal(storm.links.publicAdvisory, "https://www.nhc.noaa.gov/graphics_at3.shtml");
  assert.equal(storm.authority, "National Hurricane Center");
});

test("normalizeStorm — Central Pacific storms are attributed to CPHC", () => {
  const storm = normalizeStorm({
    ...CRISTOBAL_FIXTURE,
    properties: { ...CRISTOBAL_FIXTURE.properties, binnumber: "CP2", idp_subset: "cp012026" },
  });
  assert.equal(storm.basin, "Central Pacific");
  assert.equal(storm.authority, "Central Pacific Hurricane Center");
});

test("normalizeStorm — a hurricane prefers the source's own Hurricane Category (ssnum) over deriving one", () => {
  const storm = normalizeStorm({
    ...CRISTOBAL_FIXTURE,
    properties: { ...CRISTOBAL_FIXTURE.properties, stormtype: "HU", maxwind: 90, ssnum: 4 },
  });
  // 90 kt would derive to category 2 on its own — the official ssnum (4) must win.
  assert.equal(storm.classificationInfo.category, 4);
  assert.equal(storm.classificationInfo.isMajor, true);
});

test("normalizeStorm — falls back to deriving a category when ssnum is unavailable", () => {
  const storm = normalizeStorm({
    ...CRISTOBAL_FIXTURE,
    properties: { ...CRISTOBAL_FIXTURE.properties, stormtype: "HU", maxwind: 90, ssnum: 0 },
  });
  assert.equal(storm.classificationInfo.category, 2);
});

test("normalizeStorm — missing optional fields degrade gracefully instead of throwing", () => {
  const minimal = {
    type: "Feature",
    geometry: null,
    properties: { binnumber: "AT5", stormname: "Test" },
  };
  const storm = normalizeStorm(minimal);

  assert.equal(storm.classification, "");
  assert.equal(storm.maxWindKt, null);
  assert.equal(storm.maxWindMph, null);
  assert.equal(storm.pressureMb, null);
  assert.equal(storm.position, null, "no point geometry means no position");
  assert.equal(storm.advisory.number, null);
  assert.equal(storm.advisory.issuedAtLabel, null);
  assert.equal(storm.lastUpdate, null);
});

test("normalizeStorm — malformed input returns null instead of throwing", () => {
  assert.equal(normalizeStorm(null), null);
  assert.equal(normalizeStorm(undefined), null);
  assert.equal(normalizeStorm("not an object"), null);
  assert.equal(normalizeStorm({ type: "Feature", geometry: null, properties: null }), null);
});

test("normalizeStorm — unknown basin prefix falls back to the raw basin code", () => {
  const storm = normalizeStorm({
    ...CRISTOBAL_FIXTURE,
    properties: { ...CRISTOBAL_FIXTURE.properties, binnumber: "WP1", basin: "WP" },
  });
  assert.equal(storm.basin, "WP");
});
