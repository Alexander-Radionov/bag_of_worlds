/* globals CONFIG, CONST, canvas, foundry, performance */
"use strict";

import { EPSILON, MODULE_ID, SETTINGS, TERRAIN_CHOICES, TIERS } from "./const.js";
import { getSetting } from "./settings.js";
import { actionRespectsWalls, buildOccupancyMap, stepBlockedByWalls } from "./blocking.js";
import { resolveBudget } from "./speed.js";

/**
 * A binary min-heap over integer state ids keyed by accumulated cost.
 * Supports lazy deletion: a state may be pushed more than once and stale entries are skipped by
 * comparing the popped cost against the best known cost for that state.
 */
class CostHeap {
  #states = [];

  #costs = [];

  get size() { return this.#states.length; }

  push(state, cost) {
    const states = this.#states;
    const costs = this.#costs;
    let i = states.length;
    states.push(state);
    costs.push(cost);
    while ( i > 0 ) {
      const parent = (i - 1) >> 1;
      if ( costs[parent] <= costs[i] ) break;
      [states[parent], states[i]] = [states[i], states[parent]];
      [costs[parent], costs[i]] = [costs[i], costs[parent]];
      i = parent;
    }
  }

  /** @returns {{state: number, cost: number}|null} */
  pop() {
    const states = this.#states;
    const costs = this.#costs;
    const n = states.length;
    if ( n === 0 ) return null;
    const result = {state: states[0], cost: costs[0]};
    const lastState = states.pop();
    const lastCost = costs.pop();
    if ( n === 1 ) return result;
    states[0] = lastState;
    costs[0] = lastCost;
    let i = 0;
    for ( ;; ) {
      const l = (i << 1) + 1;
      const r = l + 1;
      let smallest = i;
      if ( (l < states.length) && (costs[l] < costs[smallest]) ) smallest = l;
      if ( (r < states.length) && (costs[r] < costs[smallest]) ) smallest = r;
      if ( smallest === i ) break;
      [states[smallest], states[i]] = [states[i], states[smallest]];
      [costs[smallest], costs[i]] = [costs[i], costs[smallest]];
      i = smallest;
    }
    return result;
  }
}

/* -------------------------------------------- */

/**
 * The pixel offset from a token's top-left to its movement anchor.
 * Replicates the anchor `TokenDocument#measureMovementPath` uses, so the grid offsets fed to the
 * movement cost function are the ones core would have produced.
 * @param {TokenDocument} doc   The token document
 * @returns {{x: number, y: number}}
 */
function anchorOffset(doc) {
  const grid = canvas.grid;
  if ( grid.isGridless ) return {x: 0, y: 0};
  const width = Math.max(Math.round(doc._source.width * 2) / 2, 0.5);
  const height = Math.max(Math.round(doc._source.height * 2) / 2, 0.5);
  if ( grid.isSquare ) {
    return {
      x: grid.size * (Number.isInteger(width) ? 0.5 : 0.25),
      y: grid.size * (Number.isInteger(height) ? 0.5 : 0.25)
    };
  }
  const {anchor} = foundry.documents.BaseToken._getHexagonalOffsets(width, height, doc._source.shape, grid.columns);
  return {x: grid.sizeX * anchor.x, y: grid.sizeY * anchor.y};
}

/**
 * Does this scene contain regions that could change movement cost?
 * Resolving terrain per step is by far the most expensive part of the search, and scenes without any
 * active region behaviour cannot produce terrain at all, so the whole step is skipped there.
 * @returns {boolean}
 */
function sceneHasMovementRegions() {
  for ( const region of canvas.scene?.regions ?? [] ) {
    for ( const behavior of region.behaviors ) {
      if ( !behavior.disabled ) return true;
    }
  }
  return false;
}

/**
 * The normalised distance multiplier of a single grid step.
 * Mirrors the `k` computed inside `SquareGrid` and `HexagonalGrid` when they measure a path.
 * @param {boolean} isDiagonal    Does the step change both row and column?
 * @param {number} diagonals      Number of diagonal steps performed before this one
 * @returns {number}
 */
function stepMultiplier(isDiagonal, diagonals) {
  if ( !isDiagonal ) return 1;
  switch ( canvas.grid.diagonals ) {
    case CONST.GRID_DIAGONALS.EQUIDISTANT: return 1;
    case CONST.GRID_DIAGONALS.EXACT: return Math.SQRT2;
    case CONST.GRID_DIAGONALS.APPROXIMATE: return 1.5;
    case CONST.GRID_DIAGONALS.RECTILINEAR: return 2;
    case CONST.GRID_DIAGONALS.ALTERNATING_1:
    case CONST.GRID_DIAGONALS.ALTERNATING_2:
      return 1 + (Math.floor((diagonals + 1) / 2) - Math.floor(diagonals / 2));
    default: return 1;
  }
}

/**
 * Wrap a single-space movement cost function so it accounts for tokens larger than one grid space,
 * the same way core does before handing the function to the grid.
 * @param {Function} cost           The single-space cost function
 * @param {TokenDocument} doc       The moving token's document
 * @returns {Function}
 */
function forTokenSize(cost, doc) {
  const grid = canvas.grid;
  const {width, height, depth} = doc._source;
  if ( grid.isGridless ) return cost;
  if ( (width === height) && (height === depth) && (depth <= 1) ) return cost;
  if ( !grid.isSquare ) return cost; // Hexagonal expansion depends on core internals; single-space is a safe floor.

  const aggregator = CONFIG.Token.movement.costAggregator;
  const w = Math.ceil(Math.max(Math.round(width * 2) / 2, 0.5));
  const h = Math.ceil(Math.max(Math.round(height * 2) / 2, 0.5));
  const d = Math.ceil(Math.max(Math.round(depth * 2) / 2, 0.5));
  return (from, to, distance, segment) => {
    const results = [];
    for ( let di = 0; di < h; di++ ) {
      for ( let dj = 0; dj < w; dj++ ) {
        for ( let dk = 0; dk < d; dk++ ) {
          const o0 = {i: from.i + di, j: from.j + dj, k: from.k + dk};
          const o1 = {i: to.i + di, j: to.j + dj, k: to.k + dk};
          results.push({from: o0, to: o1, cost: cost(o0, o1, distance, segment)});
        }
      }
    }
    return aggregator(results, distance, segment);
  };
}

/**
 * Resolve the terrain that applies to a single grid step, taking the harshest terrain the step crosses.
 *
 * The question asked is "what does this one step cross", but the answer is not always about that step.
 * Modules that constrain elevation — Terrain Mapper wraps this very method — reply with a *rewritten*
 * route: intermediate waypoints that climb plateaus and ramps, at elevations the step never visits, and
 * sometimes ending somewhere other than where it was asked about. Billing a step for the harshest thing
 * on a climb it does not make is wrong on its own, and it lands unevenly: a diagonal brushes more
 * surfaces than an orthogonal step, so diagonals are charged more often, and the search abandons them
 * for staircases along the axes.
 *
 * This search is planar by design (see `computeReachability`), so only what stays in the plane counts.
 *
 * @param {Token} token   The moving token
 * @param {object} from   Waypoint the step starts at
 * @param {object} to     Waypoint the step ends at
 * @returns {object|null} Terrain data, or null when the step crosses no terrain
 */
function terrainForStep(token, from, to) {
  let path;
  try {
    path = token.createTerrainMovementPath([from, to]);
  } catch(err) {
    console.warn(`${MODULE_ID} | Terrain resolution failed`, err);
    return null;
  }

  // An answer that ends somewhere else describes a different move, not this one.
  const end = path.at(-1);
  if ( !end || !samePlanarPoint(end, to) ) return null;

  const elevation = to.elevation ?? from.elevation ?? 0;
  let worst = null;
  for ( let i = 1; i < path.length; i++ ) {
    const point = path[i];
    if ( (point.elevation != null) && (Math.abs(point.elevation - elevation) > EPSILON) ) continue;
    const terrain = point.terrain;
    if ( !terrain ) continue;
    if ( !worst || ((terrain.difficulty ?? 1) > (worst.difficulty ?? 1)) ) worst = terrain;
  }
  return worst;
}

/**
 * Do two waypoints name the same spot on the canvas, ignoring elevation?
 * Pixel coordinates survive a round trip through region maths with rounding error, so an exact
 * comparison would reject paths that did in fact arrive.
 * @param {{x: number, y: number}} a
 * @param {{x: number, y: number}} b
 * @returns {boolean}
 */
function samePlanarPoint(a, b) {
  return (Math.abs(a.x - b.x) < 1) && (Math.abs(a.y - b.y) < 1);
}

/* -------------------------------------------- */

/**
 * @typedef {object} ReachableCell
 * @property {number} i           Grid row of the space
 * @property {number} j           Grid column of the space
 * @property {number} x           Top-left x of the space, in pixels
 * @property {number} y           Top-left y of the space, in pixels
 * @property {number} cost        Cumulative movement cost this turn if the token stops here
 * @property {number} stepCost    Cost from the token's current position, excluding movement already spent
 * @property {string} tier        A {@link TIERS} value: "normal" or "dash"
 * @property {boolean} canStop    False when another token already occupies the space
 * @property {{x: number, y: number, elevation: number}} position   Token top-left position for this space
 */

/**
 * @typedef {object} ReachabilityResult
 * @property {Token} token
 * @property {string} action
 * @property {MovementBudget|null} budget
 * @property {{i: number, j: number}|null} origin    The token's own grid offset
 * @property {Map<string, ReachableCell>} cells      Reachable spaces keyed by `"i,j"`
 * @property {number} explored                       Number of search states expanded
 * @property {number} elapsedMS                      Wall clock time the search took
 * @property {string|null} unavailable               Why the grid is empty, when it is
 * @property {(i: number, j: number) => object[]|null} getPath   Movement waypoints to a reachable space
 */

/**
 * Compute every grid space the token can reach with the movement it has left.
 *
 * The search is a single Dijkstra flood fill over grid spaces starting at the token, bounded by
 * `speed * maxMultiplier`. Step costs come from `Token#_getMovementCostFunction` — the same function
 * core uses when measuring a drag, and the one Elevation Ruler and Terrain Mapper patch — so the numbers
 * agree with the drag ruler. Walls are tested with `Token#checkCollision`, the test core itself performs
 * while constraining movement.
 *
 * @param {Token} token                        The token to plan movement for
 * @param {object} [options]
 * @param {string} [options.action]            Movement action; defaults to the token's current action
 * @param {number} [options.maxMultiplier]     Speed multiple to search to; defaults to the setting
 * @param {boolean} [options.includeHistory]   Account for movement already spent this turn
 * @param {number} [options.speed]             Override the resolved speed, in grid units
 * @param {string} [options.terrain]           One of {@link TERRAIN_CHOICES}
 * @param {number} [options.maxCells]          Hard cap on the number of grid spaces searched
 * @returns {ReachabilityResult}
 */
export function computeReachability(token, options={}) {
  const t0 = performance.now();
  const grid = canvas.grid;
  const doc = token.document;
  const empty = reason => ({
    token, action: options.action ?? doc.movementAction, budget: null, origin: null,
    cells: new Map(), explored: 0, elapsedMS: performance.now() - t0, unavailable: reason,
    getPath: () => null
  });

  if ( grid.isGridless ) return empty("gridless");

  const budget = resolveBudget(token, {
    action: options.action,
    maxMultiplier: options.maxMultiplier ?? getSetting(SETTINGS.MAX_MULTIPLIER),
    includeHistory: options.includeHistory ?? getSetting(SETTINGS.USE_HISTORY),
    speed: options.speed
  });
  if ( budget.speed === null ) return {...empty("no-speed"), budget};
  if ( !(budget.remaining > 0) ) return {...empty("no-movement-left"), budget};

  const action = budget.action;
  const source = doc._source;
  const anchor = anchorOffset(doc);
  const elevation = source.elevation;
  const gridDistance = grid.distance;

  // Origin offset: the grid space containing the token's movement anchor.
  const originOffset = grid.getOffset({x: source.x + anchor.x, y: source.y + anchor.y, elevation});
  const originK = originOffset.k ?? 0;
  const originTopLeft = grid.getTopLeftPoint({i: originOffset.i, j: originOffset.j});
  // Preserve any sub-space offset the token has, so destinations keep the same alignment.
  const alignX = source.x - originTopLeft.x;
  const alignY = source.y - originTopLeft.y;

  // Search box: as many spaces in each direction as the remaining budget could possibly pay for,
  // clipped to the canvas. Near an edge the box is simply cut short on that side.
  const rect = canvas.dimensions.rect;
  const lo = grid.getOffset({x: rect.left, y: rect.top});
  const hi = grid.getOffset({x: rect.right - 1, y: rect.bottom - 1});
  const maxCells = options.maxCells ?? getSetting(SETTINGS.MAX_CELLS);
  const sideCap = Math.max(Math.floor((Math.sqrt(maxCells) - 1) / 2), 1);
  const radius = Math.min(Math.ceil(budget.remaining / gridDistance) + 1, sideCap);

  const minI = Math.max(originOffset.i - radius, lo.i);
  const maxI = Math.min(originOffset.i + radius, hi.i);
  const minJ = Math.max(originOffset.j - radius, lo.j);
  const maxJ = Math.min(originOffset.j + radius, hi.j);
  const boxW = maxJ - minJ + 1;
  const boxH = maxI - minI + 1;
  if ( (boxW <= 0) || (boxH <= 0) ) return {...empty("empty-search-box"), budget};

  const cellIndex = (i, j) => {
    if ( (i < minI) || (i > maxI) || (j < minJ) || (j > maxJ) ) return -1;
    return ((i - minI) * boxW) + (j - minJ);
  };

  // Alternating diagonal rules (5-10-5) make a diagonal cost depend on how many diagonals came before
  // it, so the search state carries that parity. Every other rule is memoryless.
  const alternating = (grid.diagonals === CONST.GRID_DIAGONALS.ALTERNATING_1)
    || (grid.diagonals === CONST.GRID_DIAGONALS.ALTERNATING_2);
  const nParities = alternating ? 2 : 1;
  const baseDiagonals = (grid.diagonals === CONST.GRID_DIAGONALS.ALTERNATING_2 ? 1 : 0)
    + Math.floor(budget.usedDiagonals);
  const startParity = alternating ? Math.abs(baseDiagonals % 2) : 0;

  const nStates = boxW * boxH * nParities;
  const dist = new Float64Array(nStates).fill(Infinity);
  const prev = new Int32Array(nStates).fill(-1);
  // Equal-cost routes are the rule rather than the exception on a grid, and Dijkstra alone would pick an
  // arbitrary one, producing paths that zig-zag across open floor. These carry a tie-break: among routes
  // of the same cost, prefer the one that changes direction least, then the one with fewest steps.
  const turns = new Int32Array(nStates);
  const steps = new Int32Array(nStates);
  const inbound = new Int8Array(nStates).fill(-1);
  /** Rank a route so that lower is straighter. */
  const rankOf = (t, s) => (t * 1e4) + s;
  const rank = new Float64Array(nStates).fill(Infinity);

  const {impassable, occupied, difficulty} = buildOccupancyMap(
    token,
    offset => cellIndex(offset.i, offset.j),
    {visibleTokenIds: options.visibleTokenIds}
  );

  const respectWalls = actionRespectsWalls(action);
  const actionConfig = CONFIG.Token.movement.actions[action] ?? CONFIG.Token.movement.actions.walk;
  const stepCost = forTokenSize(token._getMovementCostFunction({}), doc);

  const terrainMode = options.terrain ?? getSetting(SETTINGS.TERRAIN);
  const useTerrain = (terrainMode === TERRAIN_CHOICES.ALWAYS)
    || ((terrainMode === TERRAIN_CHOICES.AUTO) && sceneHasMovementRegions());

  /** Token top-left position for a grid offset. */
  const positionFor = (i, j) => {
    const tl = grid.getTopLeftPoint({i, j});
    return {x: tl.x + alignX, y: tl.y + alignY, elevation};
  };
  /** Movement origin (the collision reference point) for a grid offset. */
  const movementOriginFor = (i, j) => doc.getMovementOrigin({
    ...positionFor(i, j),
    width: source.width, height: source.height, depth: source.depth, shape: source.shape
  });

  const originCell = cellIndex(originOffset.i, originOffset.j);
  const originState = (originCell * nParities) + startParity;
  dist[originState] = 0;
  rank[originState] = 0;
  const heap = new CostHeap();
  heap.push(originState, 0);

  const limit = budget.remaining + EPSILON;
  let explored = 0;

  while ( heap.size > 0 ) {
    const popped = heap.pop();
    const state = popped.state;
    const cost = popped.cost;
    if ( cost > dist[state] + EPSILON ) continue; // Stale heap entry
    explored++;

    const cell = Math.floor(state / nParities);
    const parity = state - (cell * nParities);
    const i = minI + Math.floor(cell / boxW);
    const j = minJ + (cell % boxW);

    const fromOffset = {i, j, k: originK};
    const fromPosition = positionFor(i, j);
    const fromOrigin = respectWalls ? movementOriginFor(i, j) : null;

    for ( const neighbor of grid.getAdjacentOffsets({i, j}) ) {
      const ni = neighbor.i;
      const nj = neighbor.j;
      const nCell = cellIndex(ni, nj);
      if ( nCell < 0 ) continue;
      if ( impassable.has(nCell) ) continue;

      const isDiagonal = (ni !== i) && (nj !== j);
      // Only the parity of the diagonal counter affects the multiplier, so the parity carried by the
      // search state is a faithful stand-in for the full count.
      const k = stepMultiplier(isDiagonal, alternating ? parity : 0);
      const nParity = (alternating && isDiagonal) ? (parity ^ 1) : parity;
      const nState = (nCell * nParities) + nParity;

      const toPosition = positionFor(ni, nj);

      if ( respectWalls ) {
        const toOrigin = doc.getMovementOrigin({
          ...toPosition, width: source.width, height: source.height, depth: source.depth, shape: source.shape
        });
        if ( stepBlockedByWalls(token, fromOrigin, toOrigin) ) continue;
      }

      const terrain = useTerrain
        ? terrainForStep(token, {...fromPosition, action}, {...toPosition, action})
        : null;
      const segment = {
        action, actionConfig, terrain,
        teleport: actionConfig.teleport,
        measure: actionConfig.measure,
        width: source.width, height: source.height, depth: source.depth, shape: source.shape
      };
      let stepped = stepCost(fromOffset, {i: ni, j: nj, k: originK}, k * gridDistance, segment);
      if ( !Number.isFinite(stepped) || (stepped < 0) ) continue;
      // Crossing a space held by another token can cost extra (Elevation Ruler's difficulty model).
      const crowding = difficulty.get(nCell);
      if ( crowding ) stepped *= crowding;

      const next = cost + stepped;
      if ( next > limit ) continue;

      const direction = (((ni - i + 1) * 3) + (nj - j + 1));
      const nTurns = turns[state] + (((inbound[state] === -1) || (inbound[state] === direction)) ? 0 : 1);
      const nSteps = steps[state] + 1;
      const nRank = rankOf(nTurns, nSteps);

      const cheaper = next < dist[nState] - EPSILON;
      const straighter = (Math.abs(next - dist[nState]) <= EPSILON) && (nRank < rank[nState]);
      if ( !cheaper && !straighter ) continue;

      dist[nState] = next;
      rank[nState] = nRank;
      turns[nState] = nTurns;
      steps[nState] = nSteps;
      inbound[nState] = direction;
      prev[nState] = state;
      heap.push(nState, next);
    }
  }

  // Collapse the per-parity states into one entry per grid space, keeping the cheapest.
  const cells = new Map();
  const bestState = new Map();
  for ( let state = 0; state < nStates; state++ ) {
    const d = dist[state];
    if ( !Number.isFinite(d) ) continue;
    const cell = Math.floor(state / nParities);
    if ( cell === originCell ) continue; // The token's own space is not a destination
    const key = `${minI + Math.floor(cell / boxW)},${minJ + (cell % boxW)}`;
    const existing = cells.get(key);
    if ( existing ) {
      // Same space reached with the other diagonal parity: keep the cheaper one, then the straighter one.
      if ( existing.stepCost < d - EPSILON ) continue;
      if ( (Math.abs(existing.stepCost - d) <= EPSILON)
        && (rank[bestState.get(key)] <= rank[state]) ) continue;
    }
    const i = minI + Math.floor(cell / boxW);
    const j = minJ + (cell % boxW);
    const total = budget.used + d;
    const tl = grid.getTopLeftPoint({i, j});
    // The space this one is reached from. Carrying it on every cell makes the whole
    // predecessor tree readable from outside the search, so a consumer that only has
    // the serialised grid — a remote client, a macro — can still draw any route
    // without asking for it space by space.
    const parent = prev[state];
    let previous = null;
    if ( parent !== -1 ) {
      const parentCell = Math.floor(parent / nParities);
      previous = {i: minI + Math.floor(parentCell / boxW), j: minJ + (parentCell % boxW)};
    }
    cells.set(key, {
      i, j,
      x: tl.x,
      y: tl.y,
      cost: total,
      stepCost: d,
      tier: (total <= budget.normal + EPSILON) ? TIERS.NORMAL : TIERS.DASH,
      canStop: !occupied.has(cell),
      previous,
      position: positionFor(i, j)
    });
    bestState.set(key, state);
  }

  /**
   * Reconstruct the movement waypoints that reach a grid space.
   * @param {number} i
   * @param {number} j
   * @returns {object[]|null}
   */
  const getPath = (i, j) => {
    const target = bestState.get(`${i},${j}`);
    if ( target === undefined ) return null;
    const chain = [];
    for ( let state = target; state !== -1; state = prev[state] ) {
      const cell = Math.floor(state / nParities);
      chain.push({i: minI + Math.floor(cell / boxW), j: minJ + (cell % boxW)});
      if ( state === originState ) break;
    }
    chain.reverse();
    return buildWaypoints(chain, positionFor, action);
  };

  return {
    token, action, budget,
    origin: {i: originOffset.i, j: originOffset.j},
    cells, explored,
    elapsedMS: performance.now() - t0,
    unavailable: null,
    getPath
  };
}

/* -------------------------------------------- */

/**
 * Turn a chain of grid offsets into movement waypoints, dropping offsets that lie in the middle of a
 * straight run so the path carries a waypoint only where it changes direction.
 * @param {{i: number, j: number}[]} chain                 Offsets from origin to destination, inclusive
 * @param {(i: number, j: number) => object} positionFor   Offset to token position
 * @param {string} action                                  Movement action for every waypoint
 * @returns {object[]}                                     Waypoints suitable for `TokenDocument#move`
 */
function buildWaypoints(chain, positionFor, action) {
  const waypoints = [];
  for ( let n = 1; n < chain.length; n++ ) {
    const previous = chain[n - 1];
    const current = chain[n];
    const next = chain[n + 1];
    if ( next ) {
      const di0 = current.i - previous.i;
      const dj0 = current.j - previous.j;
      const di1 = next.i - current.i;
      const dj1 = next.j - current.j;
      if ( (di0 === di1) && (dj0 === dj1) ) continue; // Same direction: no waypoint needed
    }
    waypoints.push({
      ...positionFor(current.i, current.j),
      action,
      snapped: true,
      explicit: !next,
      checkpoint: !next
    });
  }
  return waypoints;
}
