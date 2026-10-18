/* globals Hooks, canvas, game */
"use strict";

import { HOST_ID, LEGACY_HOST_ID, MODULE_ID, TIERS, refreshOtherModules } from "./const.js";
import { migrateLegacySettings, registerSettings } from "./settings.js";
import { ensureSettingsMigrated } from "../scripts/id-migration.js";
import { computeReachability } from "./reachability.js";
import { resolveBudget, getTokenSpeed } from "./speed.js";
import { clearHighlight, drawReachability, ensureLayer, tierColor } from "./highlight.js";
import { controller, onEnabledChanged, registerConfig, registerHooks, registerKeybindings } from "./controller.js";
import { refreshSceneControls, registerSceneControls } from "./toolbar.js";

/**
 * The movement grid's public API: `game.modules.get("bag-of-worlds").pathGrid` when built into the
 * bridge, or `game.modules.get("token-path-grid").api` when the standalone module is installed instead.
 */
const api = {
  /**
   * Compute the reachability grid for a token without touching what is on screen.
   * @see computeReachability
   * @param {Token} token
   * @param {object} [options]
   * @returns {ReachabilityResult}
   */
  computeReachability,

  /**
   * Compute the reachability grid for a token and return it as plain, serialisable data.
   * Useful from macros and for anything that needs to ship the grid elsewhere.
   * @param {Token} token
   * @param {object} [options]
   * @returns {{origin: object, budget: object, action: string, cells: object[]}}
   */
  getGrid(token, options={}) {
    const result = computeReachability(token, options);
    return {
      action: result.action,
      origin: result.origin,
      budget: result.budget,
      unavailable: result.unavailable,
      cells: [...result.cells.values()].map(cell => ({
        i: cell.i, j: cell.j, x: cell.x, y: cell.y,
        cost: cell.cost, stepCost: cell.stepCost, tier: cell.tier, canStop: cell.canStop,
        // The predecessor tree, flattened: follow `previous` back to the origin and
        // you have the route to this space, no callback and no second search needed.
        previousI: cell.previous?.i ?? null, previousJ: cell.previous?.j ?? null
      }))
    };
  },

  /**
   * The movement waypoints that reach a grid space, or null when it is out of range.
   * @param {Token} token
   * @param {number} i        Row of the destination grid space
   * @param {number} j        Column of the destination grid space
   * @param {object} [options]
   * @returns {object[]|null}
   */
  getPath(token, i, j, options={}) {
    return computeReachability(token, options).getPath(i, j);
  },

  /**
   * Move a token to a reachable grid space along the computed path.
   * @param {Token} token
   * @param {number} i
   * @param {number} j
   * @param {object} [options]
   * @returns {Promise<boolean>}   Whether the whole movement completed
   */
  async moveToken(token, i, j, options={}) {
    const waypoints = computeReachability(token, options).getPath(i, j);
    if ( !waypoints?.length ) return false;
    return token.document.move(waypoints, {showRuler: true, ...options.moveOptions});
  },

  /** Recompute and redraw the grid for the currently controlled token. */
  refresh: (...args) => controller.refresh(...args),

  /** Remove the grid from the canvas. */
  clear: () => controller.clear(),

  /** The result currently on screen, or null. @returns {ReachabilityResult|null} */
  get current() { return controller.result; },

  /** Draw an arbitrary result on the canvas. */
  draw: drawReachability,

  // Lower-level helpers, exposed so other modules can reuse the pieces.
  resolveBudget,
  getTokenSpeed,
  tierColor,
  clearHighlight,
  ensureLayer,
  controller,
  TIERS
};

/* -------------------------------------------- */
/*  Embedded start-up                           */
/* -------------------------------------------- */

/** Whether this embedded copy initialised; false when skipped (old Foundry, or the standalone module is active). */
let running = false;

/**
 * The movement-grid API of this embedded copy, or null when it is not running.
 * The standalone module, when active, exposes the same API as `game.modules.get("token-path-grid").api`.
 * @returns {object|null}
 */
export function embeddedPathGridApi() {
  return running ? api : null;
}

/** Run a start-up step without letting a failure here take the rest of the bridge down. */
function guarded(label, fn) {
  try {
    return fn();
  } catch(err) {
    console.error(`${MODULE_ID} | ${label} failed`, err);
  }
}

Hooks.once("init", function() {
  // The standalone module and this copy would patch the same click handler and register the same toggle twice.
  // The standalone one wins: its API is what the bridge looks up first, and it is the one the user installed.
  if ( game.modules.get(MODULE_ID)?.active ) {
    console.info(`${MODULE_ID} | The standalone "${MODULE_ID}" module is active; the movement grid built into `
      + "Bag of Worlds stays off. Disable the standalone module to use the built-in one.");
    return;
  }
  // The grid uses the v13 canvas namespaces; there is nothing to fall back to on v12.
  if ( (game.release?.generation ?? 0) < 13 ) {
    console.info(`${MODULE_ID} | The built-in movement grid needs Foundry v13 or newer; it stays off.`);
    return;
  }
  // The pre-rename "foundry-mobile-bridge" module embeds the same grid and wraps the same click handler; two copies
  // would move a token twice per click. The old module keeps its grid until it is disabled (its API stays reachable
  // through pathGridApi() in map.js), and mobile-bridge.js warns the GM to disable it.
  if ( game.modules.get(LEGACY_HOST_ID)?.active ) {
    console.info(`${MODULE_ID} | The old "${LEGACY_HOST_ID}" module is still active and already runs a movement grid; `
      + "the one built into Bag of Worlds stays off. Disable the old module to use the new one.");
    return;
  }
  running = true;
  guarded("init", () => {
    refreshOtherModules();
    registerConfig();
    registerSettings({onEnabledChange: onEnabledChanged});
    registerKeybindings();
    registerSceneControls();
    const host = game.modules.get(HOST_ID);
    if ( host ) host.pathGrid = api;
  });
});

// Registered at setup so the first `canvasReady` of the session is caught.
Hooks.once("setup", function() {
  if ( running ) guarded("setup", registerHooks);
});

Hooks.once("ready", async function() {
  if ( !running ) return;
  try {
    // Settings saved under the pre-rename "foundry-mobile-bridge" id come first, so they beat the older
    // standalone token-path-grid values that migrateLegacySettings() would otherwise copy over them.
    await ensureSettingsMigrated();
    await migrateLegacySettings();
    if ( canvas.ready ) {
      ensureLayer();
      controller.refresh();
    }
    refreshSceneControls();
  } catch(err) {
    console.error(`${MODULE_ID} | ready failed`, err);
  }
});
