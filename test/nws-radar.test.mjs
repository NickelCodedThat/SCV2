import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTimeDimensionValue, selectRecentFrames, buildRadarTileUrl } from "../services/nws-radar.js";

test("parseTimeDimensionValue — parses a comma-separated ISO8601 list", () => {
  const raw = "2026-08-12T21:00:13.000Z,2026-08-12T21:04:13.000Z,2026-08-12T21:08:15.000Z";
  const times = parseTimeDimensionValue(raw);
  assert.equal(times.length, 3);
  assert.equal(times[0].toISOString(), "2026-08-12T21:00:13.000Z");
});

test("parseTimeDimensionValue — skips malformed entries instead of failing the batch", () => {
  const raw = "2026-08-12T21:00:13.000Z, not-a-date ,2026-08-12T21:08:15.000Z,";
  const times = parseTimeDimensionValue(raw);
  assert.equal(times.length, 2);
});

test("parseTimeDimensionValue — handles empty/missing input", () => {
  assert.deepEqual(parseTimeDimensionValue(""), []);
  assert.deepEqual(parseTimeDimensionValue(undefined), []);
  assert.deepEqual(parseTimeDimensionValue(null), []);
});

test("selectRecentFrames — returns the most recent N frames in chronological order", () => {
  const times = [0, 1, 2, 3, 4, 5].map((minutes) => new Date(Date.UTC(2026, 0, 1, 0, minutes)));
  const frames = selectRecentFrames(times, { maxFrames: 3 });
  assert.equal(frames.length, 3);
  assert.deepEqual(
    frames.map((date) => date.getUTCMinutes()),
    [3, 4, 5],
    "should keep the latest frames, oldest first",
  );
});

test("selectRecentFrames — sorts out-of-order input before trimming", () => {
  const times = [5, 1, 3, 0, 4, 2].map((minutes) => new Date(Date.UTC(2026, 0, 1, 0, minutes)));
  const frames = selectRecentFrames(times, { maxFrames: 2 });
  assert.deepEqual(frames.map((date) => date.getUTCMinutes()), [4, 5]);
});

test("selectRecentFrames — returns everything when there are fewer frames than the max", () => {
  const times = [new Date(Date.UTC(2026, 0, 1))];
  assert.equal(selectRecentFrames(times, { maxFrames: 15 }).length, 1);
});

test("buildRadarTileUrl — includes the WMS bbox template MapLibre expects", () => {
  const url = buildRadarTileUrl();
  assert.match(url, /\{bbox-epsg-3857\}/);
  assert.match(url, /layers=conus_base_reflectivity_mosaic/);
  assert.doesNotMatch(url, /time=/);
});

test("buildRadarTileUrl — includes the time param when a frame is given", () => {
  const url = buildRadarTileUrl("2026-08-12T21:00:13.000Z");
  assert.match(url, /time=2026-08-12T21%3A00%3A13\.000Z/);
});
