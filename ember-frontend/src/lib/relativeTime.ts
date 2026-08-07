/**
 * Relative-time formatter + absolute-time tooltip helpers for use in
 * the activity timeline and detail panels on /lookup.
 *
 * The relative string is what gets displayed inline; the absolute
 * tooltip (local + UTC) shows on hover so the user can disambiguate
 * "5m ago" → exact wall-clock + timezone.
 */

/**
 * Returns a relative time string like "just now", "5m ago", "3h ago",
 * "2d ago". For events older than ~30 days, falls back to a
 * locale-formatted absolute date so the relative phrasing doesn't
 * become useless ("3 months ago" tells you less than "Apr 14").
 */
export function relativeTime(timestampMs: number, nowMs: number = Date.now()): string {
  if (!Number.isFinite(timestampMs) || timestampMs <= 0) return "—";
  const diffSec = Math.round((nowMs - timestampMs) / 1000);
  if (diffSec < 0) {
    // future timestamp (clock skew); just say "now" rather than "in N min"
    return "just now";
  }
  if (diffSec < 5)         return "just now";
  if (diffSec < 60)        return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60)        return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24)         return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 30)        return `${diffDay}d ago`;
  // Older than a month — show absolute date in user's locale (no year
  // unless it's a different year from now).
  const d = new Date(timestampMs);
  const now = new Date(nowMs);
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

/**
 * Two-line tooltip with both local and UTC absolute time.
 * Local uses the user's resolved timezone; UTC is shown explicitly.
 */
export function absoluteTimeTooltip(timestampMs: number): string {
  if (!Number.isFinite(timestampMs) || timestampMs <= 0) return "";
  const d = new Date(timestampMs);
  const localTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const localStr = d.toLocaleString(undefined, {
    year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  });
  const utcStr = d.toLocaleString("en-US", {
    timeZone: "UTC",
    year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  });
  return `Local (${localTz}): ${localStr}\nUTC: ${utcStr}`;
}

/**
 * Compact tooltip when the relative string is already age-ish. Same
 * info as `absoluteTimeTooltip` but used at hover positions where
 * vertical room is tight — single line, no labels.
 */
export function compactAbsoluteTooltip(timestampMs: number): string {
  if (!Number.isFinite(timestampMs) || timestampMs <= 0) return "";
  const d = new Date(timestampMs);
  return d.toLocaleString(undefined, {
    year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  });
}
