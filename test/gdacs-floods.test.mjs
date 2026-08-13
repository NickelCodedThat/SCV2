import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeFlood } from "../services/gdacs-floods.js";

// Captured from a live GDACS geteventlist/SEARCH response.
const FLOOD_FIXTURE = {
  type: "Feature",
  geometry: { type: "Point", coordinates: [111.6474, 32.2656] },
  properties: {
    eventtype: "FL",
    eventid: 1104081,
    episodeid: 7,
    glide: "FL-2026-000148-CHN",
    name: "Flood in China",
    alertlevel: "Orange",
    alertscore: 2,
    country: "China",
    fromdate: "2026-07-31T01:00:00",
    todate: "2026-08-13T01:00:00",
    datemodified: "2026-08-12T07:03:37",
    iso3: "CHN",
    source: "GLOFAS",
    affectedcountries: [{ iso2: "CN", iso3: "CHN", countryname: "China" }],
    severitydata: { severity: 0.0, severitytext: "Magnitude 0 ", severityunit: "" },
    iscurrent: "true",
    url: { report: "https://www.gdacs.org/report.aspx?eventid=1104081&episodeid=7&eventtype=FL" },
  },
};

test("normalizeFlood — normalizes a real GDACS flood feature", () => {
  const event = normalizeFlood(FLOOD_FIXTURE);

  assert.equal(event.provider, "gdacs");
  assert.equal(event.providerEventId, "1104081");
  assert.equal(event.category, "flood");
  assert.equal(event.title, "Flood in China");
  assert.equal(event.status, "active");
  assert.deepEqual(event.position, { lat: 32.2656, lon: 111.6474 });
  assert.deepEqual(event.region.countries, ["China"]);
  assert.equal(event.severity.providerLevel, "Orange");
  assert.equal(event.severity.displayPriority, "severe");
  assert.equal(event.details.underlyingSource, "GLOFAS");
  assert.equal(event.details.glideNumber, "FL-2026-000148-CHN");
  assert.equal(event.time.eventAt.toISOString(), "2026-07-31T01:00:00.000Z", "no-timezone date is treated as UTC");
  assert.equal(event.source.name, "Global Disaster Alert and Coordination System, GDACS");
});

test("normalizeFlood — a non-current event is marked closed with a closedAt date", () => {
  const event = normalizeFlood({
    ...FLOOD_FIXTURE,
    properties: { ...FLOOD_FIXTURE.properties, iscurrent: "false" },
  });
  assert.equal(event.status, "closed");
  assert.ok(event.time.closedAt instanceof Date);
});

test("normalizeFlood — a date string that already has a timezone is left untouched", () => {
  const event = normalizeFlood({
    ...FLOOD_FIXTURE,
    properties: { ...FLOOD_FIXTURE.properties, fromdate: "2026-07-31T01:00:00-05:00" },
  });
  assert.equal(event.time.eventAt.toISOString(), "2026-07-31T06:00:00.000Z");
});

test("normalizeFlood — missing optional fields degrade gracefully", () => {
  const minimal = { type: "Feature", geometry: null, properties: { eventtype: "FL", eventid: 42 } };
  const event = normalizeFlood(minimal);

  assert.equal(event.title, "Flood");
  assert.equal(event.position, null);
  assert.deepEqual(event.region.countries, []);
  assert.equal(event.severity.displayPriority, "advisory", "no alertlevel at all falls back to informational");
});

test("normalizeFlood — malformed input returns null instead of throwing", () => {
  assert.equal(normalizeFlood(null), null);
  assert.equal(normalizeFlood({ properties: null }), null);
  assert.equal(normalizeFlood({ properties: { eventid: "not-a-number" } }), null);
});
