/* globals CONFIG, canvas, foundry, game */
"use strict";

import { MODULE_ID } from "./const.js";

/**
 * @typedef {object} MovementBudget
 * @property {string} action        The movement action the budget was resolved for
 * @property {number|null} speed    Base speed in grid units for one round, or null when unknown
 * @property {number} used          Cost already spent this turn (0 when history is not considered)
 * @property {number} usedDiagonals The diagonal counter accumulated by the spent movement
 * @property {number} normal        Cumulative cost up to which movement is "normal" (blue)
 * @property {number} total         Cumulative cost up to which movement is possible at all (dash included)
 * @property {number} remaining     `total - used`: how much may still be spent from the current position
 * @property {string} units         Grid units label, e.g. "ft"
 */

/**
 * Resolve the base speed of a token for a movement action.
 *
 * Resolution order:
 *  1. `CONFIG["token-path-grid"].getTokenSpeed(token, action)`, when a game/module supplies one.
 *  2. The dnd5e rule used by `TokenRuler5e`: `system.attributes.movement[action]`, falling back to
 *     `walk` for actions flagged `walkFallback` (climb, swim) and for actions dnd5e does not know.
 *  3. A generic `system.attributes.movement` / `system.movement` lookup for other systems, scaled by
 *     the action's `speedMultiplier` from `CONFIG.Token.movement.actions`.
 *
 * @param {Token} token       The token to measure
 * @param {string} action     A key of `CONFIG.Token.movement.actions`
 * @returns {number|null}     Speed in grid units, or null when it cannot be determined
 */
export function getTokenSpeed(token, action) {
  const override = CONFIG[MODULE_ID]?.getTokenSpeed;
  if ( override instanceof Function ) {
    const speed = override(token, action);
    if ( speed !== undefined ) return speed;
  }

  const actor = token?.actor;
  if ( !actor ) return null;

  // dnd5e: mirror TokenRuler5e#getSpeedBasedStyle so highlighting agrees with the drag ruler.
  if ( game.system.id === "dnd5e" ) {
    const movement = actor.system?.attributes?.movement;
    if ( !movement || !actor.system?.isCreature ) return null;
    let speed = movement[action] ?? 0;
    const type = CONFIG.DND5E?.movementTypes?.[action];
    if ( type?.walkFallback || !type ) speed = Math.max(speed, movement.walk ?? 0);
    return Number(speed) || null;
  }

  // Generic fallback for other systems.
  const movement = foundry.utils.getProperty(actor, "system.attributes.movement")
    ?? foundry.utils.getProperty(actor, "system.movement");
  if ( !movement ) return null;
  const raw = movement[action] ?? movement.walk ?? movement.value;
  const speed = Number(raw?.value ?? raw);
  if ( !Number.isFinite(speed) || (speed <= 0) ) return null;

  // Core expresses "this action is slower than walking" through speedMultiplier.
  const multiplier = CONFIG.Token.movement.actions[action]?.speedMultiplier ?? 1;
  return Number.isFinite(multiplier) ? speed * multiplier : speed;
}

/**
 * Measure the movement already recorded for the token this turn.
 * @param {Token} token   The token to measure
 * @returns {{cost: number, diagonals: number}}
 */
export function measureSpentMovement(token) {
  const history = token.document.movementHistory;
  if ( !history || (history.length < 2) ) return {cost: 0, diagonals: 0};
  try {
    const measurement = token.measureMovementPath(history);
    return {
      cost: Number.isFinite(measurement.cost) ? measurement.cost : 0,
      diagonals: Number.isFinite(measurement.diagonals) ? measurement.diagonals : 0
    };
  } catch(err) {
    console.warn(`${MODULE_ID} | Failed to measure movement history`, err);
    return {cost: 0, diagonals: 0};
  }
}

/**
 * Build the movement budget for a token.
 * @param {Token} token                       The token to measure
 * @param {object} [options]
 * @param {string} [options.action]           Movement action; defaults to the token's current action
 * @param {number} [options.maxMultiplier=2]  Speed multiple the search extends to (2 = dash)
 * @param {boolean} [options.includeHistory=true]  Subtract movement already spent this turn
 * @param {number} [options.speed]            Override the resolved speed
 * @returns {MovementBudget}
 */
export function resolveBudget(token, {action, maxMultiplier=2, includeHistory=true, speed}={}) {
  action ??= token.document.movementAction;
  speed ??= getTokenSpeed(token, action);

  const spent = includeHistory ? measureSpentMovement(token) : {cost: 0, diagonals: 0};
  const normal = speed === null ? 0 : speed;
  const total = speed === null ? 0 : speed * maxMultiplier;

  return {
    action,
    speed,
    used: spent.cost,
    usedDiagonals: spent.diagonals,
    normal,
    total,
    remaining: Math.max(total - spent.cost, 0),
    units: canvas.grid.units
  };
}
