# Token Path Grid (built into Bag of Worlds)

> This code ships inside the **Bag of Worlds** module (`bag-of-worlds/path-grid/`, formerly "Foundry Mobile Bridge"); install the
> module and the grid comes with it. It was the standalone `token-path-grid` module before. If that module is
> still installed **and active in the world**, it takes priority and the built-in copy stays off (one console
> notice at start-up); disable it to switch to the built-in one.
>
> What changed for the built-in copy: settings, the keybinding and the strings now live under the
> `bag-of-worlds` namespace (setting keys are prefixed, e.g. `pathGridEnabled`); saved values of the old
> `foundry-mobile-bridge` namespace and of the standalone module are copied over once. The API is `game.modules.get("bag-of-worlds").pathGrid`
> (the standalone module keeps `game.modules.get("token-path-grid").api`). Hook names
> (`token-path-grid.refresh`) and `CONFIG["token-path-grid"]` are unchanged. The text below keeps the
> standalone names.

Highlights every grid space the selected token can reach this turn, taking walls, terrain and other
tokens into account. Blue for normal movement, yellow for a dash. Clicking a highlighted space moves the
token there along the computed route — no dragging.

Built for **Foundry VTT v13–v14** (verified against 14.361) and **dnd5e 5.x**, with generic fallbacks for
other systems.

## How it works

For a reachability grid you need the cost of reaching *every* space, not the cost of one route between
two points. So the module runs a single **Dijkstra flood fill** over grid spaces outward from the token,
bounded by `speed × multiplier` (2 by default, i.e. a dash). Every route to every space falls out of one
search, and the movement path to any space is read straight off the search's predecessor tree.

The search does not reimplement Foundry's movement rules — it calls them:

| Concern | What is called |
| --- | --- |
| Cost of one grid step | `Token#_getMovementCostFunction()` |
| Terrain on a step | `Token#createTerrainMovementPath()` |
| Walls and surfaces | `Token#checkCollision()` |
| Tokens larger than one space | The same median-of-occupied-spaces aggregation core applies |
| Diagonals (equidistant, 5-10-5, exact, …) | The scene's `grid.diagonals` rule, including the alternating counter |
| Movement already spent this turn | `TokenDocument#movementHistory` |
| Actually moving | `TokenDocument#move()` |

## Elevation Ruler

Because the cost and terrain functions above are the ones **Elevation Ruler** and **Terrain Mapper**
patch, their rules apply automatically whenever those modules are active — the numbers here agree with
what the drag ruler shows. There is no hard dependency: everything works with Elevation Ruler absent.

Elevation Ruler 13.x contributes an async point-to-point A* wrapped around `Token#findMovementPath`.
That is the wrong shape for a reachability grid, which needs one flood fill rather than one A* per
destination space, so the search here is its own — but it is deliberately fed from the same inputs:

- `CONFIG.elevationruler.pathfindingIgnoreStatuses` decides which downed or ethereal tokens stop counting
  as obstacles.
- The disposition rules match Elevation Ruler's `tokenIsEnemy` exactly, including its less obvious cases:
  a `secret` token is an enemy of everyone, `neutral` and `hostile` *are* enemies of each other, and two
  `hostile` tokens are allies.
- Setting **Tokens block movement** to *Follow Elevation Ruler* hands the decision to Elevation Ruler's
  own `tokenTerrainValue`, including its friendly/hostile difficulty multipliers — spaces held by a
  creature then cost extra to cross rather than simply blocking. Note that Elevation Ruler treats any
  difficulty at or above its `IMPASSABLE` value of 3 as a hard block, and so does this, which matters if
  you set a token difficulty multiplier of 3 or more.

That last option reads a file that is not part of Elevation Ruler's public API
(`scripts/pathfinding/terrain_utils.js`). The import is guarded: if it ever moves, the module logs a
warning and falls back to its own rules.

Elevation Ruler 13.0.1 declares `verified: 13.351`. On Foundry v14 that yields `UNVERIFIED_GENERATION`,
which is *not* blocking — no `compatibility.maximum` is set — so it loads with a warning in the module
list.

### Route quality

Grids produce enormous numbers of equal-cost routes, and plain Dijkstra picks an arbitrary one — which
looks like a drunken zig-zag across open floor. Routes are therefore tie-broken on equal cost: fewest
direction changes first, then fewest steps. The resulting path carries a waypoint only where it actually
turns.

### Search bounds

The search box is `ceil(remaining / gridDistance) + 1` spaces in each direction, clipped to the canvas.
A token with 30 ft of speed on 5 ft spaces standing at (3, 3) searches 3 spaces up and left — that is all
the canvas there is — and 12 spaces down and right. The `maxCells` setting caps the box for very fast
tokens on very large scenes.

## Settings

Per-client: show the grid, colours, opacity, borders, click-to-move, confirm dash moves.
Per-world: search multiplier, which tokens block movement, whether to account for spent movement,
terrain resolution mode, and the search cap.

`Alt+G` or the grid button in the Token Controls toggles the grid.

## API

```js
const api = game.modules.get("token-path-grid").api;
```

### `api.computeReachability(token, options?) → ReachabilityResult`

The full result, with a live `Map` and a path callback.

```js
const result = api.computeReachability(token);
result.budget;        // {speed, used, normal, total, remaining, units, action}
result.origin;        // {i, j}
result.cells;         // Map<"i,j", ReachableCell>
result.getPath(i, j); // waypoints for TokenDocument#move, or null
result.unavailable;   // null, or "gridless" | "no-speed" | "no-movement-left" | ...
result.elapsedMS;
```

Each `ReachableCell`:

```js
{
  i, j,            // grid offset
  x, y,            // top-left of the space, in pixels
  cost,            // cumulative cost this turn if the token stops here
  stepCost,        // cost from the token's current position only
  tier,            // "normal" | "dash"
  canStop,         // false when another token already occupies the space
  previous,        // {i, j} the space this one is reached from, null at the origin
  position         // {x, y, elevation} the token would take
}
```

`previous` is the search's predecessor tree, exposed per cell. Following it back to the origin yields
the route to that space without a second search, which is what `getPath` does internally — and what a
consumer holding only the serialised grid can now do for itself.

Options: `action`, `maxMultiplier`, `includeHistory`, `speed`, `terrain`, `maxCells`. Anything omitted
falls back to the module settings.

### `api.getGrid(token, options?) → object`

The same data as plain, serialisable JSON — an array of cells rather than a `Map`, and no callbacks.
`previous` arrives flattened as `previousI` / `previousJ`. Convenient from macros or when the grid has
to be sent somewhere else — a client that has the cells can draw any route in the grid on its own.

### `api.getPath(token, i, j, options?) → waypoints|null`

### `api.moveToken(token, i, j, options?) → Promise<boolean>`

Moves the token along the computed route. `options.moveOptions` is forwarded to `TokenDocument#move`.

### Display

`api.refresh()`, `api.clear()`, `api.draw(result)`, `api.current`.

### Hooks

```js
Hooks.on("token-path-grid.refresh", result => {});
Hooks.on("token-path-grid.clear", () => {});
```

### Overriding speed resolution

```js
CONFIG["token-path-grid"].getTokenSpeed = (token, action) => {
  // Return a number, null to suppress the grid, or undefined to fall through to the default.
};
```

## Notes and limits

- **Gridless scenes are not supported.** A reachability *grid* needs grid spaces; on a gridless scene
  `computeReachability` returns `unavailable: "gridless"`.
- **Hexagonal grids** work, but tokens larger than one space fall back to single-space cost on hex,
  because core's hexagonal cost expansion depends on private internals.
- **Terrain resolution is the expensive part.** In `auto` mode it is skipped entirely on scenes with no
  active region behaviours, which is the common case. On scenes that do have terrain, expect the search
  to take noticeably longer; drop to `never` if it bites.
- Elevation is treated as fixed at the token's current elevation — the search is planar.
