import test from "node:test";
import assert from "node:assert/strict";
import { normalizeTidePredictions } from "../utils/tide-normalize.js";

const NOW = new Date(2026, 7, 13, 9, 0); // Aug 13, 2026, 9:00 AM local

const HILO = [
  { t: "2026-08-13 07:20", v: "-0.185", type: "L" }, // already past
  { t: "2026-08-13 12:04", v: "1.989", type: "H" }, // next high
  { t: "2026-08-13 19:29", v: "-0.402", type: "L" }, // next low
  { t: "2026-08-14 00:26", v: "2.249", type: "H" },
  { t: "2026-08-14 08:07", v: "-0.221", type: "L" }, // 23h07m after "now" — still inside the 24h window
  { t: "2026-08-14 11:00", v: "2.1", type: "H" }, // 26h after "now" — outside the 24h window
];

const HOURLY = [
  { t: "2026-08-13 08:00", v: "1.0" }, // before "now" — excluded from the curve
  { t: "2026-08-13 09:00", v: "1.2" },
  { t: "2026-08-13 10:00", v: "1.8" },
  { t: "2026-08-14 08:00", v: "3.0" }, // exactly 23h after "now" — inside the window
  { t: "2026-08-14 10:00", v: "3.5" }, // 25h after "now" — outside the window
];

test("normalizeTidePredictions parses NOAA's local time format correctly", () => {
  const result = normalizeTidePredictions({ hilo: HILO, hourly: HOURLY }, { now: NOW });
  assert.equal(result.nextHigh.time.getHours(), 12);
  assert.equal(result.nextHigh.time.getMinutes(), 4);
  assert.equal(result.nextHigh.time.getMonth(), 7); // August (0-indexed)
  assert.equal(result.nextHigh.time.getDate(), 13);
});

test("nextHigh and nextLow are the first upcoming event of each type, past ones excluded", () => {
  const result = normalizeTidePredictions({ hilo: HILO, hourly: HOURLY }, { now: NOW });
  assert.equal(result.nextHigh.height, 1.989);
  assert.equal(result.nextLow.height, -0.402);
});

test("curve only includes hourly points from now through the 24h window, nothing outside it", () => {
  const result = normalizeTidePredictions({ hilo: HILO, hourly: HOURLY }, { now: NOW });
  const heights = result.curve.map((point) => point.height);
  assert.ok(!heights.includes(1.0), "point before now must be excluded");
  assert.ok(heights.includes(1.2));
  assert.ok(heights.includes(1.8));
  assert.ok(heights.includes(3.0), "point exactly within the 24h window must be included");
  assert.ok(!heights.includes(3.5), "point beyond the 24h window must be excluded");
});

test("extremes within the window are labeled high/low and carry real predicted values", () => {
  const result = normalizeTidePredictions({ hilo: HILO, hourly: HOURLY }, { now: NOW });
  assert.equal(result.extremes.length, 4);
  assert.deepEqual(result.extremes.map((e) => e.type), ["high", "low", "high", "low"]);
  assert.equal(result.extremes[0].height, 1.989);
});

test("extremes exclude events past now and events beyond the 24h window", () => {
  const result = normalizeTidePredictions({ hilo: HILO, hourly: HOURLY }, { now: NOW });
  const heights = result.extremes.map((e) => e.height);
  assert.ok(!heights.includes(-0.185), "event before now must be excluded");
  assert.ok(!heights.includes(2.1), "event beyond the 24h window must be excluded");
});

test("unit and datum are always the values NOAA was actually queried with", () => {
  const result = normalizeTidePredictions({ hilo: HILO, hourly: HOURLY }, { now: NOW });
  assert.equal(result.unit, "ft");
  assert.equal(result.datum, "MLLW");
});

test("returns null nextHigh/nextLow rather than throwing when one type never recurs in range", () => {
  const onlyLows = HILO.filter((entry) => entry.type === "L");
  const result = normalizeTidePredictions({ hilo: onlyLows, hourly: HOURLY }, { now: NOW });
  assert.equal(result.nextHigh, null);
  assert.ok(result.nextLow);
});

test("throws when there is no usable prediction data at all", () => {
  assert.throws(() => normalizeTidePredictions({ hilo: [], hourly: [] }, { now: NOW }));
  assert.throws(() => normalizeTidePredictions({ hilo: [{ t: "garbage" }], hourly: [] }, { now: NOW }));
});

test("malformed individual entries are silently dropped, valid ones still work", () => {
  const messyHilo = [...HILO, { t: "not-a-time", v: "1", type: "H" }, { t: "2026-08-13 12:04", v: "not-a-number", type: "H" }];
  const result = normalizeTidePredictions({ hilo: messyHilo, hourly: HOURLY }, { now: NOW });
  assert.equal(result.nextHigh.height, 1.989);
});
