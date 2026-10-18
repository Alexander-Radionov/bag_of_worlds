// Who may receive the GM-rendered viewport snapshot, and which tokens go in it.
//
// Pure functions with no Foundry globals so they can be unit-tested from
// tests/bridge/ under plain Node.
//
// Why this exists: `scene.viewport.snapshot` renders the GM tab's primary layer
// "without fog/vision" and copies every token on it. Handed to a player, that is
// the whole scene with the GM's eyes: unexplored map, hidden and out-of-sight
// creatures. The phone's own map model (scene.dynamic.get) is vision-filtered;
// the snapshot is not, so it must not reach a player on a vision-limited scene.

/**
 * @param {{isGM: boolean, tokenVision: boolean}} ctx
 *   isGM: the requesting user (not the executing GM tab) has the GM role.
 *   tokenVision: the scene uses token vision. Unknown must be passed as true.
 * @returns {{allowed: boolean, reason?: string, filterTokens: boolean}}
 */
export function viewportSnapshotPolicy({ isGM, tokenVision }) {
  if (isGM) return { allowed: true, filterTokens: false };
  if (tokenVision) return { allowed: false, reason: "vision_scene", filterTokens: true };
  return { allowed: true, filterTokens: true };
}

/**
 * Whether a token may appear in the snapshot (the picture and the token list).
 *
 * @param {{filterTokens: boolean}} policy from {@link viewportSnapshotPolicy}
 * @param {{id: string, hidden?: boolean}} tokenDoc
 * @param {Set<string>|null} visibleIds ids the requesting user can see; null with
 *   filterTokens means "none known", which hides everything but is never expected.
 */
export function snapshotIncludesToken(policy, tokenDoc, visibleIds) {
  if (!policy?.filterTokens) return true;
  if (tokenDoc?.hidden) return false;
  return !!visibleIds && visibleIds.has(tokenDoc?.id);
}

/**
 * Whether the scene uses token vision, failing closed: a value that is not
 * exactly `false` counts as "vision on", because wrongly withholding the GM
 * picture costs a fallback, and wrongly sending it leaks the map.
 */
export function sceneUsesTokenVision(visibilityTokenVision, sceneTokenVision) {
  const v = visibilityTokenVision ?? sceneTokenVision;
  return v !== false;
}
