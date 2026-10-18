// Pure helpers for "self"-range items. No Foundry globals and no imports, so the
// module loads (and is unit-tested) outside Foundry — see tests/bridge/selfRange.test.js.

function nonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "" ? value.trim().toLowerCase() : "";
}

/** Effective range unit of the activity being used ("self", "touch", "ft", ...). */
export function effectiveRangeUnits(item, activity) {
  // dnd5e 5.x merges the item's range into activity.range during prepareFinalData
  // unless range.override is set, so the activity answer is already the effective one.
  return nonEmptyString(activity?.range?.units) || nonEmptyString(item?.system?.range?.units);
}

function activityList(item) {
  const activities = item?.system?.activities;
  if (!activities) return [];
  if (typeof activities.values === "function") return [...activities.values()];
  if (Array.isArray(activities.contents)) return activities.contents;
  if (typeof activities === "object") return Object.values(activities);
  return [];
}

/**
 * True when the activity about to be used has range "self" AND no area template.
 *
 * The no-area half matters: Burning Hands / Thunderwave are "self" range too, but
 * their cone/cube comes out of the caster and is aimed with the template flow
 * (templates are the targeting source there). Auto-targeting the caster would add
 * the caster to the blast, so those keep the existing flow untouched.
 *
 * @param {object} item                  dnd5e Item (only system.range / system.activities / system.target read)
 * @param {object|null} activity         activity being used; null when the item has none
 * @param {Function} resolveArea         resolveTargetBlockTemplate(targetBlock) -> {type,size}|null.
 *                                       Injected to keep this module free of Foundry imports.
 *                                       Missing resolver -> false (never guess "no area").
 */
export function isSelfRangeNoArea(item, activity, resolveArea) {
  if (!item && !activity) return false;
  if (typeof resolveArea !== "function") return false;
  if (effectiveRangeUnits(item, activity) !== "self") return false;

  if (activity) {
    return !resolveArea(activity.target);
  }
  // No activity (legacy / activity-less item): any area on the item, either the
  // legacy item-level block or on any of its activities, disqualifies it.
  if (resolveArea(item?.system?.target)) return false;
  return !activityList(item).some((a) => resolveArea(a?.target));
}

/**
 * Pick the caster's token among the actor's tokens on the active scene.
 * Rule (deterministic): the first token, in scene order, that is a combatant of the
 * given combat; otherwise the first token in scene order. Linked vs unlinked is
 * irrelevant here because the caller already filtered to this actor's tokens
 * (`token.actorId` for linked, the synthetic actor's own token for unlinked).
 *
 * @param {Array<{id:string}>} tokenDocs   token documents in scene order
 * @param {Iterable<string>} [combatTokenIds]  token ids that are combatants in the active combat
 */
export function pickCasterToken(tokenDocs, combatTokenIds) {
  const docs = Array.isArray(tokenDocs) ? tokenDocs.filter((t) => t && t.id) : [];
  if (!docs.length) return null;
  const inCombat = new Set(combatTokenIds ?? []);
  return docs.find((t) => inCombat.has(t.id)) ?? docs[0];
}
