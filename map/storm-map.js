const MAPLIBRE_VERSION = "5.24.0";
const MAPLIBRE_SCRIPT = `https://unpkg.com/maplibre-gl@${MAPLIBRE_VERSION}/dist/maplibre-gl.js`;
const MAPLIBRE_STYLES = `https://unpkg.com/maplibre-gl@${MAPLIBRE_VERSION}/dist/maplibre-gl.css`;
const EMPTY_COLLECTION = Object.freeze({ type: "FeatureCollection", features: [] });

let mapLibraryPromise;

export async function createStormMap(container, { onAlertSelect } = {}) {
  if (!(container instanceof HTMLElement)) throw new Error("A map container is required.");

  const maplibregl = await loadMapLibre();
  let alerts = [];
  let selectedAlertId = "";
  let isReady = false;

  const map = new maplibregl.Map({
    container,
    style: {
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
        { id: "storm-map-background", type: "background", paint: { "background-color": "#101c2a" } },
        {
          id: "storm-map-basemap",
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
    },
    center: [-98.5, 38.6],
    zoom: 3.15,
    minZoom: 2,
    maxZoom: 12,
    pitchWithRotate: false,
    dragRotate: false,
    attributionControl: true,
  });

  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");

  await waitForMapLoad(map);
  isReady = true;

  map.addSource("nws-alerts", {
    type: "geojson",
    data: EMPTY_COLLECTION,
    generateId: false,
  });

  map.addLayer({
    id: "nws-alert-fills",
    type: "fill",
    source: "nws-alerts",
    filter: ["==", ["geometry-type"], "Polygon"],
    paint: {
      "fill-color": severityColorExpression(),
      "fill-opacity": 0.36,
    },
  });

  map.addLayer({
    id: "nws-alert-outlines",
    type: "line",
    source: "nws-alerts",
    filter: ["==", ["geometry-type"], "Polygon"],
    paint: {
      "line-color": severityColorExpression(),
      "line-width": 1.4,
      "line-opacity": 0.86,
    },
  });

  map.addLayer({
    id: "nws-alert-selected",
    type: "line",
    source: "nws-alerts",
    filter: ["==", ["get", "alertId"], ""],
    paint: {
      "line-color": "#ffffff",
      "line-width": 3,
      "line-opacity": 0.95,
    },
  });

  map.on("click", "nws-alert-fills", (event) => {
    const alertId = event.features?.[0]?.properties?.alertId;
    if (alertId && typeof onAlertSelect === "function") onAlertSelect(alertId);
  });

  map.on("mouseenter", "nws-alert-fills", () => {
    map.getCanvas().style.cursor = "pointer";
  });

  map.on("mouseleave", "nws-alert-fills", () => {
    map.getCanvas().style.cursor = "";
  });

  const rasterLayerIds = new Set();
  const geoJSONLayerIds = new Set();

  return Object.freeze({
    // Generic hooks so future map layers (radar today; satellite, lightning,
    // wind, etc. later) can hang off this same map instance without a
    // second MapLibre instance or bespoke wiring per layer.
    addRasterLayer(id, { tileUrl, attribution, opacity = 1, beforeId = "nws-alert-fills" } = {}) {
      if (!isReady || map.getSource(id)) return;

      map.addSource(id, {
        type: "raster",
        tiles: [tileUrl],
        tileSize: 256,
        attribution,
      });
      map.addLayer(
        { id, type: "raster", source: id, paint: { "raster-opacity": opacity } },
        map.getLayer(beforeId) ? beforeId : undefined,
      );
      rasterLayerIds.add(id);
    },

    setRasterLayerTiles(id, tileUrl) {
      if (!isReady) return;
      const source = map.getSource(id);
      if (source) source.setTiles([tileUrl]);
    },

    setRasterLayerOpacity(id, opacity) {
      if (isReady && map.getLayer(id)) map.setPaintProperty(id, "raster-opacity", opacity);
    },

    removeRasterLayer(id) {
      if (!isReady) return;
      if (map.getLayer(id)) map.removeLayer(id);
      if (map.getSource(id)) map.removeSource(id);
      rasterLayerIds.delete(id);
    },

    addGeoJSONLayer(id, { data, type, paint, filter, layout } = {}) {
      if (!isReady || map.getSource(id)) return;

      map.addSource(id, { type: "geojson", data: data || EMPTY_COLLECTION, generateId: false });
      map.addLayer({ id, type, source: id, paint, ...(filter ? { filter } : {}), ...(layout ? { layout } : {}) });
      geoJSONLayerIds.add(id);
    },

    setGeoJSONLayerData(id, data) {
      if (isReady) map.getSource(id)?.setData(data || EMPTY_COLLECTION);
    },

    setLayerVisibility(id, visible) {
      if (isReady && map.getLayer(id)) {
        map.setLayoutProperty(id, "visibility", visible ? "visible" : "none");
      }
    },

    removeGeoJSONLayer(id) {
      if (!isReady) return;
      if (map.getLayer(id)) map.removeLayer(id);
      if (map.getSource(id)) map.removeSource(id);
      geoJSONLayerIds.delete(id);
    },

    setAlerts(nextAlerts) {
      alerts = Array.isArray(nextAlerts) ? nextAlerts.filter((alert) => alert.hasGeometry) : [];
      if (!isReady) return;
      map.getSource("nws-alerts")?.setData(toFeatureCollection(alerts));

      if (selectedAlertId && !alerts.some((alert) => alert.id === selectedAlertId)) {
        selectedAlertId = "";
        map.setFilter("nws-alert-selected", ["==", ["get", "alertId"], ""]);
      }
    },

    selectAlert(alert) {
      if (!isReady || !alert?.id) return;
      selectedAlertId = alert.id;
      map.setFilter("nws-alert-selected", ["==", ["get", "alertId"], alert.id]);

      if (alert.geometry) {
        const bounds = geometryBounds(alert.geometry);
        if (bounds) {
          map.fitBounds(bounds, {
            padding: { top: 70, right: 70, bottom: 70, left: 70 },
            maxZoom: 7,
            duration: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 650,
          });
        }
      }
    },

    clearSelection() {
      selectedAlertId = "";
      if (isReady) map.setFilter("nws-alert-selected", ["==", ["get", "alertId"], ""]);
    },

    setAlertLayerVisibility(visible) {
      if (!isReady) return;
      ["nws-alert-fills", "nws-alert-outlines", "nws-alert-selected"].forEach((id) => {
        map.setLayoutProperty(id, "visibility", visible ? "visible" : "none");
      });
    },

    fitFeatureBounds(geometry, options = {}) {
      if (!isReady || !geometry) return;
      const bounds = geometryBounds(geometry);
      if (!bounds) return;
      map.fitBounds(bounds, {
        padding: { top: 70, right: 70, bottom: 70, left: 70 },
        maxZoom: 7,
        duration: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 650,
        ...options,
      });
    },

    resize() {
      if (isReady) window.requestAnimationFrame(() => map.resize());
    },

    resetView() {
      map.easeTo({
        center: [-98.5, 38.6],
        zoom: 3.15,
        duration: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 450,
      });
    },

    destroy() {
      map.remove();
      isReady = false;
    },
  });
}

function loadMapLibre() {
  if (window.maplibregl) return Promise.resolve(window.maplibregl);
  if (mapLibraryPromise) return mapLibraryPromise;

  mapLibraryPromise = new Promise((resolve, reject) => {
    if (!document.querySelector(`link[href="${MAPLIBRE_STYLES}"]`)) {
      const stylesheet = document.createElement("link");
      stylesheet.rel = "stylesheet";
      stylesheet.href = MAPLIBRE_STYLES;
      document.head.append(stylesheet);
    }

    const existingScript = document.querySelector(`script[src="${MAPLIBRE_SCRIPT}"]`);
    if (existingScript) {
      existingScript.addEventListener("load", () => resolve(window.maplibregl), { once: true });
      existingScript.addEventListener("error", () => reject(new Error("MapLibre could not be loaded.")), { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = MAPLIBRE_SCRIPT;
    script.onload = () => resolve(window.maplibregl);
    script.onerror = () => reject(new Error("MapLibre could not be loaded."));
    document.head.append(script);
  });

  return mapLibraryPromise;
}

function waitForMapLoad(map) {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error("The map took too long to load.")), 15000);

    map.once("load", () => {
      window.clearTimeout(timeout);
      resolve();
    });

    map.once("error", (event) => {
      if (!map.loaded()) {
        window.clearTimeout(timeout);
        reject(new Error(event.error?.message || "The map could not be initialized."));
      }
    });
  });
}

function toFeatureCollection(alerts) {
  return {
    type: "FeatureCollection",
    features: alerts.map((alert) => ({
      type: "Feature",
      id: alert.id,
      geometry: alert.geometry,
      properties: {
        alertId: alert.id,
        event: alert.event,
        level: alert.level,
      },
    })),
  };
}

function severityColorExpression() {
  return [
    "match",
    ["get", "level"],
    "critical", "#ff7f86",
    "severe", "#ffab72",
    "elevated", "#f3d17b",
    "#9fd9ff",
  ];
}

function geometryBounds(geometry) {
  const points = [];
  collectCoordinates(geometry.coordinates, points);
  if (points.length === 0) return null;

  let west = points[0][0];
  let east = points[0][0];
  let south = points[0][1];
  let north = points[0][1];

  points.forEach(([longitude, latitude]) => {
    west = Math.min(west, longitude);
    east = Math.max(east, longitude);
    south = Math.min(south, latitude);
    north = Math.max(north, latitude);
  });

  return [[west, south], [east, north]];
}

function collectCoordinates(coordinates, points) {
  if (!Array.isArray(coordinates)) return;

  if (
    coordinates.length >= 2 &&
    typeof coordinates[0] === "number" &&
    typeof coordinates[1] === "number" &&
    Number.isFinite(coordinates[0]) &&
    Number.isFinite(coordinates[1])
  ) {
    points.push(coordinates);
    return;
  }

  coordinates.forEach((coordinate) => collectCoordinates(coordinate, points));
}
