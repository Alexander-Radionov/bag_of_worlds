// User management (GM only) — extracted from mobile-bridge.js.

// --- User management (GM only; mirrors Foundry's own "Configure Players") ---

/** Foundry roles selectable from the phone; NONE (banned) is not offered. */
export const ASSIGNABLE_USER_ROLES = new Set([
  CONST.USER_ROLES.PLAYER,
  CONST.USER_ROLES.TRUSTED,
  CONST.USER_ROLES.ASSISTANT,
  CONST.USER_ROLES.GAMEMASTER
]);

/**
 * Every action below re-checks `user.isGM` itself: `user` is the phone-side
 * requester resolved from the Foundry User document (server truth, not
 * client-sent state), while the PRIMARY_GM_ONLY_ACTIONS routing above only
 * decides which browser tab executes the request. Without this check a
 * player's phone could reach these handlers by sending the action directly.
 *
 * There is no shared "DM password" here on purpose: world settings are
 * readable by every connected client and module socket messages are
 * broadcast to every connected client, so a password carried either way
 * would be visible to any player. GM-only actions must instead run on a
 * phone that is logged into a real Foundry account with the GM role — its
 * own dedicated GM account, distinct from the one already connected on the
 * GM's computer (Foundry allows only one active session per account).
 */
export function requireGmRequester(user) {
  if (user?.isGM) return;
  const err = new Error("GM only");
  err.bridgeCode = "FORBIDDEN";
  throw err;
}

/** Never includes the password hash/salt — only what the app is allowed to show. */
export function userSummary(u) {
  return { id: u.id, name: u.name, role: u.role ?? 0, active: !!u.active };
}

export function usersList(user) {
  requireGmRequester(user);
  return game.users.map(userSummary);
}

export async function userCreate(user, payload) {
  requireGmRequester(user);
  const name = String(payload?.name ?? "").trim();
  if (!name) throw new Error("Name is required");
  const role = payload?.role === undefined ? CONST.USER_ROLES.PLAYER : Number(payload.role);
  if (!ASSIGNABLE_USER_ROLES.has(role)) throw new Error("Invalid role");
  const password = typeof payload?.password === "string" ? payload.password : "";

  const data = { name, role };
  // Foundry hashes this server-side (same field the "Configure Players" sheet
  // writes to); an empty string leaves the account passwordless, same as a
  // freshly-created world user until a GM sets one.
  if (password) data.password = password;

  const created = await User.create(data);
  return userSummary(created);
}

export async function userDelete(user, userId) {
  requireGmRequester(user);
  if (!userId) throw new Error("userId is required");
  if (userId === user.id) throw new Error("You cannot delete your own account");
  const target = game.users.get(userId);
  if (!target) throw new Error("User not found");
  if (target.isGM && game.users.filter((u) => u.isGM).length <= 1) {
    throw new Error("Cannot delete the last Gamemaster");
  }
  await target.delete();
  return { id: userId, deleted: true };
}

export async function userRoleSet(user, userId, role) {
  requireGmRequester(user);
  if (!userId) throw new Error("userId is required");
  const nextRole = Number(role);
  if (!ASSIGNABLE_USER_ROLES.has(nextRole)) throw new Error("Invalid role");
  const target = game.users.get(userId);
  if (!target) throw new Error("User not found");
  if (target.isGM && nextRole < CONST.USER_ROLES.GAMEMASTER
    && game.users.filter((u) => u.isGM).length <= 1) {
    throw new Error("Cannot demote the last Gamemaster");
  }
  await target.update({ role: nextRole });
  return userSummary(target);
}

export async function userPasswordSet(user, userId, password) {
  requireGmRequester(user);
  if (!userId) throw new Error("userId is required");
  if (typeof password !== "string" || password.length === 0) {
    throw new Error("password is required");
  }
  const target = game.users.get(userId);
  if (!target) throw new Error("User not found");
  // Same call the core "Configure Players" sheet makes; the server hashes the
  // value before it is persisted, and it is never echoed back to any client.
  await target.update({ password });
  return userSummary(target);
}

export function ok(requestId, result) {
  return { requestId, ok: true, result };
}

export function fail(requestId, code, message) {
  return { requestId, ok: false, error: { code, message } };
}
