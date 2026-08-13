import { createGlobalEvent, EVENT_CATEGORY } from "../models/global-event.js";
import { classificationToSeverityTier } from "../utils/hurricane-scale.js";
import { fetchEarthquakes } from "./usgs-earthquakes.js";
import { fetchEonetEvents } from "./eonet-events.js";
import { fetchFloods } from "./gdacs-floods.js";
import { fetchActiveStorms } from "./nhc-storms.js";

/**
 * Orchestrates every LIVE EARTH provider in parallel. Each provider is
 * independently isolated via Promise.allSettled — one failing (network
 * error, malformed response, timeout) never blocks or delays the others.
 * Stateless: this module does not cache or remember previous results across
 * calls — that "keep showing stale data with a clear label" decision
 * belongs to the UI layer (live-earth.js), which already owns similar
 * persist-across-failed-refresh state for Storm Center.
 */
export async function fetchLiveEarthEvents({ signal } = {}) {
  const [usgs, eonet, gdacs, tropical] = await Promise.allSettled([
    fetchEarthquakes({ signal }),
    fetchEonetEvents({ signal }),
    fetchFloods({ signal }),
    fetchTropicalCyclones({ signal }),
  ]);

  const providers = {
    usgs: toProviderResult(usgs, "USGS"),
    eonet: toProviderResult(eonet, "NASA EONET"),
    gdacs: toProviderResult(gdacs, "GDACS"),
    tropical: toProviderResult(tropical, "NHC/CPHC"),
  };

  const events = Object.values(providers).flatMap((provider) => provider.events);

  return { events, providers, fetchedAt: new Date() };
}

function toProviderResult(settled, label) {
  if (settled.status === "fulfilled") {
    return {
      label,
      status: "ok",
      events: settled.value.events,
      lastSuccessAt: settled.value.fetchedAt,
      error: null,
    };
  }

  const error = settled.reason;
  return {
    label,
    status: error?.name === "AbortError" ? "aborted" : "unavailable",
    events: [],
    lastSuccessAt: null,
    error: error?.message || "Unknown error",
  };
}

async function fetchTropicalCyclones({ signal }) {
  const result = await fetchActiveStorms({ signal });
  return { events: result.storms.map(stormToGlobalEvent), fetchedAt: result.updatedAt };
}

// Reuses Phase 3's normalized TropicalSystem shape (services/nhc-storms.js)
// directly rather than re-deriving anything from a raw provider response —
// this is presentation-layer reshaping, not a second normalization of NHC
// data. Forecast track/cone geometry is intentionally not duplicated here
// (Storm Center's Tropical tab already owns that detail); LIVE EARTH shows
// current position, classification, and advisory summary only.
function stormToGlobalEvent(storm) {
  return createGlobalEvent({
    provider: "nhc",
    providerEventId: storm.id,
    category: EVENT_CATEGORY.CYCLONE,
    title: storm.name,
    status: "active",
    position: storm.position,
    place: storm.positionLabel,
    eventAt: storm.lastUpdate,
    updatedAt: storm.lastUpdate,
    providerLevel: storm.classification || null,
    providerLabel: storm.classificationInfo.displayName,
    displayPriority: classificationToSeverityTier(storm.classificationInfo),
    details: {
      classification: storm.classification,
      classificationLabel: storm.classificationInfo.label,
      category: storm.classificationInfo.category,
      maxWindMph: storm.maxWindMph,
      maxWindKt: storm.maxWindKt,
      pressureMb: storm.pressureMb,
      movement: storm.movement,
      basin: storm.basin,
      advisoryNumber: storm.advisory?.number || null,
      advisoryIssued: storm.advisory?.issuedAtLabel || null,
    },
    sourceName: storm.authority,
    sourceUrl: storm.links?.publicAdvisory || storm.sourceUrl || null,
  });
}
