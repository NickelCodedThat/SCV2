// Shared MapLibre GL JS CDN loader, used by every map instance in Storm
// Chaser (Storm Center's US map, Live Earth's global map, ...) so the
// library is only ever injected into the page once.
const MAPLIBRE_VERSION = "5.24.0";
const MAPLIBRE_SCRIPT = `https://unpkg.com/maplibre-gl@${MAPLIBRE_VERSION}/dist/maplibre-gl.js`;
const MAPLIBRE_STYLES = `https://unpkg.com/maplibre-gl@${MAPLIBRE_VERSION}/dist/maplibre-gl.css`;

let mapLibraryPromise;

export function loadMapLibre() {
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

export function waitForMapLoad(map) {
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
