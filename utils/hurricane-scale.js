// Saffir-Simpson Hurricane Wind Scale thresholds, in knots (1-minute sustained wind),
// per NOAA/NHC: https://www.nhc.noaa.gov/aboutsshws.php
const CATEGORY_THRESHOLDS_KT = Object.freeze([
  { category: 5, minKt: 137 },
  { category: 4, minKt: 113 },
  { category: 3, minKt: 96 },
  { category: 2, minKt: 83 },
  { category: 1, minKt: 64 },
]);

const MAJOR_HURRICANE_CATEGORY = 3;

// Matches NHC's own classification codes exactly, per the official
// "NHC Tropical Cyclone Status JSON File Reference" (nhc.noaa.gov/productexamples).
export const NHC_CLASSIFICATION_LABELS = Object.freeze({
  TD: "Tropical Depression",
  STD: "Subtropical Depression",
  TS: "Tropical Storm",
  STS: "Subtropical Storm",
  HU: "Hurricane",
  PTC: "Post-Tropical Cyclone",
  PC: "Potential Tropical Cyclone",
  TY: "Typhoon",
});

/**
 * Derives the 1-5 Saffir-Simpson category from an official sustained wind
 * speed in knots. Returns null below hurricane strength (below 64 kt) or
 * for a non-finite input. This never guesses a storm's classification —
 * callers should only use it when NHC has already classified the system as
 * a hurricane (see describeTropicalClassification).
 */
export function getSaffirSimpsonCategory(windSpeedKt) {
  const value = Number(windSpeedKt);
  if (!Number.isFinite(value)) return null;

  const match = CATEGORY_THRESHOLDS_KT.find((tier) => value >= tier.minKt);
  return match ? match.category : null;
}

export function isMajorHurricaneCategory(category) {
  return Number.isFinite(category) && category >= MAJOR_HURRICANE_CATEGORY;
}

/**
 * Combines NHC's own classification code (TD/TS/HU/etc., never overridden)
 * with a Saffir-Simpson category. Prefers `officialCategory` when the source
 * already computed one (e.g. a map service's own "Hurricane Category"
 * field); only derives a category from wind speed as a fallback, and only
 * when NHC has classified the system as a hurricane.
 */
export function describeTropicalClassification({ classification, intensityKt, officialCategory } = {}) {
  const code = typeof classification === "string" ? classification.trim().toUpperCase() : "";
  const label = NHC_CLASSIFICATION_LABELS[code] || (code ? code : "Unclassified system");
  const derivedCategory = code === "HU" ? getSaffirSimpsonCategory(intensityKt) : null;
  const category = Number.isInteger(officialCategory) && officialCategory >= 1 && officialCategory <= 5
    ? officialCategory
    : derivedCategory;
  const isMajor = isMajorHurricaneCategory(category);

  const displayName = category
    ? `${isMajor ? "Major " : ""}Hurricane · Category ${category}`
    : label;

  return Object.freeze({ code, label, category, isMajor, displayName });
}
