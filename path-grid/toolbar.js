/* globals Hooks, document, game, ui */
"use strict";

import { L10N, MODULE_ID, SETTINGS } from "./const.js";
import { getSetting, setEnabled } from "./settings.js";

/** Name of the toggle in the Token Controls palette. */
export const TOOL_ID = "pathGrid";

/** CSS class that swaps the Font Awesome glyph for the Material "grid_on" icon the phone app uses. */
const ICON_CLASS = "tpg-grid-icon";

/**
 * Material "grid_on" (a rounded square cut into a 3x3 grid), the icon the mobile app shows for this toggle.
 * Rendered through a CSS mask so it inherits the toolbar's colour. If the stylesheet fails to apply, the
 * Font Awesome `fa-border-all` glyph in the same element is still a 3x3 grid.
 */
const GRID_ON_SVG = "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><path d='M20 2H4c-1.1 0-2 .9-2 2v16"
  + "c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM8 20H4v-4h4v4zm0-6H4v-4h4v4zm0-6H4V4h4v4zm6 12h-4v-4h4v4z"
  + "m0-6h-4v-4h4v4zm0-6h-4V4h4v4zm6 12h-4v-4h4v4zm0-6h-4v-4h4v4zm0-6h-4V4h4v4z'/></svg>";

/** Add the stylesheet for {@link ICON_CLASS} once. */
function injectStyles() {
  const id = `${MODULE_ID}-toolbar-style`;
  if ( document.getElementById(id) ) return;
  const style = document.createElement("style");
  style.id = id;
  const mask = `url("data:image/svg+xml,${encodeURIComponent(GRID_ON_SVG)}") center / contain no-repeat`;
  // The class sits on whichever element carries the Font Awesome classes: a <button> in v13, an <i> in v12.
  style.textContent = `.${ICON_CLASS}::before {
  content: "";
  display: inline-block;
  flex: none;
  width: 1.15em;
  height: 1.15em;
  vertical-align: -0.15em;
  background-color: currentColor;
  -webkit-mask: ${mask};
  mask: ${mask};
}`;
  document.head.appendChild(style);
}

/**
 * Build the tool definition (shared by the v13 record and the v12 array shape).
 * @param {object} extra
 */
function toolData(extra) {
  return {
    name: TOOL_ID,
    title: `${L10N}.controls.toggle.title`,
    icon: `fa-solid fa-border-all ${ICON_CLASS}`,
    toggle: true,
    active: Boolean(getSetting(SETTINGS.ENABLED)),
    ...extra
  };
}

/**
 * Add the movement-grid toggle to the Token Controls. Called once during `init`, before the controls render.
 * Every user gets it, mirroring the (unrestricted) Alt+G keybinding.
 */
export function registerSceneControls() {
  injectStyles();

  Hooks.on("getSceneControlButtons", controls => {
    // v12 passes an array of controls whose tools are arrays; the token layer is called "token".
    if ( Array.isArray(controls) ) {
      const control = controls.find(c => c.name === "token");
      if ( !control || !Array.isArray(control.tools) ) return;
      control.tools = control.tools.filter(t => t.name !== TOOL_ID);
      control.tools.push(toolData({onClick: toggled => setEnabled(toggled)}));
      return;
    }

    // v13+ passes a record of controls keyed by name ("tokens") whose tools are a record as well.
    const control = controls?.tokens ?? controls?.token;
    if ( !control?.tools || (typeof control.tools !== "object") ) return;
    const order = Object.values(control.tools).reduce((max, t) => Math.max(max, Number(t?.order) || 0), 0) + 1;
    control.tools[TOOL_ID] = toolData({order, onChange: (event, active) => setEnabled(active)});
  });
}

/**
 * Re-render the scene controls so the button's pressed state matches the setting.
 * Safe to call at any time, including before the controls have rendered for the first time.
 */
export function refreshSceneControls() {
  const controls = ui?.controls;
  if ( !controls ) return;
  try {
    if ( Array.isArray(controls.controls) ) {
      // v12: the control set is built once in `initialize`, so update the tool in place.
      const tool = controls.controls.find(c => c.name === "token")?.tools?.find(t => t.name === TOOL_ID);
      if ( tool ) tool.active = Boolean(getSetting(SETTINGS.ENABLED));
      controls.render();
    } else if ( controls.rendered ) {
      // v13+: `reset` makes the application rebuild its controls, which runs the hook above again.
      controls.render({reset: true});
    }
  } catch(err) {
    console.warn(`${MODULE_ID} | Could not refresh the scene controls`, err);
  }
}
