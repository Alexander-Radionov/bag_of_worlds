/* globals foundry, game */
"use strict";

import { HOST_ID, L10N, LEGACY_ID, SETTINGS, TOKENS_BLOCK_CHOICES, TERRAIN_CHOICES } from "./const.js";

/**
 * The storage key of a setting. The movement grid lives inside the bridge package, so its keys are
 * prefixed (`enabled` -> `pathGridEnabled`) to stay clear of the bridge's own settings.
 * @param {string} key    One of {@link SETTINGS}
 * @returns {string}
 */
export function settingKey(key) {
  return `pathGrid${key.charAt(0).toUpperCase()}${key.slice(1)}`;
}

/** Scope of every setting registered here, by logical name; used by {@link migrateLegacySettings}. */
const SCOPES = new Map();

/** Register one setting under the host package. */
function register(key, data) {
  SCOPES.set(key, data.scope);
  game.settings.register(HOST_ID, settingKey(key), data);
}

/**
 * Read a module setting.
 * @param {string} key    One of {@link SETTINGS}
 * @returns {*}
 */
export function getSetting(key) {
  return game.settings.get(HOST_ID, settingKey(key));
}

/**
 * Write a module setting.
 * @param {string} key    One of {@link SETTINGS}
 * @param {*} value
 * @returns {Promise<*>}
 */
export function setSetting(key, value) {
  return game.settings.set(HOST_ID, settingKey(key), value);
}

/**
 * Carry over what the standalone "token-path-grid" module had saved, once per browser (client settings)
 * and once per world (world settings, performed by a GM). A value is only copied when the new setting has
 * never been saved, so it is safe to run on every load and never overwrites a choice made since.
 * The old values are left in place, so reinstalling the standalone module loses nothing.
 */
export async function migrateLegacySettings() {
  const storage = globalThis.localStorage;
  const world = game.settings.storage?.get?.("world");
  for ( const [key, scope] of SCOPES ) {
    try {
      const legacyKey = `${LEGACY_ID}.${key}`;
      const newKey = `${HOST_ID}.${settingKey(key)}`;
      let value;
      if ( scope === "client" ) {
        const raw = storage?.getItem(legacyKey);
        if ( (raw == null) || (storage.getItem(newKey) != null) ) continue;
        value = JSON.parse(raw);
      } else if ( scope === "world" ) {
        if ( !game.user?.isGM || !world ) continue;
        const legacy = world.getSetting?.(legacyKey);
        if ( !legacy || world.getSetting?.(newKey) ) continue;
        value = legacy.value; // Already parsed by the Setting document
      } else continue;
      await game.settings.set(HOST_ID, settingKey(key), value);
    } catch(err) {
      console.warn(`token-path-grid | Could not migrate the "${key}" setting`, err);
    }
  }
}

/**
 * Switch the movement grid on or off. The single code path shared by the Alt+G keybinding and the
 * scene-controls button. The setting's `onChange` redraws the grid and the button, so every route that
 * flips the setting (including the settings dialog) ends up consistent.
 * @param {boolean} enabled
 * @returns {Promise<*>}
 */
export function setEnabled(enabled) {
  return setSetting(SETTINGS.ENABLED, Boolean(enabled));
}

/**
 * Flip the movement grid.
 * @returns {Promise<*>}
 */
export function toggleEnabled() {
  return setEnabled(!getSetting(SETTINGS.ENABLED));
}

/**
 * Register every setting this module owns. Called once during `init`.
 * @param {object} [callbacks]
 * @param {Function} [callbacks.onEnabledChange]   Invoked after the `enabled` setting changes, by any route
 */
export function registerSettings({onEnabledChange}={}) {
  const L = key => `${L10N}.settings.${key}`;

  register(SETTINGS.ENABLED, {
    name: L(`${SETTINGS.ENABLED}.name`),
    hint: L(`${SETTINGS.ENABLED}.hint`),
    scope: "client",
    config: true,
    type: Boolean,
    default: true,
    requiresReload: false,
    onChange: () => onEnabledChange?.()
  });

  register(SETTINGS.MAX_MULTIPLIER, {
    name: L(`${SETTINGS.MAX_MULTIPLIER}.name`),
    hint: L(`${SETTINGS.MAX_MULTIPLIER}.hint`),
    scope: "world",
    config: true,
    type: new foundry.data.fields.NumberField({min: 1, max: 5, step: 0.5, initial: 2, nullable: false}),
    default: 2
  });

  register(SETTINGS.COLOR_NORMAL, {
    name: L(`${SETTINGS.COLOR_NORMAL}.name`),
    hint: L(`${SETTINGS.COLOR_NORMAL}.hint`),
    scope: "client",
    config: true,
    type: new foundry.data.fields.ColorField({required: true, nullable: false, initial: "#33bbff"}),
    default: "#33bbff"
  });

  register(SETTINGS.COLOR_DASH, {
    name: L(`${SETTINGS.COLOR_DASH}.name`),
    hint: L(`${SETTINGS.COLOR_DASH}.hint`),
    scope: "client",
    config: true,
    type: new foundry.data.fields.ColorField({required: true, nullable: false, initial: "#f1d836"}),
    default: "#f1d836"
  });

  register(SETTINGS.ALPHA, {
    name: L(`${SETTINGS.ALPHA}.name`),
    hint: L(`${SETTINGS.ALPHA}.hint`),
    scope: "client",
    config: true,
    type: new foundry.data.fields.NumberField({min: 0.05, max: 1, step: 0.05, initial: 0.25, nullable: false}),
    default: 0.25
  });

  register(SETTINGS.BORDERS, {
    name: L(`${SETTINGS.BORDERS}.name`),
    hint: L(`${SETTINGS.BORDERS}.hint`),
    scope: "client",
    config: true,
    type: Boolean,
    default: true
  });

  register(SETTINGS.TOKENS_BLOCK, {
    name: L(`${SETTINGS.TOKENS_BLOCK}.name`),
    hint: L(`${SETTINGS.TOKENS_BLOCK}.hint`),
    scope: "world",
    config: true,
    type: String,
    choices: {
      [TOKENS_BLOCK_CHOICES.NONE]: L(`${SETTINGS.TOKENS_BLOCK}.choices.none`),
      [TOKENS_BLOCK_CHOICES.HOSTILE]: L(`${SETTINGS.TOKENS_BLOCK}.choices.hostile`),
      [TOKENS_BLOCK_CHOICES.ALL]: L(`${SETTINGS.TOKENS_BLOCK}.choices.all`),
      [TOKENS_BLOCK_CHOICES.FOLLOW]: L(`${SETTINGS.TOKENS_BLOCK}.choices.elevationruler`)
    },
    default: TOKENS_BLOCK_CHOICES.HOSTILE
  });

  register(SETTINGS.USE_HISTORY, {
    name: L(`${SETTINGS.USE_HISTORY}.name`),
    hint: L(`${SETTINGS.USE_HISTORY}.hint`),
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  register(SETTINGS.TERRAIN, {
    name: L(`${SETTINGS.TERRAIN}.name`),
    hint: L(`${SETTINGS.TERRAIN}.hint`),
    scope: "world",
    config: true,
    type: String,
    choices: {
      [TERRAIN_CHOICES.AUTO]: L(`${SETTINGS.TERRAIN}.choices.auto`),
      [TERRAIN_CHOICES.ALWAYS]: L(`${SETTINGS.TERRAIN}.choices.always`),
      [TERRAIN_CHOICES.NEVER]: L(`${SETTINGS.TERRAIN}.choices.never`)
    },
    default: TERRAIN_CHOICES.AUTO
  });

  register(SETTINGS.CLICK_TO_MOVE, {
    name: L(`${SETTINGS.CLICK_TO_MOVE}.name`),
    hint: L(`${SETTINGS.CLICK_TO_MOVE}.hint`),
    scope: "client",
    config: true,
    type: Boolean,
    default: true
  });

  register(SETTINGS.CONFIRM_DASH, {
    name: L(`${SETTINGS.CONFIRM_DASH}.name`),
    hint: L(`${SETTINGS.CONFIRM_DASH}.hint`),
    scope: "client",
    config: true,
    type: Boolean,
    default: false
  });

  register(SETTINGS.MAX_CELLS, {
    name: L(`${SETTINGS.MAX_CELLS}.name`),
    hint: L(`${SETTINGS.MAX_CELLS}.hint`),
    scope: "world",
    config: true,
    type: new foundry.data.fields.NumberField({min: 100, max: 40000, step: 100, initial: 6000, nullable: false}),
    default: 6000
  });
}
