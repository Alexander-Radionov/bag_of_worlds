// Pure decision for who (if anyone) gets a phone saving-throw prompt.
// No Foundry globals at import time; `users` is any iterable of Foundry-like users.

/**
 * Only player characters are prompted on the phone. NPC-type actors (and any
 * other non-"character" type) keep midi-qol's normal save handling (GM / auto /
 * desktop / timeout). Returns the first active non-GM user who owns the actor,
 * or null when the actor must not be prompted or nobody is home.
 */
export function pickSaveRequestOwner(actor, users) {
  if (!actor || actor.type !== "character") return null;
  for (const u of users ?? []) {
    if (!u.isGM && u.active && actor.testUserPermission(u, "OWNER")) return u;
  }
  return null;
}
