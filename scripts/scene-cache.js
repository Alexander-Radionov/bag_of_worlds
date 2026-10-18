// Pure helpers for the phone's on-disk map-background cache. No Foundry globals
// are touched at import time, so this module is unit-testable under plain Node.
//
// Why a "stamp": `bgVersion` hashes the background's *path* and transform, not
// the file's bytes. If a GM overwrites the image under the same path, bgVersion
// stays put and a persistent cache would serve the old art forever. The stamp is
// a cheap identity of the FILE (from HTTP headers), so the phone can tell.

function headerValue(headers, name) {
  if (!headers) return "";
  const raw = typeof headers.get === "function" ? headers.get(name) : headers[name] ?? headers[name.toLowerCase()];
  return raw == null ? "" : String(raw).trim();
}

/**
 * Identity of a file from its response headers: the ETag, else Last-Modified
 * together with Content-Length (either one alone is too weak to trust).
 * Returns null when the server gives neither, which tells the phone to fall back
 * to trusting bgVersion.
 */
export function stampFromHeaders(headers) {
  const etag = headerValue(headers, "etag");
  if (etag) return `etag:${etag}`;
  const lastModified = headerValue(headers, "last-modified");
  const length = headerValue(headers, "content-length");
  if (lastModified && length) return `lm:${lastModified}|len:${length}`;
  return null;
}

/** Reply of `scene.background.stamp`. */
export function buildStampReply({ sceneId = null, bgVersion = null, stamp = null } = {}) {
  return { sceneId, bgVersion, stamp: stamp || null };
}

/**
 * Reply of `scene.versions`: every scene's id and bgVersion, nothing else (no
 * names, no paths). A scene whose version cannot be computed is still listed,
 * with `bgVersion: null`, so the phone does not mistake "could not compute" for
 * "scene deleted" and throw away a perfectly good cached image.
 */
export function shapeSceneVersions(scenes, computeVersion) {
  const out = [];
  for (const scene of scenes ?? []) {
    const sceneId = scene?.id;
    if (!sceneId) continue;
    let bgVersion = null;
    try {
      bgVersion = String(computeVersion(scene));
    } catch {
      bgVersion = null;
    }
    out.push({ sceneId, bgVersion });
  }
  return out;
}
