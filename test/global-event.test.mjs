import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createGlobalEvent,
  displayPriorityFromUsgs,
  displayPriorityFromGdacs,
  DISPLAY_PRIORITY,
} from "../models/global-event.js";

test("createGlobalEvent — builds a stable id from provider + providerEventId", () => {
  const event = createGlobalEvent({
    provider: "usgs",
    providerEventId: "ci40671666",
    category: "earthquake",
    title: "M 2.5 - test",
    sourceName: "USGS",
  });
  assert.equal(event.id, "usgs:ci40671666");
});

test("createGlobalEvent — rejects a non-finite position instead of storing garbage", () => {
  const event = createGlobalEvent({
    provider: "usgs",
    providerEventId: "1",
    category: "earthquake",
    title: "Test",
    position: { lat: NaN, lon: -100 },
    sourceName: "USGS",
  });
  assert.equal(event.position, null);
});

test("createGlobalEvent — keeps a valid position", () => {
  const event = createGlobalEvent({
    provider: "usgs",
    providerEventId: "1",
    category: "earthquake",
    title: "Test",
    position: { lat: 32.9, lon: -116.2 },
    sourceName: "USGS",
  });
  assert.deepEqual(event.position, { lat: 32.9, lon: -116.2 });
});

test("createGlobalEvent — rejects invalid Date objects for time fields", () => {
  const event = createGlobalEvent({
    provider: "usgs",
    providerEventId: "1",
    category: "earthquake",
    title: "Test",
    eventAt: new Date("not a date"),
    sourceName: "USGS",
  });
  assert.equal(event.time.eventAt, null);
  assert.ok(event.time.fetchedAt instanceof Date);
});

test("createGlobalEvent — never mutates provider severity when computing displayPriority", () => {
  const event = createGlobalEvent({
    provider: "gdacs",
    providerEventId: "1",
    category: "flood",
    title: "Test",
    providerLevel: "Orange",
    providerLabel: "GDACS alert level: Orange",
    displayPriority: DISPLAY_PRIORITY.SIGNIFICANT,
    sourceName: "GDACS",
  });
  assert.equal(event.severity.providerLevel, "Orange", "raw provider severity is preserved verbatim");
  assert.equal(event.severity.displayPriority, "severe");
});

test("displayPriorityFromUsgs — PAGER alert level takes precedence over significance", () => {
  assert.equal(displayPriorityFromUsgs({ alert: "red", sig: 10 }), DISPLAY_PRIORITY.CRITICAL);
  assert.equal(displayPriorityFromUsgs({ alert: "orange", sig: 10 }), DISPLAY_PRIORITY.CRITICAL);
  assert.equal(displayPriorityFromUsgs({ alert: "yellow", sig: 10 }), DISPLAY_PRIORITY.SIGNIFICANT);
  assert.equal(displayPriorityFromUsgs({ alert: "green", sig: 999 }), DISPLAY_PRIORITY.MONITORING);
});

test("displayPriorityFromUsgs — falls back to significance thresholds when no PAGER alert exists", () => {
  assert.equal(displayPriorityFromUsgs({ alert: null, sig: 700 }), DISPLAY_PRIORITY.CRITICAL);
  assert.equal(displayPriorityFromUsgs({ alert: null, sig: 500 }), DISPLAY_PRIORITY.SIGNIFICANT);
  assert.equal(displayPriorityFromUsgs({ alert: null, sig: 200 }), DISPLAY_PRIORITY.MONITORING);
  assert.equal(displayPriorityFromUsgs({ alert: null, sig: 50 }), DISPLAY_PRIORITY.INFORMATIONAL);
  assert.equal(displayPriorityFromUsgs({ alert: null, sig: null }), DISPLAY_PRIORITY.INFORMATIONAL);
});

test("displayPriorityFromGdacs — maps GDACS's own 3-level scale, defaults to informational", () => {
  assert.equal(displayPriorityFromGdacs("Red"), DISPLAY_PRIORITY.CRITICAL);
  assert.equal(displayPriorityFromGdacs("Orange"), DISPLAY_PRIORITY.SIGNIFICANT);
  assert.equal(displayPriorityFromGdacs("Green"), DISPLAY_PRIORITY.MONITORING);
  assert.equal(displayPriorityFromGdacs(""), DISPLAY_PRIORITY.INFORMATIONAL);
  assert.equal(displayPriorityFromGdacs(undefined), DISPLAY_PRIORITY.INFORMATIONAL);
});
