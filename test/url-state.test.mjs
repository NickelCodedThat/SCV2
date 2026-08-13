import { test } from "node:test";
import assert from "node:assert/strict";
import { readParam, withParam, withParams } from "../utils/url-state.js";

test("readParam — reads a value that exists", () => {
  assert.equal(readParam("?event=usgs%3Aabc123", "event"), "usgs:abc123");
});

test("readParam — returns null when the param is absent", () => {
  assert.equal(readParam("?category=flood", "event"), null);
  assert.equal(readParam("", "event"), null);
});

test("withParam — adds a param to an empty query string", () => {
  assert.equal(withParam("", "event", "usgs:abc123"), "event=usgs%3Aabc123");
});

test("withParam — updates a param without disturbing other existing params", () => {
  const result = withParam("?category=flood&event=old", "event", "new");
  assert.equal(readParam(`?${result}`, "category"), "flood");
  assert.equal(readParam(`?${result}`, "event"), "new");
});

test("withParam — a falsy value removes the param entirely", () => {
  assert.equal(withParam("?event=abc&category=flood", "event", null), "category=flood");
  assert.equal(withParam("?event=abc", "event", ""), "");
});

test("withParams — sets and clears multiple params in one pass", () => {
  const result = withParams("?event=old&category=flood", { event: "new", category: null });
  assert.equal(readParam(`?${result}`, "event"), "new");
  assert.equal(readParam(`?${result}`, "category"), null);
});

test("withParams — leaves untouched params alone", () => {
  const result = withParams("?event=abc&sort=recent", { category: "wildfire" });
  assert.equal(readParam(`?${result}`, "event"), "abc");
  assert.equal(readParam(`?${result}`, "sort"), "recent");
  assert.equal(readParam(`?${result}`, "category"), "wildfire");
});

test("round trip — a value with special characters survives encode/decode", () => {
  const id = "gdacs:1104081 & extra";
  const result = withParam("", "event", id);
  assert.equal(readParam(`?${result}`, "event"), id);
});
