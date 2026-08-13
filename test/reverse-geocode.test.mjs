import test from "node:test";
import assert from "node:assert/strict";
import { reverseGeocodeCoordinates } from "../services/reverse-geocode.js";

test("reverseGeocodeCoordinates prefers city, falls back through locality fields", async () => {
  const fetchImpl = async () => ({
    ok: true,
    json: async () => ({
      features: [
        {
          properties: {
            name: "Hammond Drive",
            city: "Myrtle Beach",
            state: "South Carolina",
            county: "Horry",
            country: "United States",
            countrycode: "US",
          },
        },
      ],
    }),
  });

  const location = await reverseGeocodeCoordinates(33.6891, -78.8951, { fetchImpl });
  assert.equal(location.name, "Myrtle Beach");
  assert.equal(location.admin1, "South Carolina");
  assert.equal(location.admin2, "Horry");
  assert.equal(location.country, "United States");
  assert.equal(location.country_code, "US");
  assert.equal(location.latitude, 33.6891);
  assert.equal(location.longitude, -78.8951);
  assert.equal(location.timezone, "auto");
});

test("reverseGeocodeCoordinates falls back to the feature name when no locality field exists", async () => {
  const fetchImpl = async () => ({
    ok: true,
    json: async () => ({ features: [{ properties: { name: "Some Landmark", country: "France" } }] }),
  });

  const location = await reverseGeocodeCoordinates(48.8566, 2.3522, { fetchImpl });
  assert.equal(location.name, "Some Landmark");
  assert.equal(location.country, "France");
});

test("reverseGeocodeCoordinates falls back to a generic name when the lookup returns nothing", async () => {
  const fetchImpl = async () => ({ ok: true, json: async () => ({ features: [] }) });
  const location = await reverseGeocodeCoordinates(0, 0, { fetchImpl });
  assert.equal(location.name, "Current Location");
  assert.equal(location.latitude, 0);
  assert.equal(location.longitude, 0);
});

test("reverseGeocodeCoordinates degrades gracefully on network failure, never throws", async () => {
  const fetchImpl = async () => { throw new Error("network down"); };
  const location = await reverseGeocodeCoordinates(10, 20, { fetchImpl });
  assert.equal(location.name, "Current Location");
  assert.equal(location.latitude, 10);
  assert.equal(location.longitude, 20);
});

test("reverseGeocodeCoordinates degrades gracefully on a non-OK response", async () => {
  const fetchImpl = async () => ({ ok: false, json: async () => null });
  const location = await reverseGeocodeCoordinates(10, 20, { fetchImpl });
  assert.equal(location.name, "Current Location");
});

test("reverseGeocodeCoordinates rejects invalid coordinates", async () => {
  await assert.rejects(reverseGeocodeCoordinates(NaN, 20, { fetchImpl: async () => ({}) }));
});
