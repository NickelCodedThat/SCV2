// Small formatting helpers shared across Storm Center and LIVE EARTH.
export function formatDateTime(date, { compact = false, timeOnly = false } = {}) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "Not specified";

  const options = timeOnly
    ? { hour: "numeric", minute: "2-digit", second: "2-digit" }
    : compact
      ? { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }
      : { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" };
  return new Intl.DateTimeFormat("en-US", options).format(date);
}

export function capitalize(value) {
  return value ? `${value.charAt(0).toUpperCase()}${value.slice(1)}` : "";
}

export function pluralize(word, count) {
  return count === 1 ? word : `${word}s`;
}

export function compassFromDegrees(degrees) {
  if (!Number.isFinite(degrees)) return "an unknown direction";
  const directions = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  return directions[Math.round(degrees / 22.5) % 16];
}

/**
 * Short relative-time label ("Just now", "12 min ago", "3 hr ago",
 * "2 days ago") used where a compact recency signal matters more than an
 * exact timestamp (e.g. feed cards). Returns "Time unknown" for missing or
 * invalid input rather than guessing.
 */
export function relativeTimeLabel(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "Time unknown";

  const diffMinutes = Math.round((Date.now() - date.getTime()) / 60000);
  if (diffMinutes < 1) return "Just now";
  if (diffMinutes < 60) return `${diffMinutes} min ago`;

  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours} hr ago`;

  const diffDays = Math.round(diffHours / 24);
  return `${diffDays} ${pluralize("day", diffDays)} ago`;
}
