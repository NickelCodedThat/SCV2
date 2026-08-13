import { test } from "node:test";
import assert from "node:assert/strict";
import {
  getSaffirSimpsonCategory,
  isMajorHurricaneCategory,
  describeTropicalClassification,
} from "../utils/hurricane-scale.js";

test("getSaffirSimpsonCategory — below hurricane strength returns null", () => {
  assert.equal(getSaffirSimpsonCategory(63), null);
  assert.equal(getSaffirSimpsonCategory(0), null);
});

test("getSaffirSimpsonCategory — category boundaries (NHC Saffir-Simpson thresholds)", () => {
  assert.equal(getSaffirSimpsonCategory(64), 1);
  assert.equal(getSaffirSimpsonCategory(82), 1);
  assert.equal(getSaffirSimpsonCategory(83), 2);
  assert.equal(getSaffirSimpsonCategory(95), 2);
  assert.equal(getSaffirSimpsonCategory(96), 3);
  assert.equal(getSaffirSimpsonCategory(112), 3);
  assert.equal(getSaffirSimpsonCategory(113), 4);
  assert.equal(getSaffirSimpsonCategory(136), 4);
  assert.equal(getSaffirSimpsonCategory(137), 5);
  assert.equal(getSaffirSimpsonCategory(200), 5);
});

test("getSaffirSimpsonCategory — non-finite input returns null", () => {
  assert.equal(getSaffirSimpsonCategory(undefined), null);
  assert.equal(getSaffirSimpsonCategory(null), null);
  assert.equal(getSaffirSimpsonCategory("not a number"), null);
  assert.equal(getSaffirSimpsonCategory(NaN), null);
});

test("isMajorHurricaneCategory — category 3+ is major", () => {
  assert.equal(isMajorHurricaneCategory(2), false);
  assert.equal(isMajorHurricaneCategory(3), true);
  assert.equal(isMajorHurricaneCategory(5), true);
  assert.equal(isMajorHurricaneCategory(null), false);
});

test("describeTropicalClassification — never derives a category unless NHC classified it HU", () => {
  const tropicalStorm = describeTropicalClassification({ classification: "TS", intensityKt: 60 });
  assert.equal(tropicalStorm.code, "TS");
  assert.equal(tropicalStorm.category, null);
  assert.equal(tropicalStorm.label, "Tropical Storm");
  assert.equal(tropicalStorm.displayName, "Tropical Storm");
});

test("describeTropicalClassification — derives category + major flag for hurricanes", () => {
  const majorHurricane = describeTropicalClassification({ classification: "hu", intensityKt: 140 });
  assert.equal(majorHurricane.category, 5);
  assert.equal(majorHurricane.isMajor, true);
  assert.equal(majorHurricane.displayName, "Major Hurricane · Category 5");

  const minorHurricane = describeTropicalClassification({ classification: "HU", intensityKt: 70 });
  assert.equal(minorHurricane.category, 1);
  assert.equal(minorHurricane.isMajor, false);
  assert.equal(minorHurricane.displayName, "Hurricane · Category 1");
});

test("describeTropicalClassification — prefers an officially-provided category over deriving one", () => {
  // 70 kt alone would derive to category 1 — an official category should win.
  const official = describeTropicalClassification({ classification: "HU", intensityKt: 70, officialCategory: 3 });
  assert.equal(official.category, 3);
  assert.equal(official.isMajor, true);

  const outOfRange = describeTropicalClassification({ classification: "HU", intensityKt: 70, officialCategory: 0 });
  assert.equal(outOfRange.category, 1, "falls back to deriving when the official value is out of the 1-5 range");
});

test("describeTropicalClassification — unknown/missing classification degrades gracefully", () => {
  const missing = describeTropicalClassification({});
  assert.equal(missing.code, "");
  assert.equal(missing.label, "Unclassified system");
  assert.equal(missing.category, null);

  const unknownCode = describeTropicalClassification({ classification: "XX", intensityKt: 200 });
  assert.equal(unknownCode.code, "XX");
  assert.equal(unknownCode.label, "XX");
  assert.equal(unknownCode.category, null, "category is never derived for a non-HU code, even with high winds");
});
