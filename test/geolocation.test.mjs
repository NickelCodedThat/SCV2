import test from "node:test";
import assert from "node:assert/strict";
import { getCurrentCoordinates, mapGeolocationError } from "../services/geolocation.js";

function fakeGeolocation({ succeedWith, failWith }) {
  return {
    getCurrentPosition(onSuccess, onError) {
      if (succeedWith) onSuccess(succeedWith);
      else onError(failWith);
    },
  };
}

test("getCurrentCoordinates resolves latitude/longitude on success", async () => {
  const geolocationImpl = fakeGeolocation({
    succeedWith: { coords: { latitude: 33.6891, longitude: -78.8951 } },
  });
  const result = await getCurrentCoordinates({ geolocationImpl });
  assert.deepEqual(result, { latitude: 33.6891, longitude: -78.8951 });
});

test("getCurrentCoordinates rejects with reason 'permission-denied' on code 1", async () => {
  const geolocationImpl = fakeGeolocation({ failWith: { code: 1 } });
  await assert.rejects(getCurrentCoordinates({ geolocationImpl }), (error) => error.reason === "permission-denied");
});

test("getCurrentCoordinates rejects with reason 'position-unavailable' on code 2", async () => {
  const geolocationImpl = fakeGeolocation({ failWith: { code: 2 } });
  await assert.rejects(getCurrentCoordinates({ geolocationImpl }), (error) => error.reason === "position-unavailable");
});

test("getCurrentCoordinates rejects with reason 'timeout' on code 3", async () => {
  const geolocationImpl = fakeGeolocation({ failWith: { code: 3 } });
  await assert.rejects(getCurrentCoordinates({ geolocationImpl }), (error) => error.reason === "timeout");
});

test("getCurrentCoordinates rejects with reason 'unsupported' when geolocation is missing", async () => {
  await assert.rejects(
    getCurrentCoordinates({ geolocationImpl: null }),
    (error) => error.reason === "unsupported",
  );
});

test("mapGeolocationError falls back to 'unknown' for an unrecognized code", () => {
  assert.equal(mapGeolocationError({ code: 99 }).reason, "unknown");
  assert.equal(mapGeolocationError(undefined).reason, "unknown");
});
