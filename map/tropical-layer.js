// Layer ids/colors for NHC's official tropical-cyclone geometry, rendered on
// the shared Storm Center map. Colors reuse the app's existing 4-tier
// severity palette (see severityColorExpression() in storm-map.js) instead
// of importing NOAA's own icon set, so Radar/Tropical/Alerts stay visually
// consistent.
const CONE_LAYER = "tropical-cone";
const CONE_OUTLINE_LAYER = "tropical-cone-outline";
const PAST_TRACK_LAYER = "tropical-past-track";
const FORECAST_TRACK_LAYER = "tropical-forecast-track";
const WATCH_WARNING_LAYER = "tropical-watch-warning";
const FORECAST_POINTS_LAYER = "tropical-forecast-points";

// "dvlbl" is NHC's own forecast-point wind-tier field: D(epression) < 39mph,
// S(torm) 39-73mph, H(urricane) 73-110mph, M(ajor hurricane) > 110mph.
const CATEGORY_COLOR_EXPRESSION = [
  "match", ["get", "dvlbl"],
  "M", "#ff7f86",
  "H", "#ffab72",
  "S", "#f3d17b",
  "D", "#9fd9ff",
  "#9fd9ff",
];

// "tcww" is NHC's own watch/warning-type field.
const WATCH_WARNING_COLOR_EXPRESSION = [
  "match", ["get", "tcww"],
  "HWR", "#ff7f86",
  "HWA", "#f3d17b",
  "TWR", "#ffab72",
  "TWA", "#9fd9ff",
  "#9fd9ff",
];

export function addTropicalLayers(map) {
  map.addGeoJSONLayer(CONE_LAYER, {
    type: "fill",
    paint: { "fill-color": "#9fd9ff", "fill-opacity": 0.1 },
  });
  map.addGeoJSONLayer(CONE_OUTLINE_LAYER, {
    type: "line",
    paint: { "line-color": "#9fd9ff", "line-width": 1, "line-opacity": 0.4 },
  });
  map.addGeoJSONLayer(PAST_TRACK_LAYER, {
    type: "line",
    paint: { "line-color": "#c7d6e6", "line-width": 1.6, "line-opacity": 0.55 },
  });
  map.addGeoJSONLayer(FORECAST_TRACK_LAYER, {
    type: "line",
    paint: {
      "line-color": "#ffffff",
      "line-width": 2,
      "line-opacity": 0.85,
      "line-dasharray": [2, 1.4],
    },
  });
  map.addGeoJSONLayer(WATCH_WARNING_LAYER, {
    type: "line",
    paint: { "line-color": WATCH_WARNING_COLOR_EXPRESSION, "line-width": 3.2, "line-opacity": 0.9 },
  });
  map.addGeoJSONLayer(FORECAST_POINTS_LAYER, {
    type: "circle",
    paint: {
      "circle-radius": 5.5,
      "circle-color": CATEGORY_COLOR_EXPRESSION,
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 1.4,
    },
  });
}

export function setTropicalData(map, { cone, forecastTrack, pastTrack, watchWarnings, forecastPoints } = {}) {
  map.setGeoJSONLayerData(CONE_LAYER, cone);
  map.setGeoJSONLayerData(CONE_OUTLINE_LAYER, cone);
  map.setGeoJSONLayerData(PAST_TRACK_LAYER, pastTrack);
  map.setGeoJSONLayerData(FORECAST_TRACK_LAYER, forecastTrack);
  map.setGeoJSONLayerData(WATCH_WARNING_LAYER, watchWarnings);
  map.setGeoJSONLayerData(FORECAST_POINTS_LAYER, forecastPoints);
}

export function removeTropicalLayers(map) {
  [CONE_LAYER, CONE_OUTLINE_LAYER, PAST_TRACK_LAYER, FORECAST_TRACK_LAYER, WATCH_WARNING_LAYER, FORECAST_POINTS_LAYER]
    .forEach((id) => map.removeGeoJSONLayer(id));
}

export function setTropicalLayersVisibility(map, visible) {
  [CONE_LAYER, CONE_OUTLINE_LAYER, PAST_TRACK_LAYER, FORECAST_TRACK_LAYER, WATCH_WARNING_LAYER, FORECAST_POINTS_LAYER]
    .forEach((id) => map.setLayerVisibility(id, visible));
}
