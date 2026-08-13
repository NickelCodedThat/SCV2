// Shared OSM raster basemap treatment (dark, desaturated) used by every
// MapLibre instance in Storm Chaser, so Storm Center's US map and LIVE
// EARTH's global map share identical map visual language.
export function createBasemapStyle({ backgroundLayerId = "map-background", basemapLayerId = "map-basemap" } = {}) {
  return {
    version: 8,
    sources: {
      osm: {
        type: "raster",
        tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
        tileSize: 256,
        maxzoom: 18,
        attribution: "© OpenStreetMap contributors",
      },
    },
    layers: [
      { id: backgroundLayerId, type: "background", paint: { "background-color": "#101c2a" } },
      {
        id: basemapLayerId,
        type: "raster",
        source: "osm",
        paint: {
          "raster-opacity": 0.66,
          "raster-saturation": -0.82,
          "raster-contrast": 0.16,
          "raster-brightness-min": 0.08,
          "raster-brightness-max": 0.5,
        },
      },
    ],
  };
}
