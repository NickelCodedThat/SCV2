import test from "node:test";
import assert from "node:assert/strict";
import handler from "../api/weather.js";

function createResponse() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

async function withEnvironment(values, callback) {
  const previous = {
    WEATHER_API_KEY: process.env.WEATHER_API_KEY,
    WEATHERAPI_KEY: process.env.WEATHERAPI_KEY,
  };

  for (const name of Object.keys(previous)) delete process.env[name];
  Object.assign(process.env, values);

  try {
    await callback();
  } finally {
    for (const name of Object.keys(previous)) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
  }
}

test("weather proxy rejects non-GET methods", async () => {
  const res = createResponse();
  await handler({ method: "POST", query: {} }, res);
  assert.equal(res.statusCode, 405);
  assert.equal(res.body.error.message, "Method not allowed.");
});

test("weather proxy reports the canonical missing environment variable", async () => {
  await withEnvironment({}, async () => {
    const res = createResponse();
    await handler({ method: "GET", query: { q: "New York" } }, res);
    assert.equal(res.statusCode, 500);
    assert.match(res.body.error.message, /WEATHER_API_KEY/);
  });
});

test("weather proxy uses WEATHER_API_KEY and forwards a normalized request", async () => {
  await withEnvironment({ WEATHER_API_KEY: "server-secret" }, async () => {
    const originalFetch = globalThis.fetch;
    let requestedUrl = "";
    globalThis.fetch = async (url) => {
      requestedUrl = String(url);
      return { status: 200, json: async () => ({ location: { name: "New York" } }) };
    };

    try {
      const res = createResponse();
      await handler({
        method: "GET",
        query: { q: "  New York  ", days: "3", aqi: "no", alerts: "no", key: "client-secret" },
      }, res);

      const url = new URL(requestedUrl);
      assert.equal(res.statusCode, 200);
      assert.equal(res.body.location.name, "New York");
      assert.equal(url.searchParams.get("key"), "server-secret");
      assert.equal(url.searchParams.get("q"), "New York");
      assert.equal(url.searchParams.get("days"), "3");
      assert.equal(url.searchParams.has("client-secret"), false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("weather proxy preserves the previous WEATHERAPI_KEY spelling as a fallback", async () => {
  await withEnvironment({ WEATHERAPI_KEY: "legacy-secret" }, async () => {
    const originalFetch = globalThis.fetch;
    let requestedUrl = "";
    globalThis.fetch = async (url) => {
      requestedUrl = String(url);
      return { status: 200, json: async () => ({ ok: true }) };
    };

    try {
      const res = createResponse();
      await handler({ method: "GET", query: { q: "Memphis" } }, res);
      assert.equal(new URL(requestedUrl).searchParams.get("key"), "legacy-secret");
      assert.equal(res.statusCode, 200);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("weather proxy validates missing and oversized location queries", async () => {
  await withEnvironment({ WEATHER_API_KEY: "server-secret" }, async () => {
    const missing = createResponse();
    await handler({ method: "GET", query: {} }, missing);
    assert.equal(missing.statusCode, 400);

    const oversized = createResponse();
    await handler({ method: "GET", query: { q: "x".repeat(201) } }, oversized);
    assert.equal(oversized.statusCode, 400);
    assert.match(oversized.body.error.message, /too long/i);
  });
});

test("weather proxy passes WeatherAPI errors through without exposing server internals", async () => {
  await withEnvironment({ WEATHER_API_KEY: "server-secret" }, async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      status: 400,
      json: async () => ({ error: { message: "No matching location found." } }),
    });

    try {
      const res = createResponse();
      await handler({ method: "GET", query: { q: "not-a-real-place" } }, res);
      assert.equal(res.statusCode, 400);
      assert.equal(res.body.error.message, "No matching location found.");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("weather proxy returns a stable 502 when WeatherAPI is unreachable", async () => {
  await withEnvironment({ WEATHER_API_KEY: "server-secret" }, async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => { throw new Error("network detail must not leak"); };

    try {
      const res = createResponse();
      await handler({ method: "GET", query: { q: "Jacksonville" } }, res);
      assert.equal(res.statusCode, 502);
      assert.equal(res.body.error.message, "Weather information is unavailable right now.");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
