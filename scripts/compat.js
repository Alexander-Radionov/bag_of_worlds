// App <-> bridge version compatibility helpers.
// Pure functions: no Foundry globals at import time, so tests/bridge/compat.test.js can load this file in Node.

/**
 * Parses "1.2.3", "v1.2.3", "1.2.3-beta.1" or "1.2.3+build" into [major, minor, patch].
 * A pre-release or build suffix is ignored (so 0.15.0-beta compares equal to 0.15.0): releases here are plain
 * x.y.z and the suffix only matters for sorting two builds of the same number, which nothing needs.
 * @returns {[number, number, number] | null} null for anything that is not a version string.
 */
export function parseSemver(value) {
  if (typeof value !== "string") return null;
  const m = /^v?(\d{1,6})\.(\d{1,6})\.(\d{1,6})(?:[-+][0-9A-Za-z.+-]*)?$/.exec(value.trim());
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/**
 * -1 when a < b, 0 when equal, 1 when a > b; null when either side is malformed
 * (callers must treat "cannot compare" as "do not warn").
 */
export function compareSemver(a, b) {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) return null;
  for (let i = 0; i < 3; i++) {
    if (pa[i] < pb[i]) return -1;
    if (pa[i] > pb[i]) return 1;
  }
  return 0;
}

/**
 * True only when both versions parse and the app is strictly newer than the bridge.
 * An OLDER app never warns: the bridge stays backward compatible with it.
 */
export function isAppNewerThanBridge(appVersion, bridgeVersion) {
  return compareSemver(appVersion, bridgeVersion) === 1;
}

/** Minimal HTML escape for text that goes into a Foundry notification (which renders HTML). */
export function escapeNoticeText(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]
  ));
}

/**
 * Remembers which (userId, appVersion) pairs have already been warned about during this page load.
 * `shouldNotify` is true at most once per pair, and only when the app is newer than the bridge.
 */
export function createAppVersionNoticeTracker() {
  const seen = new Set();
  return {
    shouldNotify(userId, appVersion, bridgeVersion) {
      if (!userId || typeof appVersion !== "string" || !appVersion) return false;
      if (!isAppNewerThanBridge(appVersion, bridgeVersion)) return false;
      const key = `${userId}\u0000${appVersion.trim()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }
  };
}
