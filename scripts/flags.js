// Readers for the module's persistent document flags, tolerant of the pre-rename scope.
//
// Before "Bag of Worlds" the flags lived under flags["foundry-mobile-bridge"]. id-migration.js copies them to
// flags["bag-of-worlds"] once; until that has finished (and for as long as the old module id is the only place
// a value exists) these readers fall back to the old scope. Foundry's getFlag() refuses a scope whose module
// is not active, so everything here reads `doc.flags` directly.
//
// The fallback is switched off once the migration is recorded as complete. It must not outlive the migration:
// a value the bridge deliberately cleared (unsetFlag on the new scope) would otherwise reappear from the old
// copy, which the migration leaves in place for rollback.

import { LEGACY_MODULE_ID, MODULE_ID } from "./constants.js";

let legacyFallback = true;

/** Turn the old-scope fallback on or off (id-migration.js does this from the recorded migration state). */
export function setLegacyFallback(enabled) {
  legacyFallback = !!enabled;
}

export function legacyFallbackActive() {
  return legacyFallback;
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * The bridge's flags on a document: the new scope, topped up with old-scope keys it does not have yet
 * while the fallback is active. Never mutates the document. Always an object.
 */
export function bridgeFlags(doc) {
  const own = doc?.flags?.[MODULE_ID];
  const base = isObject(own) ? own : {};
  if (!legacyFallback) return base;
  const old = doc?.flags?.[LEGACY_MODULE_ID];
  if (!isObject(old)) return base;
  return { ...old, ...base };
}

/** One bridge flag by key (new scope first, old scope while the fallback is active); undefined when unset. */
export function bridgeFlag(doc, key) {
  const own = doc?.flags?.[MODULE_ID]?.[key];
  if (own !== undefined) return own;
  return legacyFallback ? doc?.flags?.[LEGACY_MODULE_ID]?.[key] : undefined;
}

/**
 * Update data that removes bridge flags from a document: always from the new scope and, while the fallback is
 * active, from the old scope too, so the old copy cannot resurface. Merge it into an update() payload.
 * A plain data path is used (not unsetFlag) because Foundry refuses flag scopes of inactive modules.
 */
export function clearBridgeFlagsUpdate(doc, keys) {
  const update = {};
  for (const key of keys) {
    update[`flags.${MODULE_ID}.-=${key}`] = null;
    if (legacyFallback && doc?.flags?.[LEGACY_MODULE_ID]?.[key] !== undefined) {
      update[`flags.${LEGACY_MODULE_ID}.-=${key}`] = null;
    }
  }
  return update;
}
