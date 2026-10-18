/* globals game */
"use strict";

/**
 * Public identity of the movement grid: the name of its API, hooks (`token-path-grid.refresh`),
 * `CONFIG["token-path-grid"]` and console prefix. Kept from the standalone "token-path-grid" module so
 * macros and integrations written against it keep working.
 */
export const MODULE_ID = "token-path-grid";

/**
 * The package this code ships inside. Settings, the keybinding, localisation and the libWrapper id live
 * under it, because Foundry only knows installed packages ("token-path-grid" no longer is one).
 */
export const HOST_ID = "bag-of-worlds";

/** The id the host package had before the "Bag of Worlds" rename; the old module, if still active, owns its own grid. */
export const LEGACY_HOST_ID = "foundry-mobile-bridge";

/** Localisation prefix of everything this code shows to the user (see languages/*.json). */
export const L10N = `${HOST_ID}.pathGrid`;

/** The standalone module this code used to be, whose saved client/world settings are migrated once. */
export const LEGACY_ID = MODULE_ID;

/** Name of the grid highlight layer this module owns. */
export const HIGHLIGHT_LAYER = `${MODULE_ID}.reachable`;

/** Floating point slack used when comparing accumulated movement costs. */
export const EPSILON = 1e-6;

/** Reachability tiers, ordered from cheapest to most expensive. */
export const TIERS = {
  NORMAL: "normal",
  DASH: "dash"
};

export const SETTINGS = {
  ENABLED: "enabled",
  MAX_MULTIPLIER: "maxMultiplier",
  COLOR_NORMAL: "colorNormal",
  COLOR_DASH: "colorDash",
  ALPHA: "alpha",
  BORDERS: "borders",
  TOKENS_BLOCK: "tokensBlock",
  USE_HISTORY: "useHistory",
  TERRAIN: "terrain",
  CLICK_TO_MOVE: "clickToMove",
  CONFIRM_DASH: "confirmDash",
  MAX_CELLS: "maxCells"
};

export const TOKENS_BLOCK_CHOICES = {
  NONE: "none",
  HOSTILE: "hostile",
  ALL: "all",
  /** Defer to Elevation Ruler's own obstacle model, including its difficulty multipliers. */
  FOLLOW: "elevationruler"
};

export const TERRAIN_CHOICES = {
  AUTO: "auto",
  ALWAYS: "always",
  NEVER: "never"
};

/** Modules whose configuration this module honours when they are active. */
export const OTHER_MODULES = {
  ELEVATION_RULER: { KEY: "elevationruler", ACTIVE: false, API: null }
};

/**
 * Refresh the cached activity state of complementary modules.
 * Called on `init`, because `game.modules` is not populated before then.
 */
export function refreshOtherModules() {
  for ( const entry of Object.values(OTHER_MODULES) ) {
    const module = game.modules.get(entry.KEY);
    entry.ACTIVE = module?.active ?? false;
    entry.API = module?.api ?? null;
  }
}
