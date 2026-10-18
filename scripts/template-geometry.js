// Pure geometry for measured templates. No Foundry globals are touched at
// import time, so this module is unit-testable under plain Node.
//
// Why it exists: on Foundry v14 a MeasuredTemplate is a compatibility view over
// a Region (flag `core.MeasuredTemplate`). `MeasuredTemplateDocument._fromRegion`
// is static and reads `this.parent?.grid`, which is always undefined there, so
// it converts the Region's pixel shape to distance with the DEFAULT grid
// (100 px / 5 ft) instead of the scene grid. On a 140-px-grid scene a 20-ft
// sphere (radius 560 px) therefore reports `distance` 28. The Region shape is
// the truth, so when a backing Region exists we derive everything from it,
// in pixels, with the scene grid. Without one (v12/v13 real template
// documents) the document fields are used as-is.

const CORE_FLAG_SCOPE = "core";
const CORE_FLAG_KEY = "MeasuredTemplate";

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function firstShape(region) {
  const shapes = region?.shapes;
  if (!shapes) return null;
  if (typeof shapes.at === "function") return shapes.at(0) ?? null;
  return shapes[0] ?? null;
}

/**
 * The Region backing a v14 compatibility template, or null (v12/v13, or a
 * Region that is not a template).
 * @param {{id?: string}} templateDoc
 * @param {{regions?: {get?: (id: string) => any}}} scene
 */
export function regionForTemplate(templateDoc, scene) {
  const id = templateDoc?.id;
  if (!id) return null;
  let region = null;
  try {
    region = scene?.regions?.get?.(id) ?? null;
  } catch {
    region = null;
  }
  if (!region) return null;
  const flagged =
    typeof region.getFlag === "function"
      ? region.getFlag(CORE_FLAG_SCOPE, CORE_FLAG_KEY)
      : region.flags?.[CORE_FLAG_SCOPE]?.[CORE_FLAG_KEY];
  if (!flagged) return null;
  return firstShape(region) ? region : null;
}

function floorTo90(rotation) {
  const r = ((num(rotation) % 360) + 360) % 360;
  return Math.floor(r / 90) * 90;
}

/**
 * Geometry of a template, grid-correct.
 *
 * @param {object} templateDoc  the template document (v12/v13) or v14 compat view
 * @param {object|null} region  backing Region (see regionForTemplate), or null
 * @param {object} grid         the scene grid: size, sizeX?, sizeY?, distance, isGridless?, measurePath?
 * @returns {{
 *   source: "region"|"document", t: string, x: number, y: number,
 *   distance: number, direction: number, angle: number, width: number,
 *   radiusPx: number, lengthPx: number, widthPx: number, heightPx: number, rayWidthPx: number
 * }} distance/width are in scene units (e.g. feet); *Px are scene pixels, unrounded.
 */
export function templateGeometry(templateDoc, region, grid) {
  const cellDist = num(grid?.distance) || 5;
  const cellSize = num(grid?.size) || num(grid?.sizeX) || 1;
  const sxGrid = num(grid?.sizeX) || cellSize;
  const syGrid = num(grid?.sizeY) || cellSize;
  const unitsToPxX = sxGrid / cellDist;
  const unitsToPxY = syGrid / cellDist;
  const shape = firstShape(region);

  let t;
  let x;
  let y;
  let distance = 0;
  let direction = 0;
  let angle = 0;
  let width = 0;
  let radiusPx = 0;
  let lengthPx = 0;
  let widthPx = 0;
  let heightPx = 0;
  let rayWidthPx;
  let source;

  if (shape) {
    source = "region";
    // Foundry's own px-per-unit constant, but with the SCENE grid.
    const ppu = cellSize / cellDist;
    x = num(shape.x);
    y = num(shape.y);
    switch (shape.type) {
      case "circle": {
        t = "circle";
        radiusPx = num(shape.radius);
        lengthPx = radiusPx;
        distance = radiusPx / ppu;
        break;
      }
      case "cone": {
        t = "cone";
        radiusPx = num(shape.radius);
        lengthPx = radiusPx;
        distance = radiusPx / ppu;
        direction = num(shape.rotation);
        angle = num(shape.angle);
        break;
      }
      case "rectangle": {
        t = "rect";
        const w0 = num(shape.width);
        const h0 = num(shape.height);
        // Gridless metric unless the shape is grid-based on a real grid
        // (Foundry swaps in a gridless grid of the same size/distance otherwise).
        const gridMeasured =
          shape.gridBased === true && !grid?.isGridless && typeof grid?.measurePath === "function";
        const measure = (dx, dy) =>
          gridMeasured
            ? num(grid.measurePath([{ x: 0, y: 0 }, { x: dx, y: dy }]).distance)
            : Math.hypot(dx, dy) / ppu;
        distance = measure(w0, h0);
        let w = measure(w0, 0);
        let h = measure(0, h0);
        let wPx = w0;
        let hPx = h0;
        // Same sign/swap table as MeasuredTemplateDocument._fromRegion.
        const rotation = floorTo90(shape.rotation);
        if (rotation === 90) {
          [w, h] = [-h, w];
          [wPx, hPx] = [-h0, w0];
        } else if (rotation === 180) {
          [w, h] = [-w, -h];
          [wPx, hPx] = [-w0, -h0];
        } else if (rotation === 270) {
          [w, h] = [h, -w];
          [wPx, hPx] = [h0, -w0];
        }
        direction = (Math.atan2(h, w) * 180) / Math.PI;
        widthPx = Math.abs(wPx);
        heightPx = Math.abs(hPx);
        // The app rebuilds the rect from its diagonal (lengthPx) and direction.
        lengthPx = Math.hypot(wPx, hPx);
        break;
      }
      case "line": {
        t = "ray";
        lengthPx = num(shape.length);
        distance = lengthPx / ppu;
        direction = num(shape.rotation);
        width = num(shape.width) / ppu;
        widthPx = sxGrid;
        heightPx = lengthPx;
        break;
      }
      default: {
        t = "circle";
        break;
      }
    }
    rayWidthPx = (width || cellDist) * unitsToPxX;
  } else {
    source = "document";
    t = templateDoc?.t ?? "circle";
    x = num(templateDoc?.x);
    y = num(templateDoc?.y);
    distance = num(templateDoc?.distance);
    direction = num(templateDoc?.direction);
    angle = num(templateDoc?.angle);
    width = num(templateDoc?.width);
    lengthPx = distance * unitsToPxX;
    if (t === "rect") {
      // `distance` is the diagonal and `direction` its angle; the sides are its projections.
      const rad = (direction * Math.PI) / 180;
      widthPx = Math.abs(Math.cos(rad)) * distance * unitsToPxX;
      heightPx = Math.abs(Math.sin(rad)) * distance * unitsToPxY;
    } else if (t === "ray") {
      widthPx = sxGrid;
      heightPx = distance * unitsToPxY;
    } else {
      radiusPx = distance * unitsToPxX;
    }
    rayWidthPx = (width || cellDist) * unitsToPxX;
  }

  return { source, t, x, y, distance, direction, angle, width, radiusPx, lengthPx, widthPx, heightPx, rayWidthPx };
}
