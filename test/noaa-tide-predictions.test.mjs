import test from "node:test";
import assert from "node:assert/strict";
import { fetchTidePredictions } from "../services/noaa-tide-predictions.js";

const SAMPLE_HILO = [
  { t: "2026-08-13 07:20", v: "-0.185", type: "L" },
  { t: "2026-08-13 12:04", v: "1.989", type: "H" },
];
const SAMPLE_HOURLY = [
  { t: "2026-08-13 00:00", v: "2.074" },
  { t: "2026-08-13 01:00", v: "0.724" },
];

test("fetchTidePredictions requests both hilo and hourly intervals and merges results", async () => {
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(new URL(url));
    const interval = new URL(url).searchParams.get("interval");
    return { ok: true, json: async () => ({ predictions: interval === "hilo" ? SAMPLE_HILO : SAMPLE_HOURLY }) };
  };

  const result = await fetchTidePredictions("8661070", { fetchImpl, now: new Date("2026-08-13T00:00:00") });
  assert.deepEqual(result.hilo, SAMPLE_HILO);
  assert.deepEqual(result.hourly, SAMPLE_HOURLY);
  assert.equal(urls.length, 2);
  assert.ok(urls.every((url) => url.searchParams.get("station") === "8661070"));
  assert.ok(urls.every((url) => url.searchParams.get("datum") === "MLLW"));
  assert.ok(urls.every((url) => url.searchParams.get("begin_date") === "20260813"));
  assert.ok(urls.every((url) => url.searchParams.get("end_date") === "20260815"));
});

test("fetchTidePredictions surfaces NOAA's own error message", async () => {
  const fetchImpl = async () => ({
    ok: true,
    json: async () => ({ error: { message: "No Predictions data was found." } }),
  });
  await assert.rejects(fetchTidePredictions("0000000", { fetchImpl }), /No Predictions data was found/);
});

test("fetchTidePredictions rejects a non-OK response", async () => {
  const fetchImpl = async () => ({ ok: false, json: async () => null });
  await assert.rejects(fetchTidePredictions("8661070", { fetchImpl }), /unavailable/i);
});

test("fetchTidePredictions rejects malformed (non-array) predictions", async () => {
  const fetchImpl = async () => ({ ok: true, json: async () => ({ predictions: "not-an-array" }) });
  await assert.rejects(fetchTidePredictions("8661070", { fetchImpl }), /unavailable/i);
});

test("fetchTidePredictions rejects a network failure", async () => {
  const fetchImpl = async () => { throw new Error("network down"); };
  await assert.rejects(fetchTidePredictions("8661070", { fetchImpl }), /unavailable/i);
});

test("fetchTidePredictions requires a station id", async () => {
  await assert.rejects(fetchTidePredictions(null, { fetchImpl: async () => ({}) }));
});
