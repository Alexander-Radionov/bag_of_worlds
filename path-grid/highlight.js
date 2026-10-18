/* globals Color, canvas */
"use strict";

import { HIGHLIGHT_LAYER, SETTINGS, TIERS } from "./const.js";
import { getSetting } from "./settings.js";

/**
 * Resolve the fill colour for a tier.
 * @param {string} tier   A {@link TIERS} value
 * @returns {number}      A PIXI colour value
 */
export function tierColor(tier) {
  const hex = tier === TIERS.DASH ? getSetting(SETTINGS.COLOR_DASH) : getSetting(SETTINGS.COLOR_NORMAL);
  return Color.from(hex).valueOf();
}

/**
 * Make sure the module's highlight layer exists.
 * @returns {GridHighlight|void}
 */
export function ensureLayer() {
  return canvas.interface?.grid?.addHighlightLayer(HIGHLIGHT_LAYER);
}

/**
 * Remove every highlighted space this module drew.
 */
export function clearHighlight() {
  canvas.interface?.grid?.clearHighlightLayer(HIGHLIGHT_LAYER);
}

/**
 * Tear the highlight layer down entirely, e.g. when the canvas is replaced.
 */
export function destroyLayer() {
  canvas.interface?.grid?.destroyHighlightLayer(HIGHLIGHT_LAYER);
}

/**
 * Draw a reachability result onto the canvas.
 * Spaces are drawn cheapest-first so that, where the two tiers touch, the normal-movement colour wins.
 * @param {ReachabilityResult} result   The result to draw
 */
export function drawReachability(result) {
  const grid = canvas.interface?.grid;
  if ( !grid ) return;
  ensureLayer();
  clearHighlight();
  if ( !result || (result.cells.size === 0) ) return;

  const alpha = getSetting(SETTINGS.ALPHA);
  const drawBorders = getSetting(SETTINGS.BORDERS);
  const colors = {
    [TIERS.NORMAL]: tierColor(TIERS.NORMAL),
    [TIERS.DASH]: tierColor(TIERS.DASH)
  };

  const ordered = [...result.cells.values()].sort((a, b) => a.stepCost - b.stepCost);
  for ( const cell of ordered ) {
    const color = colors[cell.tier];
    grid.highlightPosition(HIGHLIGHT_LAYER, {
      x: cell.x,
      y: cell.y,
      color,
      border: drawBorders ? color : null,
      // Spaces that are already occupied can be crossed but not stopped on: show them faded.
      alpha: cell.canStop ? alpha : (alpha * 0.4)
    });
  }
}
