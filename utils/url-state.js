// Small, generic, pure query-string helpers used to make LIVE EARTH state
// (selected event, active category) shareable. Pure string-in/string-out so
// they're testable without a DOM; the one browser-touching wrapper
// (replaceLiveEarthUrl) lives at the bottom.
//
// Deliberately reuses the existing hash-based view routing
// (storm-center.js) unchanged — the hash still picks the view, this only
// ever touches location.search — and always replaces (never pushes)
// history, since selecting an event or changing a filter should not fill
// the back-button stack.

export function readParam(search, name) {
  return new URLSearchParams(search).get(name);
}

/**
 * Returns a new query string with `name` set to `value`, or removed
 * entirely when `value` is falsy. Preserves any other existing params.
 */
export function withParam(search, name, value) {
  const params = new URLSearchParams(search);
  if (value) params.set(name, value); else params.delete(name);
  return params.toString();
}

/**
 * Same as withParam, but for setting/clearing several params at once —
 * avoids clobbering one param's change with a stale read of another when
 * both are updated in the same call.
 */
export function withParams(search, entries) {
  const params = new URLSearchParams(search);
  Object.entries(entries).forEach(([name, value]) => {
    if (value) params.set(name, value); else params.delete(name);
  });
  return params.toString();
}

export function replaceLiveEarthUrl(entries) {
  const query = withParams(window.location.search, entries);
  const url = `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`;
  window.history.replaceState(window.history.state, "", url);
}
