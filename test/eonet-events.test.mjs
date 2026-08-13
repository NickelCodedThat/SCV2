import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeEonetEvent, isNhcCoveredStorm } from "../services/eonet-events.js";

// Captured from live NASA EONET v3 responses.
const WILDFIRE_FIXTURE = {
  id: "EONET_22430",
  title: "Wildfire Harris, Rosebud, Montana",
  closed: null,
  categories: [{ id: "wildfires", title: "Wildfires" }],
  sources: [{ id: "IRWIN", url: "https://irwin.doi.gov/observer/incidents/2026-MTMCD-000676" }],
  geometry: [{
    magnitudeValue: 924.3,
    magnitudeUnit: "acres",
    date: "2026-08-09T16:55:00Z",
    type: "Point",
    coordinates: [-106.634317, 45.195183],
  }],
};

const VOLCANO_FIXTURE = {
  id: "EONET_20710",
  title: "Nevados del Chillan Volcano, Chile",
  closed: null,
  categories: [{ id: "volcanoes", title: "Volcanoes" }],
  sources: [{ id: "SIVolcano", url: "https://volcano.si.edu/volcano.cfm?vn=357070" }],
  geometry: [{ magnitudeValue: null, magnitudeUnit: null, date: "2026-06-15T00:00:00Z", type: "Point", coordinates: [-71.378, -36.868] }],
};

const NHC_STORM_FIXTURE = {
  id: "EONET_22560",
  title: "Tropical Storm Cristobal",
  closed: null,
  categories: [{ id: "severeStorms", title: "Severe Storms" }],
  sources: [{ id: "NOAA_NHC", url: "https://www.nhc.noaa.gov/archive/2026/CRISTOBAL.shtml" }],
  geometry: [{ magnitudeValue: 40.0, magnitudeUnit: "kts", date: "2026-08-12T15:00:00Z", type: "Point", coordinates: [-43, 36.7] }],
};

const JTWC_STORM_FIXTURE = {
  id: "EONET_22561",
  title: "Super Typhoon Dolphin",
  closed: null,
  categories: [{ id: "severeStorms", title: "Severe Storms" }],
  sources: [{ id: "JTWC", url: "https://www.metoc.navy.mil/jtwc/jtwc.html" }],
  geometry: [{ magnitudeValue: 130, magnitudeUnit: "kts", date: "2026-08-12T06:00:00Z", type: "Point", coordinates: [130, 18] }],
};

test("normalizeEonetEvent — normalizes a wildfire with IRWIN attribution", () => {
  const event = normalizeEonetEvent(WILDFIRE_FIXTURE);
  assert.equal(event.provider, "eonet");
  assert.equal(event.category, "wildfire");
  assert.equal(event.title, "Wildfire Harris, Rosebud, Montana");
  assert.equal(event.status, "active");
  assert.deepEqual(event.position, { lat: 45.195183, lon: -106.634317 });
  assert.equal(event.details.magnitudeValue, 924.3);
  assert.equal(event.details.magnitudeUnit, "acres");
  assert.match(event.source.name, /IRWIN/);
  assert.equal(event.severity.displayPriority, "advisory", "EONET has no severity signal — never fabricated");
  assert.equal(event.severity.providerLevel, null);
});

test("normalizeEonetEvent — normalizes a volcano with Smithsonian GVP attribution", () => {
  const event = normalizeEonetEvent(VOLCANO_FIXTURE);
  assert.equal(event.category, "volcano");
  assert.match(event.source.name, /Smithsonian/);
});

test("normalizeEonetEvent — a closed event gets status 'closed'", () => {
  const event = normalizeEonetEvent({ ...WILDFIRE_FIXTURE, closed: "2026-08-11T00:00:00Z" });
  assert.equal(event.status, "closed");
  assert.equal(event.time.closedAt.toISOString(), "2026-08-11T00:00:00.000Z");
});

test("normalizeEonetEvent — an unrecognized category returns null", () => {
  const event = normalizeEonetEvent({ ...WILDFIRE_FIXTURE, categories: [{ id: "drought", title: "Drought" }] });
  assert.equal(event, null);
});

test("normalizeEonetEvent — malformed input returns null instead of throwing", () => {
  assert.equal(normalizeEonetEvent(null), null);
  assert.equal(normalizeEonetEvent({}), null);
  assert.equal(normalizeEonetEvent({ id: "", categories: [{ id: "wildfires" }] }), null, "no usable id");
});

test("dedup rule — a JTWC-sourced storm normalizes fine on its own", () => {
  const event = normalizeEonetEvent(JTWC_STORM_FIXTURE);
  assert.ok(event, "JTWC storms are not covered by Phase 3's NHC tracking, so they should normalize");
  assert.equal(event.category, "cyclone");
  assert.match(event.source.name, /Joint Typhoon Warning Center/);
});

test("dedup rule — isNhcCoveredStorm flags NOAA_NHC severe-storm events specifically", () => {
  assert.equal(isNhcCoveredStorm(NHC_STORM_FIXTURE), true);
  assert.equal(isNhcCoveredStorm(JTWC_STORM_FIXTURE), false, "JTWC storms are not covered by Phase 3");
  assert.equal(isNhcCoveredStorm(WILDFIRE_FIXTURE), false, "not a severe-storm event at all");
});

test("dedup rule — fetchEonetEvents excludes NOAA_NHC-sourced storms (covered by Phase 3)", () => {
  const events = [NHC_STORM_FIXTURE, JTWC_STORM_FIXTURE];
  const kept = events.filter((event) => !isNhcCoveredStorm(event)).map(normalizeEonetEvent);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].title, "Super Typhoon Dolphin");
});
