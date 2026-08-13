// Small DOM helpers shared across Storm Center and LIVE EARTH's controllers.
export function createElement(tagName, className = "", text = "") {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  if (text !== "") element.textContent = text;
  return element;
}

export function createSvgUse(reference) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("aria-hidden", "true");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", reference);
  svg.append(use);
  return svg;
}

const liveRegion = document.querySelector("#liveRegion");

// Clears then re-sets the shared sr-only live region so repeated identical
// announcements (e.g. two refreshes producing the same event count) are
// still read aloud by screen readers.
export function announce(message) {
  if (!liveRegion) return;
  liveRegion.textContent = "";
  window.setTimeout(() => {
    liveRegion.textContent = message;
  }, 50);
}
