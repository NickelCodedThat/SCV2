import test from "node:test";
import assert from "node:assert/strict";
import { haversineDistanceKm } from "../utils/geo-distance.js";

test("haversineDistanceKm returns 0 for identical coordinates", () => {
  assert.equal(haversineDistanceKm(33.6891, -78.8951, 33.6891, -78.8951), 0);
});

test("haversineDistanceKm computes a known short distance accurately", () => {
  // Myrtle Beach, SC -> Myrtle Beach tide station is ~3.6km per NOAA's own coordinates.
  const distance = haversineDistanceKm(33.6891, -78.8951, 33.6968, -78.8656);
  assert.ok(distance > 2.5 && distance < 4.5, `expected ~3.6km, got ${distance}`);
});

test("haversineDistanceKm computes a known long distance accurately", () => {
  // New York, NY -> Pittsburgh, PA is roughly 500km as the crow flies.
  const distance = haversineDistanceKm(40.7128, -74.006, 40.4406, -79.9959);
  assert.ok(distance > 480 && distance < 520, `expected ~500km, got ${distance}`);
});

test("haversineDistanceKm is symmetric", () => {
  const a = haversineDistanceKm(25.7617, -80.1918, 40.7128, -74.006);
  const b = haversineDistanceKm(40.7128, -74.006, 25.7617, -80.1918);
  assert.equal(a, b);
});
