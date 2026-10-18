/* globals CONFIG, Hooks, canvas, foundry, game, libWrapper, ui */
"use strict";

import { HOST_ID, L10N, MODULE_ID, SETTINGS, TIERS } from "./const.js";
import { getSetting, toggleEnabled } from "./settings.js";
import { refreshSceneControls } from "./toolbar.js";
import { computeReachability } from "./reachability.js";
import { clearHighlight, destroyLayer, drawReachability, ensureLayer } from "./highlight.js";
import { loadElevationRulerTerrain } from "./blocking.js";

/**
 * Owns the reachability grid currently on screen: which token it belongs to, when it is recomputed,
 * and what a click on it does.
 */
class GridController {
  /** @type {ReachabilityResult|null} */
  #result = null;

  /** @type {string|null} */
  #tokenId = null;

  /** Grid space awaiting a confirming second click, as `"i,j"`. @type {string|null} */
  #pending = null;

  /** True while a move started by this controller is in flight. @type {boolean} */
  #moving = false;

  /** The most recent result, or null when no grid is displayed. @returns {ReachabilityResult|null} */
  get result() { return this.#result; }

  /** The token the current grid belongs to. @returns {Token|null} */
  get token() { return this.#tokenId ? canvas.tokens?.get(this.#tokenId) ?? null : null; }

  /* -------------------------------------------- */

  /**
   * Which token should the grid be shown for right now?
   * @returns {Token|null}
   */
  #activeToken() {
    if ( !getSetting(SETTINGS.ENABLED) ) return null;
    if ( !canvas.ready || !canvas.tokens?.active ) return null;
    const controlled = canvas.tokens.controlled;
    if ( controlled.length !== 1 ) return null;
    const token = controlled[0];
    if ( !token.isOwner ) return null;
    return token;
  }

  /* -------------------------------------------- */

  /**
   * Recompute and redraw the grid for whichever token is currently active.
   * @param {object} [options]   Forwarded to {@link computeReachability}
   */
  refresh(options={}) {
    if ( this.#moving ) return;
    const token = this.#activeToken();
    if ( !token ) return this.clear();

    let result;
    try {
      result = computeReachability(token, options);
    } catch(err) {
      console.error(`${MODULE_ID} | Reachability search failed`, err);
      return this.clear();
    }

    this.#result = result;
    this.#tokenId = token.id;
    this.#pending = null;
    drawReachability(result);
    Hooks.callAll(`${MODULE_ID}.refresh`, result);
  }

  /** Remove the grid from the canvas and forget it. */
  clear() {
    const had = this.#result !== null;
    this.#result = null;
    this.#tokenId = null;
    this.#pending = null;
    clearHighlight();
    if ( had ) Hooks.callAll(`${MODULE_ID}.clear`);
  }

  /**
   * Look up the reachable space containing a canvas point.
   * @param {{x: number, y: number}} point
   * @returns {ReachableCell|null}
   */
  cellAt(point) {
    if ( !this.#result ) return null;
    const offset = canvas.grid.getOffset(point);
    return this.#result.cells.get(`${offset.i},${offset.j}`) ?? null;
  }

  /* -------------------------------------------- */

  /**
   * Move the controlled token to a reachable grid space along the computed path.
   * @param {number} i                      Row of the destination space
   * @param {number} j                      Column of the destination space
   * @param {object} [options]
   * @param {boolean} [options.showRuler=true]   Show the movement to other clients
   * @returns {Promise<boolean>}            Whether the whole movement completed
   */
  async moveTo(i, j, {showRuler=true}={}) {
    const result = this.#result;
    const token = this.token;
    if ( !result || !token ) return false;

    const cell = result.cells.get(`${i},${j}`);
    if ( !cell ) return false;
    if ( !cell.canStop ) {
      ui.notifications.warn(game.i18n.localize(`${L10N}.notifications.occupied`));
      return false;
    }

    const waypoints = result.getPath(i, j);
    if ( !waypoints?.length ) return false;

    this.#moving = true;
    clearHighlight();
    try {
      return await token.document.move(waypoints, {showRuler});
    } catch(err) {
      console.error(`${MODULE_ID} | Movement failed`, err);
      return false;
    } finally {
      this.#moving = false;
      this.refresh();
    }
  }

  /* -------------------------------------------- */

  /**
   * Handle a left click on empty canvas while the grid is displayed.
   * @param {object} event   The Foundry interaction event
   * @returns {boolean}      True when the click was consumed and default handling should be skipped
   */
  onClickLeft(event) {
    if ( !this.#result || !getSetting(SETTINGS.CLICK_TO_MOVE) ) return false;
    if ( game.activeTool !== "select" ) return false;
    if ( this.#moving ) return false;

    const point = event.interactionData?.origin ?? canvas.mousePosition;
    const cell = this.cellAt(point);
    if ( !cell || !cell.canStop ) return false;

    const key = `${cell.i},${cell.j}`;
    if ( getSetting(SETTINGS.CONFIRM_DASH) && (cell.tier === TIERS.DASH) && (this.#pending !== key) ) {
      this.#pending = key;
      ui.notifications.info(game.i18n.format(`${L10N}.notifications.confirmDash`, {
        cost: cell.cost.toNearest(0.01).toLocaleString(game.i18n.lang),
        units: canvas.grid.units
      }));
      return true;
    }

    this.#pending = null;
    this.moveTo(cell.i, cell.j);
    return true;
  }
}

/** The single controller instance. */
export const controller = new GridController();

/* -------------------------------------------- */

/**
 * Wrap `TokenLayer#_onClickLeft` so a click on a highlighted space moves the token there.
 * Uses libWrapper when it is available and falls back to a plain prototype wrap otherwise.
 */
function patchClickHandler() {
  const TokenLayer = foundry.canvas.layers.TokenLayer;

  const handler = function(wrapped, event) {
    if ( controller.onClickLeft(event) ) return;
    return wrapped.call(this, event);
  };

  if ( game.modules.get("lib-wrapper")?.active && (typeof libWrapper !== "undefined") ) {
    libWrapper.register(HOST_ID, "foundry.canvas.layers.TokenLayer.prototype._onClickLeft",
      function(wrapped, ...args) { return handler.call(this, wrapped, ...args); }, "MIXED");
    return;
  }

  const original = TokenLayer.prototype._onClickLeft;
  TokenLayer.prototype._onClickLeft = function(event) {
    return handler.call(this, original, event);
  };
}

/* -------------------------------------------- */

/**
 * Register every hook that keeps the grid in sync with the canvas.
 */
export function registerHooks() {
  const refresh = foundry.utils.debounce(() => controller.refresh(), 50);

  // Elevation Ruler's obstacle model is loaded once, then reused by every search.
  loadElevationRulerTerrain().then(loaded => {
    if ( loaded ) refresh();
  });

  Hooks.on("canvasReady", () => {
    ensureLayer();
    refresh();
  });
  Hooks.on("canvasTearDown", () => {
    controller.clear();
    destroyLayer();
  });

  Hooks.on("controlToken", () => refresh());

  Hooks.on("updateToken", (document, changed) => {
    const relevant = ["x", "y", "elevation", "width", "height", "shape", "movementAction", "_movementHistory"]
      .some(key => key in changed);
    if ( !relevant ) return;
    // Any token moving can change what is passable, not just the controlled one.
    refresh();
  });

  Hooks.on("createToken", () => refresh());
  Hooks.on("deleteToken", () => refresh());

  Hooks.on("updateActor", (actor, changed) => {
    if ( !foundry.utils.hasProperty(changed, "system.attributes.movement") ) return;
    if ( controller.token?.actor?.id !== actor.id ) return;
    refresh();
  });

  for ( const hook of ["createWall", "updateWall", "deleteWall",
    "createRegion", "updateRegion", "deleteRegion",
    "createRegionBehavior", "updateRegionBehavior", "deleteRegionBehavior"] ) {
    Hooks.on(hook, () => refresh());
  }

  Hooks.on("updateCombat", () => refresh());
  Hooks.on("deleteCombat", () => refresh());

  patchClickHandler();
}

/**
 * Called whenever the `enabled` setting changes, by whatever route (button, keybinding, settings dialog):
 * redraw or clear the grid and bring the scene-controls button back in line.
 */
export function onEnabledChanged() {
  controller.refresh();
  refreshSceneControls();
}

/**
 * Register the module's keybinding. Called during `init`, before settings are read.
 */
export function registerKeybindings() {
  game.keybindings.register(HOST_ID, "pathGridToggle", {
    name: `${L10N}.keybindings.toggle.name`,
    hint: `${L10N}.keybindings.toggle.hint`,
    editable: [{key: "KeyG", modifiers: ["Alt"]}],
    onDown: () => {
      toggleEnabled();
      return true;
    },
    restricted: false
  });
}

/**
 * Keep {@link CONFIG} defaults this module reads at runtime.
 */
export function registerConfig() {
  // Assigned rather than merged: the defaults contain a Set, which mergeObject would not preserve.
  const config = CONFIG[MODULE_ID] ??= {};
  const defaults = {
    /**
     * Statuses that stop a token from blocking movement, used only when Elevation Ruler is absent.
     * @type {Set<string>}
     */
    defaultIgnoreStatuses: new Set([
      "dead", "ethereal", "incapacitated", "invisible", "paralyzed",
      "petrified", "prone", "restrained", "sleeping", "unconscious"
    ]),

    /**
     * Optional override for speed resolution: `(token, action) => number|null|undefined`.
     * Returning `undefined` falls through to the built-in resolution.
     * @type {Function|null}
     */
    getTokenSpeed: null
  };
  for ( const [key, value] of Object.entries(defaults) ) config[key] ??= value;
}
