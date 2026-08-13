import { loadMapLibre, waitForMapLoad } from "./maplibre-loader.js";
import { createBasemapStyle } from "./basemap-style.js";
import { EMPTY_COLLECTION } from "./geo-utils.js";

// Category markers are distinguished by SHAPE — drawn once at startup as
// small canvas icons and registered via map.addImage(), rather than an
// emoji pictogram (matches the app's existing restrained line-icon style)
// or relying on an external font-glyph service for the shapes themselves —
// as well as by color, so category is never communicated by color alone.
// Earthquakes and wildfires are the two categories that can realistically
// run into the hundreds — clustered; the rest stay low-volume enough to
// render as plain points.
const CATEGORY_CONFIG = Object.freeze({
  earthquake: { shape: "circle", cluster: true },
  wildfire: { shape: "triangle", cluster: true },
  volcano: { shape: "diamond", cluster: false },
  flood: { shape: "square", cluster: false },
  cyclone: { shape: "hexagon", cluster: false },
});

const SEVERITY_COLORS = Object.freeze({
  critical: "#ff7f86",
  severe: "#ffab72",
  elevated: "#f3d17b",
  advisory: "#9fd9ff",
});

// Best-effort only: used solely for the small numeric label inside cluster
// circles. If this public demo glyph service is ever unavailable, clusters
// still render (radius already communicates relative size) — nothing
// critical depends on it, unlike the category icons above.
const GLYPHS_URL = "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf";

const CLUSTER_COLOR = "#9fd9ff";
const WORLD_CENTER = [10, 20];
const WORLD_ZOOM = 1.5;
const ICON_SIZE = 28;

export async function createLiveEarthMap(container, { onEventSelect } = {}) {
  if (!(container instanceof HTMLElement)) throw new Error("A map container is required.");

  const maplibregl = await loadMapLibre();
  let isReady = false;
  let eventsById = new Map();
  let selectedEventId = "";

  const map = new maplibregl.Map({
    container,
    style: {
      ...createBasemapStyle({ backgroundLayerId: "live-earth-background", basemapLayerId: "live-earth-basemap" }),
      glyphs: GLYPHS_URL,
    },
    center: WORLD_CENTER,
    zoom: WORLD_ZOOM,
    minZoom: 1,
    maxZoom: 12,
    pitchWithRotate: false,
    dragRotate: false,
    attributionControl: true,
    renderWorldCopies: true,
  });

  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");

  await waitForMapLoad(map);
  isReady = true;

  registerCategoryIcons(map);
  Object.entries(CATEGORY_CONFIG).forEach(([category, config]) => addCategoryLayers(map, category, config));

  map.addSource("live-earth-selected", { type: "geojson", data: EMPTY_COLLECTION, generateId: false });
  map.addLayer({
    id: "live-earth-selected",
    type: "circle",
    source: "live-earth-selected",
    paint: {
      "circle-radius": 16,
      "circle-color": "transparent",
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 2.5,
    },
  });

  Object.keys(CATEGORY_CONFIG).forEach((category) => {
    const pointLayer = pointLayerId(category);

    map.on("click", pointLayer, (event) => {
      const eventId = event.features?.[0]?.properties?.eventId;
      if (eventId && typeof onEventSelect === "function") onEventSelect(eventId);
    });
    map.on("mouseenter", pointLayer, () => { map.getCanvas().style.cursor = "pointer"; });
    map.on("mouseleave", pointLayer, () => { map.getCanvas().style.cursor = ""; });

    if (CATEGORY_CONFIG[category].cluster) {
      const clusterLayer = clusterLayerId(category);
      map.on("click", clusterLayer, async (event) => {
        const feature = event.features?.[0];
        const clusterId = feature?.properties?.cluster_id;
        const source = map.getSource(sourceId(category));
        if (clusterId == null || !source) return;

        // Capture coordinates synchronously — MapLibre's event.features is
        // only guaranteed valid during synchronous dispatch and can become
        // undefined by the time an awaited promise resolves.
        const center = feature.geometry.coordinates;
        const zoom = await source.getClusterExpansionZoom(clusterId);
        map.easeTo({ center, zoom });
      });
      map.on("mouseenter", clusterLayer, () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", clusterLayer, () => { map.getCanvas().style.cursor = ""; });
    }
  });

  return Object.freeze({
    setEvents(events) {
      eventsById = new Map((events || []).filter((event) => event.position).map((event) => [event.id, event]));
      if (!isReady) return;

      Object.keys(CATEGORY_CONFIG).forEach((category) => {
        map.getSource(sourceId(category))?.setData(toFeatureCollection(events, category));
      });

      if (selectedEventId && !eventsById.has(selectedEventId)) this.clearSelection();
    },

    selectEvent(eventOrId) {
      if (!isReady) return;
      const eventId = typeof eventOrId === "string" ? eventOrId : eventOrId?.id;
      const event = eventsById.get(eventId);
      if (!event?.position) return;

      selectedEventId = eventId;
      map.getSource("live-earth-selected")?.setData({
        type: "FeatureCollection",
        features: [{
          type: "Feature",
          geometry: { type: "Point", coordinates: [event.position.lon, event.position.lat] },
          properties: {},
        }],
      });

      map.easeTo({
        center: [event.position.lon, event.position.lat],
        zoom: Math.max(map.getZoom(), 4),
        duration: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 650,
      });
    },

    clearSelection() {
      selectedEventId = "";
      if (isReady) map.getSource("live-earth-selected")?.setData(EMPTY_COLLECTION);
    },

    setCategoryVisibility(category, visible) {
      if (!isReady || !CATEGORY_CONFIG[category]) return;
      const visibility = visible ? "visible" : "none";
      map.setLayoutProperty(pointLayerId(category), "visibility", visibility);
      if (CATEGORY_CONFIG[category].cluster) {
        map.setLayoutProperty(clusterLayerId(category), "visibility", visibility);
        map.setLayoutProperty(clusterCountLayerId(category), "visibility", visibility);
      }
    },

    resize() {
      if (isReady) window.requestAnimationFrame(() => map.resize());
    },

    resetView() {
      map.easeTo({
        center: WORLD_CENTER,
        zoom: WORLD_ZOOM,
        duration: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 450,
      });
    },

    destroy() {
      map.remove();
      isReady = false;
    },
  });
}

function registerCategoryIcons(map) {
  Object.entries(CATEGORY_CONFIG).forEach(([category, { shape }]) => {
    Object.entries(SEVERITY_COLORS).forEach(([tier, color]) => {
      const id = iconId(category, tier);
      if (map.hasImage(id)) return;
      map.addImage(id, drawIcon(shape, color));
    });
  });
}

function drawIcon(shape, color) {
  const canvas = document.createElement("canvas");
  canvas.width = ICON_SIZE;
  canvas.height = ICON_SIZE;
  const ctx = canvas.getContext("2d");
  const center = ICON_SIZE / 2;
  const radius = 8.5;

  ctx.lineJoin = "round";
  ctx.lineWidth = 2.4;
  ctx.strokeStyle = color;
  ctx.fillStyle = "rgba(9, 18, 32, 0.78)";

  ctx.beginPath();
  tracePath(ctx, shape, center, center, radius);
  ctx.fill();
  ctx.stroke();

  return ctx.getImageData(0, 0, ICON_SIZE, ICON_SIZE);
}

function tracePath(ctx, shape, cx, cy, r) {
  if (shape === "circle") {
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    return;
  }
  if (shape === "triangle") {
    ctx.moveTo(cx, cy - r);
    ctx.lineTo(cx + r * 0.95, cy + r * 0.78);
    ctx.lineTo(cx - r * 0.95, cy + r * 0.78);
    ctx.closePath();
    return;
  }
  if (shape === "diamond") {
    ctx.moveTo(cx, cy - r);
    ctx.lineTo(cx + r, cy);
    ctx.lineTo(cx, cy + r);
    ctx.lineTo(cx - r, cy);
    ctx.closePath();
    return;
  }
  if (shape === "square") {
    const half = r * 0.8;
    ctx.rect(cx - half, cy - half, half * 2, half * 2);
    return;
  }
  if (shape === "hexagon") {
    for (let i = 0; i < 6; i += 1) {
      const angle = (Math.PI / 3) * i - Math.PI / 2;
      const x = cx + r * Math.cos(angle);
      const y = cy + r * Math.sin(angle);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }
}

function addCategoryLayers(map, category, { cluster }) {
  map.addSource(sourceId(category), {
    type: "geojson",
    data: EMPTY_COLLECTION,
    generateId: false,
    ...(cluster ? { cluster: true, clusterMaxZoom: 6, clusterRadius: 45 } : {}),
  });

  if (cluster) {
    map.addLayer({
      id: clusterLayerId(category),
      type: "circle",
      source: sourceId(category),
      filter: ["has", "point_count"],
      paint: {
        "circle-color": CLUSTER_COLOR,
        "circle-opacity": 0.28,
        "circle-stroke-color": CLUSTER_COLOR,
        "circle-stroke-width": 1.4,
        "circle-radius": ["step", ["get", "point_count"], 14, 10, 18, 50, 24],
      },
    });
    map.addLayer({
      id: clusterCountLayerId(category),
      type: "symbol",
      source: sourceId(category),
      filter: ["has", "point_count"],
      layout: {
        "text-field": ["get", "point_count_abbreviated"],
        "text-size": 11,
        "text-font": ["Noto Sans Regular"],
      },
      paint: { "text-color": "#f7fbff" },
    });
  }

  map.addLayer({
    id: pointLayerId(category),
    type: "symbol",
    source: sourceId(category),
    ...(cluster ? { filter: ["!", ["has", "point_count"]] } : {}),
    layout: {
      "icon-image": ["concat", `${category}-`, ["get", "displayPriority"]],
      "icon-size": 1,
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
    },
  });
}

function toFeatureCollection(events, category) {
  return {
    type: "FeatureCollection",
    features: (events || [])
      .filter((event) => event.category === category && event.position)
      .map((event) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [event.position.lon, event.position.lat] },
        properties: { eventId: event.id, displayPriority: event.severity.displayPriority },
      })),
  };
}

function iconId(category, severityTier) {
  return `${category}-${severityTier}`;
}

function sourceId(category) {
  return `live-earth-${category}`;
}

function pointLayerId(category) {
  return `live-earth-${category}-point`;
}

function clusterLayerId(category) {
  return `live-earth-${category}-cluster`;
}

function clusterCountLayerId(category) {
  return `live-earth-${category}-cluster-count`;
}
