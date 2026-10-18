// One-time migration of the module's stored data from the pre-rename id ("foundry-mobile-bridge")
// to the current one ("bag-of-worlds").
//
// Foundry keys everything a module persists by its id, so renaming the module orphans:
//   * world settings   (Setting documents keyed "<id>.<key>")       -> copied by the primary GM tab
//   * client settings  (localStorage keys "<id>.<key>", per browser) -> copied by every client
//   * document flags   (doc.flags["<id>"], on actors, items, effects, folders, journals + pages, chat
//                       messages)                                    -> copied by the primary GM tab
// Nothing is deleted: the old copies stay in place so the old module can be reinstalled. Everything is
// idempotent and never overwrites a value that already exists under the new id. The completion of the
// world-wide part is recorded in the world setting `idMigration`; until then flags.js readers fall back to the
// old scope.
//
// The pieces take no module-level dependency on the bridge entry point (the primary-GM test is local), so
// this file can be loaded on its own by the tests. It only touches the `game`/`CONFIG`/`ui` globals at call time.

import { ID_MIGRATION_SETTING, LEGACY_MODULE_ID, MODULE_ID, MODULE_VERSION } from "./constants.js";
import { setLegacyFallback } from "./flags.js";

/** Passed in the options of every migration write, so hooks (chat mirroring) can ignore it. */
export const MIGRATION_OPTION = "bagOfWorldsIdMigration";

/** Per-browser marker in localStorage: this client's settings have been carried over. */
export const CLIENT_MARKER_KEY = `${MODULE_ID}.idMigration.client`;

/** Settings copied last: changing the approval-log language rewrites the logs from the stores copied before it. */
const COPY_LAST = new Set(["journalLanguage"]);

/** Documents whose flags are migrated: top-level collection on `game`, document name, embedded collections. */
const FLAG_TARGETS = [
  { documentName: "Actor", collection: "actors", embedded: [["Item", "items"], ["ActiveEffect", "effects"]] },
  { documentName: "Item", collection: "items", embedded: [["ActiveEffect", "effects"]] },
  { documentName: "Folder", collection: "folders", embedded: [] },
  { documentName: "JournalEntry", collection: "journal", embedded: [["JournalEntryPage", "pages"]] },
  { documentName: "ChatMessage", collection: "messages", embedded: [] }
];

const UPDATE_CHUNK = 100;

/* ------------------------------------------------------------------ */
/* Small helpers                                                      */
/* ------------------------------------------------------------------ */

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function contentsOf(collection) {
  if (!collection) return [];
  if (Array.isArray(collection.contents)) return collection.contents;
  try { return [...collection]; } catch { return []; }
}

/**
 * The part of `legacy` that `current` lacks, as a nested object holding only those leaves; `undefined` when
 * `current` already has everything. A key present in `current` (even null) is never replaced, and arrays count
 * as single values.
 */
export function missingLeaves(legacy, current) {
  if (!isPlainObject(legacy)) return undefined;
  const result = {};
  for (const [key, value] of Object.entries(legacy)) {
    if (value === undefined) continue;
    const existing = isPlainObject(current) ? current[key] : undefined;
    if (existing === undefined) {
      result[key] = clone(value);
    } else if (isPlainObject(value) && isPlainObject(existing)) {
      const nested = missingLeaves(value, existing);
      if (nested !== undefined) result[key] = nested;
    }
  }
  return Object.keys(result).length ? result : undefined;
}

/** Whether this client is the primary active GM (same election as isPrimaryActiveGm() in mobile-bridge.js). */
function isPrimaryGmTab() {
  if (!game.user?.isGM) return false;
  const activeGms = game.users?.filter?.((user) => user.isGM && user.active) ?? [];
  return activeGms.length > 0 && activeGms[0].id === game.user.id;
}

function emptyCounts() {
  return { copied: [], alreadySet: [], unregistered: [], failed: [] };
}

/* ------------------------------------------------------------------ */
/* Migration state                                                    */
/* ------------------------------------------------------------------ */

/** The recorded state ({ done, ... }); never throws (the setting may not be registered yet). */
export function readMigrationState() {
  try {
    const state = game.settings.get(MODULE_ID, ID_MIGRATION_SETTING);
    return isPlainObject(state) ? state : { done: false };
  } catch {
    return { done: false };
  }
}

/** Align the legacy-flag fallback with the recorded state. Call as early as possible in `ready` on every client. */
export function syncFallbackFromState() {
  const done = readMigrationState().done === true;
  setLegacyFallback(!done);
  return done;
}

/* ------------------------------------------------------------------ */
/* Settings                                                           */
/* ------------------------------------------------------------------ */

function worldSettingValue(entry, definition) {
  let value = entry.value;
  // The Setting document normally hands over parsed JSON; accept the stored string form as well.
  if (typeof value === "string" && definition?.type !== String) {
    try { value = JSON.parse(value); } catch { /* a plain string value */ }
  }
  return value;
}

/** Copy world-scope settings from the old namespace. Needs a GM. */
export async function migrateWorldSettings() {
  const counts = emptyCounts();
  const storage = game.settings?.storage?.get?.("world");
  const entries = contentsOf(storage);
  const prefix = `${LEGACY_MODULE_ID}.`;
  const existing = new Set(entries.map((entry) => entry.key));
  const legacy = entries
    .filter((entry) => typeof entry.key === "string" && entry.key.startsWith(prefix))
    .sort((a, b) => Number(COPY_LAST.has(a.key.slice(prefix.length))) - Number(COPY_LAST.has(b.key.slice(prefix.length))));
  for (const entry of legacy) {
    const key = entry.key.slice(prefix.length);
    const fullKey = `${MODULE_ID}.${key}`;
    if (existing.has(fullKey)) { counts.alreadySet.push(key); continue; }
    const definition = game.settings.settings?.get?.(fullKey);
    if (!definition || definition.scope !== "world") { counts.unregistered.push(key); continue; }
    try {
      await game.settings.set(MODULE_ID, key, worldSettingValue(entry, definition));
      counts.copied.push(key);
    } catch (err) {
      counts.failed.push(key);
      console.warn(`[${MODULE_ID}] id migration: could not copy world setting "${key}"`, err);
    }
  }
  return counts;
}

/** Copy this browser's client-scope settings (localStorage) from the old namespace. Runs once per browser. */
export async function migrateClientSettings() {
  const counts = emptyCounts();
  let storage = null;
  try { storage = globalThis.localStorage ?? null; } catch { storage = null; }
  if (!storage) return counts;
  try { if (storage.getItem(CLIENT_MARKER_KEY) != null) return counts; } catch { return counts; }
  const prefix = `${LEGACY_MODULE_ID}.`;
  const keys = [];
  for (let i = 0; i < storage.length; i++) {
    const storageKey = storage.key(i);
    if (typeof storageKey === "string" && storageKey.startsWith(prefix)) keys.push(storageKey.slice(prefix.length));
  }
  for (const key of keys) {
    const fullKey = `${MODULE_ID}.${key}`;
    if (storage.getItem(fullKey) != null) { counts.alreadySet.push(key); continue; }
    const definition = game.settings.settings?.get?.(fullKey);
    if (!definition || definition.scope !== "client") { counts.unregistered.push(key); continue; }
    try {
      const raw = storage.getItem(`${prefix}${key}`);
      let value = raw;
      try { value = JSON.parse(raw); } catch { /* keep the raw string */ }
      await game.settings.set(MODULE_ID, key, value);
      counts.copied.push(key);
    } catch (err) {
      counts.failed.push(key);
      console.warn(`[${MODULE_ID}] id migration: could not copy client setting "${key}"`, err);
    }
  }
  if (!counts.failed.length) {
    try { storage.setItem(CLIENT_MARKER_KEY, String(Date.now())); } catch { /* retry next load */ }
  }
  return counts;
}

let settingsStage = null;

/**
 * The settings part of the migration, once per page load: this browser's client settings on every client,
 * the world settings on the primary GM tab while the migration is not recorded as complete. path-grid's
 * ready hook awaits this before it migrates the older standalone token-path-grid values, so that the newer
 * values win. Resolves to a summary and never rejects.
 */
export function ensureSettingsMigrated() {
  settingsStage ??= (async () => {
    const summary = { world: null, client: null };
    try { summary.client = await migrateClientSettings(); }
    catch (err) { console.warn(`[${MODULE_ID}] id migration: client settings failed`, err); }
    try {
      if (isPrimaryGmTab() && !readMigrationState().done) summary.world = await migrateWorldSettings();
    } catch (err) {
      console.warn(`[${MODULE_ID}] id migration: world settings failed`, err);
    }
    return summary;
  })();
  return settingsStage;
}

/** Test hook: forget the memoised settings stage. */
export function resetMigrationMemo() {
  settingsStage = null;
}

/* ------------------------------------------------------------------ */
/* Flags                                                              */
/* ------------------------------------------------------------------ */

function legacyFlagsUpdate(doc) {
  const legacy = doc?.flags?.[LEGACY_MODULE_ID];
  if (!isPlainObject(legacy)) return null;
  const missing = missingLeaves(legacy, doc.flags?.[MODULE_ID]);
  return missing === undefined ? null : { _id: doc.id, flags: { [MODULE_ID]: missing } };
}

function documentClass(documentName) {
  return globalThis.CONFIG?.[documentName]?.documentClass ?? null;
}

async function applyInChunks(apply, updates, stats) {
  for (let i = 0; i < updates.length; i += UPDATE_CHUNK) {
    const chunk = updates.slice(i, i + UPDATE_CHUNK);
    try {
      await apply(chunk, { render: false, [MIGRATION_OPTION]: true });
      stats.updated += chunk.length;
    } catch (err) {
      stats.failed += chunk.length;
      console.warn(`[${MODULE_ID}] id migration: could not update ${chunk.length} ${stats.label} document(s)`, err);
    }
  }
}

/**
 * Copy `flags["foundry-mobile-bridge"]` to `flags["bag-of-worlds"]` on every world document that carries it.
 * @returns {Promise<Record<string, {label: string, scanned: number, updated: number, failed: number}>>}
 */
export async function migrateDocumentFlags() {
  const report = {};
  for (const target of FLAG_TARGETS) {
    const top = { label: target.documentName, scanned: 0, updated: 0, failed: 0 };
    report[target.documentName] = top;
    const docs = contentsOf(game[target.collection]);
    const topUpdates = [];
    const embeddedStats = Object.fromEntries(target.embedded.map(([name]) => {
      const stats = { label: `${target.documentName}.${name}`, scanned: 0, updated: 0, failed: 0 };
      report[stats.label] = stats;
      return [name, stats];
    }));
    for (const doc of docs) {
      top.scanned++;
      const update = legacyFlagsUpdate(doc);
      if (update) topUpdates.push(update);
      for (const [name, collection] of target.embedded) {
        const stats = embeddedStats[name];
        const children = contentsOf(doc[collection]);
        const childUpdates = [];
        for (const child of children) {
          stats.scanned++;
          const childUpdate = legacyFlagsUpdate(child);
          if (childUpdate) childUpdates.push(childUpdate);
        }
        if (childUpdates.length) {
          await applyInChunks((chunk, options) => doc.updateEmbeddedDocuments(name, chunk, options), childUpdates, stats);
        }
      }
    }
    const cls = documentClass(target.documentName);
    if (topUpdates.length) {
      if (cls?.updateDocuments) await applyInChunks((chunk, options) => cls.updateDocuments(chunk, options), topUpdates, top);
      else { top.failed += topUpdates.length; console.warn(`[${MODULE_ID}] id migration: no document class for ${target.documentName}`); }
    }
  }
  return report;
}

/* ------------------------------------------------------------------ */
/* Orchestration                                                      */
/* ------------------------------------------------------------------ */

function summarize(counts) {
  if (!counts) return "n/a";
  const parts = [`copied ${counts.copied.length}`];
  if (counts.alreadySet.length) parts.push(`kept existing ${counts.alreadySet.length}`);
  if (counts.unregistered.length) parts.push(`not registered ${counts.unregistered.length} [${counts.unregistered.join(", ")}]`);
  if (counts.failed.length) parts.push(`FAILED ${counts.failed.length} [${counts.failed.join(", ")}]`);
  return parts.join(", ");
}

function summarizeFlags(report) {
  if (!report) return "n/a";
  return Object.values(report)
    .filter((entry) => entry.updated || entry.failed)
    .map((entry) => `${entry.label} ${entry.updated}${entry.failed ? ` (FAILED ${entry.failed})` : ""}`)
    .join(", ") || "nothing to copy";
}

/**
 * Run the migration for this client (call from `ready`). Always returns a summary and never throws.
 *  - every client: sync the flag fallback, copy this browser's client settings;
 *  - primary GM tab, migration not yet recorded: copy world settings and document flags, record completion
 *    (only when nothing failed, so a half-done run is retried on the next load).
 */
export async function runModuleIdMigration() {
  const result = { skipped: null, settings: null, flags: null, done: false };
  try {
    const alreadyDone = syncFallbackFromState();
    result.settings = await ensureSettingsMigrated();
    if (alreadyDone) { result.done = true; result.skipped = "already migrated"; return result; }
    if (!isPrimaryGmTab()) { result.skipped = "not the primary GM tab"; return result; }

    result.flags = await migrateDocumentFlags();
    const flagFailures = Object.values(result.flags).reduce((sum, entry) => sum + entry.failed, 0);
    const settingFailures = (result.settings?.world?.failed?.length ?? 0);
    const clean = flagFailures === 0 && settingFailures === 0 && result.settings?.world != null;
    console.log(
      `[${MODULE_ID}] Module-id migration (${LEGACY_MODULE_ID} -> ${MODULE_ID}): `
      + `world settings: ${summarize(result.settings?.world)}; client settings: ${summarize(result.settings?.client)}; `
      + `document flags copied: ${summarizeFlags(result.flags)}.`
    );
    if (!clean) {
      console.warn(`[${MODULE_ID}] Module-id migration was incomplete; it will be retried on the next load.`);
      return result;
    }
    await game.settings.set(MODULE_ID, ID_MIGRATION_SETTING, {
      done: true,
      at: new Date().toISOString(),
      from: LEGACY_MODULE_ID,
      version: MODULE_VERSION,
      worldSettings: result.settings.world.copied,
      flagsCopied: Object.fromEntries(Object.values(result.flags).filter((e) => e.updated).map((e) => [e.label, e.updated]))
    });
    setLegacyFallback(false);
    result.done = true;
    globalThis.ui?.notifications?.info?.(`Bag of Worlds: data from the old "${LEGACY_MODULE_ID}" module was migrated.`);
  } catch (err) {
    result.skipped = `error: ${err?.message ?? err}`;
    console.error(`[${MODULE_ID}] Module-id migration failed`, err);
  }
  return result;
}
