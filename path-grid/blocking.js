/* globals CONFIG, CONST, canvas, game */
"use strict";

import { MODULE_ID, OTHER_MODULES, SETTINGS, TOKENS_BLOCK_CHOICES } from "./const.js";
import { getSetting } from "./settings.js";

/**
 * Elevation Ruler's own obstacle model, loaded lazily.
 * `terrain_utils.js` is not part of Elevation Ruler's public API, so the import is guarded and the
 * module falls back to its own rules if the file ever moves.
 * @type {{tokenTerrainValue: Function, TERRAIN_FEATURES: object}|null}
 */
let elevationRulerTerrain = null;

/**
 * Try to load Elevation Ruler's obstacle model. Safe to call when Elevation Ruler is absent.
 * @returns {Promise<boolean>}   Whether the model is available
 */
export async function loadElevationRulerTerrain() {
  if ( elevationRulerTerrain ) return true;
  if ( !OTHER_MODULES.ELEVATION_RULER.ACTIVE ) return false;
  try {
    const imported = await import(
      `/modules/${OTHER_MODULES.ELEVATION_RULER.KEY}/scripts/pathfinding/terrain_utils.js`);
    if ( !(imported.tokenTerrainValue instanceof Function) ) return false;
    elevationRulerTerrain = imported;
    return true;
  } catch(err) {
    console.warn(`${MODULE_ID} | Elevation Ruler's obstacle model is unavailable; using built-in rules`, err);
    return false;
  }
}

/** Whether Elevation Ruler's obstacle model was loaded. @returns {boolean} */
export function hasElevationRulerTerrain() {
  return elevationRulerTerrain !== null;
}

/* -------------------------------------------- */

/**
 * The set of actor statuses that stop a token from blocking movement.
 * Reuses Elevation Ruler's list when that module is active so both agree on what an obstacle is.
 * @returns {Set<string>}
 */
function ignoredStatuses() {
  if ( OTHER_MODULES.ELEVATION_RULER.ACTIVE ) {
    const statuses = CONFIG[OTHER_MODULES.ELEVATION_RULER.KEY]?.pathfindingIgnoreStatuses;
    if ( statuses instanceof Set ) return statuses;
  }
  return CONFIG[MODULE_ID].defaultIgnoreStatuses;
}

/**
 * Is `test` an enemy of `subject`?
 * Mirrors Elevation Ruler's `tokenIsEnemy`: a secret token is an enemy of everyone, hostiles and
 * non-hostiles are enemies of each other, and everyone else is not.
 * @param {Token} subject
 * @param {Token} test
 * @returns {boolean}
 */
export function tokenIsEnemy(subject, test) {
  const D = CONST.TOKEN_DISPOSITIONS;
  const sD = subject.document.disposition;
  const tD = test.document.disposition;
  if ( (sD === D.SECRET) || (tD === D.SECRET) ) return true;
  if ( (tD === D.HOSTILE) && (sD >= 0) ) return true;
  if ( (sD === D.HOSTILE) && (tD >= 0) ) return true;
  return false;
}

/**
 * Does the given token block movement of the moving token, under this module's own rules?
 * @param {Token} blocker       Candidate obstacle
 * @param {Token} mover         The token whose movement is being planned
 * @param {string} policy       One of {@link TOKENS_BLOCK_CHOICES}
 * @returns {boolean}
 */
function tokenBlocks(blocker, mover, policy) {
  if ( policy === TOKENS_BLOCK_CHOICES.NONE ) return false;
  if ( blocker === mover ) return false;
  if ( !blocker.visible && !game.user.isGM ) return false;

  const statuses = ignoredStatuses();
  for ( const status of blocker.actor?.statuses ?? [] ) {
    if ( statuses.has(status) ) return false;
  }

  if ( policy === TOKENS_BLOCK_CHOICES.ALL ) return true;

  // TOKENS_BLOCK_CHOICES.HOSTILE matches the D&D 5e rule that a creature may move through an ally's
  // space but not through an enemy's.
  return tokenIsEnemy(mover, blocker);
}

/* -------------------------------------------- */

/**
 * @typedef {object} OccupancyMap
 * @property {Set<number>} impassable          Keys of grid spaces that cannot be entered at all
 * @property {Set<number>} occupied            Keys of grid spaces that may be crossed but not stopped on
 * @property {Map<number, number>} difficulty  Extra cost multiplier for entering a space, when above 1
 */

/**
 * Build the map of grid spaces obstructed by other tokens.
 *
 * A space occupied by *any* other token can never be a final destination, because two creatures may not
 * share a space. A space occupied by a blocking token additionally cannot be entered at all.
 *
 * With the `elevationruler` policy the decision is delegated to Elevation Ruler's `tokenTerrainValue`,
 * which additionally applies its friendly/hostile difficulty multipliers to spaces that are merely
 * crossed. Note that Elevation Ruler treats a difficulty at or above its `IMPASSABLE` value (3) as a
 * hard block, and so does this.
 *
 * Which tokens are on the map at all is a question about a viewer. By default the answer is this
 * client's own canvas, which is what a GM planning an NPC's move, or a player planning their own,
 * wants. `visibleTokenIds` answers it for somebody else instead — a grid computed on one client and
 * shipped to another — and then a token the viewer cannot see is not on their map: it must not block
 * a route they would otherwise be offered, and it must not leave an unexplained gap where it stands.
 *
 * @param {Token} mover                     The token whose movement is being planned
 * @param {(offset: {i: number, j: number}) => number} keyOf   Maps a grid offset to a dense integer key
 * @param {object} [options]
 * @param {Iterable<string>} [options.visibleTokenIds]  Whose map this is, as the ids on it
 * @returns {OccupancyMap}
 */
export function buildOccupancyMap(mover, keyOf, options={}) {
  const seen = options.visibleTokenIds ? new Set(options.visibleTokenIds) : null;
  const policy = getSetting(SETTINGS.TOKENS_BLOCK);
  const impassable = new Set();
  const occupied = new Set();
  const difficulty = new Map();

  const useElevationRuler = (policy === TOKENS_BLOCK_CHOICES.FOLLOW) && (elevationRulerTerrain !== null);
  const fallbackPolicy = (policy === TOKENS_BLOCK_CHOICES.FOLLOW)
    ? TOKENS_BLOCK_CHOICES.HOSTILE : policy;

  for ( const other of canvas.tokens.placeables ) {
    if ( other === mover ) continue;
    if ( other.isPreview ) continue;
    if ( seen ) {
      if ( !seen.has(other.id) ) continue;
    } else if ( !other.visible && !game.user.isGM ) continue;

    let blocks;
    let multiplier = 1;
    if ( useElevationRuler ) {
      const {tokenTerrainValue, TERRAIN_FEATURES} = elevationRulerTerrain;
      let value;
      try {
        value = tokenTerrainValue(other, mover);
      } catch(err) {
        console.warn(`${MODULE_ID} | Elevation Ruler obstacle test failed`, err);
        value = TERRAIN_FEATURES.NORMAL;
      }
      blocks = value >= TERRAIN_FEATURES.IMPASSABLE;
      if ( !blocks && (value > TERRAIN_FEATURES.NORMAL) ) multiplier = value / TERRAIN_FEATURES.NORMAL;
    } else {
      blocks = tokenBlocks(other, mover, fallbackPolicy);
    }

    for ( const offset of other.document.getOccupiedGridSpaceOffsets() ) {
      const key = keyOf(offset);
      if ( key < 0 ) continue;
      occupied.add(key);
      if ( blocks ) impassable.add(key);
      else if ( multiplier > 1 ) difficulty.set(key, Math.max(difficulty.get(key) ?? 1, multiplier));
    }
  }

  return {impassable, occupied, difficulty};
}

/* -------------------------------------------- */

/**
 * Test whether walls or surfaces block a single grid step.
 *
 * Delegates to `Token#checkCollision`, the same collision test `Token#constrainMovementPath` performs
 * while moving, so a step accepted here will not be cut short by the core movement pipeline.
 *
 * @param {Token} token                 The moving token
 * @param {ElevatedPoint} origin        Movement origin (the token's movement origin, not its top-left)
 * @param {ElevatedPoint} destination   Movement destination
 * @returns {boolean}                   True when the step is blocked
 */
export function stepBlockedByWalls(token, origin, destination) {
  try {
    return token.checkCollision(destination, {origin, type: "move", mode: "any"}) === true;
  } catch(err) {
    console.warn(`${MODULE_ID} | Collision test failed`, err);
    return false;
  }
}

/**
 * Whether the given movement action is stopped by walls at all.
 * `displace` (and any action configured with `walls: null`) passes through everything.
 * @param {string} action
 * @returns {boolean}
 */
export function actionRespectsWalls(action) {
  return !!CONFIG.Token.movement.actions[action]?.walls;
}
