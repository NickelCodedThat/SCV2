import { buildRadarTileUrl, RADAR_ATTRIBUTION } from "../services/nws-radar.js";

const LAYER_ID = "storm-radar";
const DEFAULT_OPACITY = 0.75;

export function addRadarLayer(map, isoTime) {
  map.addRasterLayer(LAYER_ID, {
    tileUrl: buildRadarTileUrl(isoTime),
    attribution: RADAR_ATTRIBUTION,
    opacity: DEFAULT_OPACITY,
  });
}

export function setRadarFrame(map, isoTime) {
  map.setRasterLayerTiles(LAYER_ID, buildRadarTileUrl(isoTime));
}

export function setRadarOpacity(map, opacity) {
  map.setRasterLayerOpacity(LAYER_ID, opacity);
}

export function removeRadarLayer(map) {
  map.removeRasterLayer(LAYER_ID);
}
