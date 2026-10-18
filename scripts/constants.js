// Shared constants — extracted from mobile-bridge.js.

export const MODULE_ID = "bag-of-worlds";
export const SOCKET_NAME = `module.${MODULE_ID}`;
/**
 * The id this module had before the "Bag of Worlds" rename (it was "foundry-mobile-bridge"). Only the
 * one-time data migration (id-migration.js), the legacy-flag fallback readers (flags.js) and the
 * "old module still active" warning may use it - never as a live namespace for new data.
 */
export const LEGACY_MODULE_ID = "foundry-mobile-bridge";
/** World setting that records the completed old-id -> new-id data migration (see id-migration.js). */
export const ID_MIGRATION_SETTING = "idMigration";
/**
 * The bridge's own version, as reported by `health.ping` and the viewport snapshot.
 *
 * It used to be a hand-edited literal ("0.7.5") that nobody bumped, so every
 * release from 0.8 to 0.14.1 reported "0.7.5" and the phone could not tell
 * bridges apart. The single source of truth is now `module.json` ->
 * "version": `syncModuleVersion` copies it in when Foundry has loaded the
 * manifest (the `init` hook in mobile-bridge.js). This is an ES live binding,
 * so every importer sees the updated value; "" (unknown - the phone then
 * neither warns nor shows an outdated-bridge banner) only survives if the manifest cannot be read.
 *
 * The phone knows the stale literal and treats it as "unknown legacy bridge"
 * (see LEGACY_STALE_MODULE_VERSION in android BridgeCompat.kt) — never reuse it.
 */
export let MODULE_VERSION = "";
/** Called once with `game.modules.get(MODULE_ID).version`. Ignores anything that is not a non-empty string. */
export function syncModuleVersion(manifestVersion) {
  if (typeof manifestVersion === "string" && manifestVersion.trim()) MODULE_VERSION = manifestVersion.trim();
}

/**
 * Stable ids of the protocol features the phone app depends on that older
 * bridges lack, returned by `health.ping` as `capabilities`. The app keeps
 * the same ids in android BridgeCompat.kt (`BridgeCaps`) and gates UI on them.
 *
 * RULES: ids are lowerCamelCase and NEVER renamed or removed (an old app may
 * still ask for them); add a new id for every new feature the app depends on,
 * with a comment saying which release introduced it. Several ids describe
 * behaviour rather than an action name (the phone cannot probe those).
 */
export const BRIDGE_CAPABILITIES = Object.freeze([
  // --- Baseline: present in every bridge from 0.12.0, the first numbered release (listed so the app can
  // --- gate on them if MIN_BRIDGE_VERSION is ever lowered) ---
  /** 0.12.0 — `scene.door.toggle`: a player opens/closes a door from the phone. */
  "doorToggle",
  /** 0.12.0 — `chat.message.send`: the phone posts an OOC chat message authored by the player. */
  "chatSend",
  /** 0.12.0 — `actor.save.respond` + `save.request` push: phone prompts for midi-qol saving throws. */
  "saveRespond",
  // --- 0.13.0 ---
  /** 0.13.0 — movement grid built into the bridge (path-grid/); older bridges need the standalone token-path-grid module. */
  "pathGridEmbedded",
  // --- 0.14.0 (the map-reveal / snapshot / self-range work merged into the 0.14.0 release line) ---
  /** 0.14.0 — `scene.dynamic.get` reports `visionEnabled` and always sends `los` when it is true (phone reveal gate). */
  "mapRevealGate",
  /** 0.14.0 — `scene.viewport.snapshot` refuses ("vision_scene") / filters tokens for non-GM requesters instead of leaking the GM view. */
  "playerSafeViewportSnapshot",
  /** 0.14.0 — `actor.item.use` auto-targets the caster for self-range items without an area. */
  "selfRangeAutoTarget",
  // --- 0.14.1 ---
  /** 0.14.1 — save prompts are pushed only for player-character actors (never NPCs). */
  "savePromptCharactersOnly",
  // --- 1.0.0 (first released together with the capability list itself) ---
  /** Template size/position are read from the backing Region, correct on any grid size (v14 compat `distance` was off). */
  "templateRegionGeometry",
  /** `scene.background.stamp` + `scene.versions`: the phone validates and prunes its on-disk map cache. */
  "mapCacheStamp"
]);
/** Bumped when grant/approval pipeline changes — visible in api.status(). */
export const GRANT_PIPELINE = "role-provisional-v1";
export const BRIDGE_TRACE_SETTING = "debugTrace";
export const BRIDGE_TRACE_PREFIX = `[${MODULE_ID}:trace]`;
export const BRIDGE_ROLL_TRACE_PREFIX = `[${MODULE_ID}:roll]`;
export const BRIDGE_GRANT_PREFIX = `[${MODULE_ID}:grant]`;
export const ROLL_ACTIONS = new Set([
  "roll.skill", "roll.save", "roll.ability", "roll.hitDie", "roll.initiative", "roll.formula",
  // Player's answer to a midi-qol save.request prompt (Phase 1 — see map.js
  // respondToMobileSaveRequest). Carries advantageMode like the other rolls.
  "actor.save.respond"
]);

export const OFFLINE_CHANGES_SETTING = "offlineChanges";
/** Ledger of sheet edits applied directly by players, each revocable by the GM. */
export const REVOCABLE_CHANGES_SETTING = "revocableChanges";

export const OFFLINE_STATUS = Object.freeze({
  SUBMITTED: "submitted",
  PENDING: "pending",
  APPLIED: "applied",
  REJECTED: "rejected"
});

export const OFFLINE_OPERATION = Object.freeze({
  ITEM_CREATE_TEXT: "item.createText",
  ITEM_CREATE_FROM_UUID: "item.createFromUuid",
  ITEM_DELETE: "item.delete",
  ITEM_QUANTITY: "item.quantity",
  CURRENCY_SET: "currency.set",
  /** Absolute class level target (itemId = class item id, quantity = levels). */
  CLASS_LEVEL_CHANGE: "class.levelChange",
  /** Absolute ability score (itemId = str/dex/…); ActiveEffect override when not consumed by ASI. */
  ABILITY_SET: "ability.set",
  /** Sheet param → ActiveEffect (itemId = kind, quantity / summary = value). */
  SHEET_OVERRIDE: "sheet.override",
  /**
   * One biography/details field (itemId = field key, textValue = new text).
   *
   * The one operation with no GM approval and no role gate: the owner can already
   * edit these fields in their own browser sheet and they carry no mechanical
   * weight, so getOwnedActor is the whole gate. Resolved to APPLIED or REJECTED
   * during submit, so it never reaches the GM approval dialog.
   */
  BIOGRAPHY_SET: "biography.set"
});
export const CLASS_LEVEL_MAX = 20;
export const ABILITY_SCORE_MIN = 1;
export const ABILITY_SCORE_MAX = 30;
export const ABILITY_KEYS = new Set(["str", "dex", "con", "int", "wis", "cha"]);

/** Stack size cap for non-currency inventory items (mobile GM-approval requests). */
export const ITEM_QUANTITY_MAX = 999;
/** Per-denomination cap (offline batch / JS safe integer handling). */
export const CURRENCY_MAX = 9_999_999;
/** Temp HP has no rules maximum; cap it so a bad payload cannot write nonsense. */
export const HP_TEMP_MAX = 9_999;
/** Upper bound for the manual max-HP override (sanity, not a 5e rule). */
export const HP_MAX_LIMIT = 9_999;
/** Largest single damage / healing delta the phone may submit. */
export const HP_DELTA_MAX = 9_999;
/** Queued offline biography text cap — these rows sit in world settings until synced. */
export const BIOGRAPHY_TEXT_MAX = 50_000;
/** Loot icon uploads from mobile — keep socket payloads small. */
export const LOOT_IMAGE_MAX_RAW_BYTES = 512 * 1024;
export const LOOT_IMAGE_MAX_LONG_SIDE = 512;
/**
 * Portraits and token art are shown far larger than an inventory thumbnail, so
 * they get their own bound. Both sides fit inside it, and the aspect ratio is
 * kept — a 3000x4000 photo becomes 450x600, not a squashed 600x600.
 */
export const CHARACTER_IMAGE_MAX_LONG_SIDE = 600;

// Rolls must run on one client only (duplicate chat messages). Reads can run on the requesting user's Foundry tab or on any GM.
// Edit actions (item.create/delete, class.levelSet, etc.) also run on the primary
// GM to ensure consistent ownership checks and to avoid races between clients.
// Compendium search runs there too since it walks `game.packs` / Spotlight's
// in-memory INDEX, which are GM-scope read APIs.
export const PRIMARY_GM_ONLY_ACTIONS = new Set([
  "roll.skill", "roll.save", "roll.ability", "roll.hitDie", "roll.initiative",
  "actor.rest.short", "actor.rest.long",
  "actor.item.use", "actor.item.uses.set", "actor.item.activities",
  "compendium.search", "compendium.browse",
  // Uploads must run on one client: FilePicker.upload writes to the server and
  // two tabs answering would store the file twice.
  // One client must own the broadcast, or every GM tab shares the same image.
  "image.showToPlayers",
  "actor.item.create", "actor.item.createLoot", "actor.item.updateLoot",
  "actor.item.setImage", "actor.portrait.set",
  "actor.item.delete", "actor.item.quantity",
  "actor.item.equipped",
  "actor.item.attuned",
  // Condition toggle creates/deletes an embedded ActiveEffect, like the item
  // toggles above — runs on the primary GM for consistent ownership checks.
  "actor.condition.toggle",
  "actor.item.proficient",
  "actor.item.attackAbility",
  "actor.initiative.ability",
  "actor.spellcasting.ability",
  "actor.spell.prepared",
  "journal.note.create",
  "journal.note.set",
  "journal.note.delete",
  "journal.ownership.set",
  "actor.currency.set",
  "actor.spellSlots.set",
  "actor.hp.set", "actor.hp.applyDelta",
  "offlineChanges.submitBatch", "offlineChanges.status", "offlineChanges.listPending",
  "offlineChanges.resolve", "offlineChanges.withdraw",
  // Class level wizard sessions live in the GM-client memory, so all session
  // actions must run on the same primary GM tab.
  "class.advancement.begin", "class.advancement.submit", "class.advancement.back",
  "class.advancement.commit", "class.advancement.cancel",
  // Map snapshots: route to a single client (GM if any online) to avoid
  // multiple desktop clients each rendering and emitting duplicate images.
  "scene.viewport.snapshot",
  // Cached-background map model: background image is fetched once and cached on
  // the client; per-step updates are JSON only. Both must run on the authoritative
  // canvas client (primary GM) so token/vision data is consistent.
  "scene.background.get",
  // Persistent phone-side background cache: identity of the file (HEAD) and the
  // per-scene bgVersion list. Same client as scene.background.get so both
  // answer from the same canvas level, and exactly one GM tab replies.
  "scene.background.stamp",
  "scene.versions",
  "scene.dynamic.get",
  "scene.asset.get",
  // Reads the same canvas-side combat state as the map snapshot.
  "combat.state.get",
  // World mutations on the scene, and the player has no client of their own to
  // make them with.
  "scene.drawing.create", "scene.drawing.delete",
  // Draws on every client and is broadcast from here, so exactly one tab may
  // run it.
  "scene.ping",
  // Door state is a world mutation, and the visibility check needs a canvas that
  // is on the scene, so one client answers — the same one that drew the door.
  "scene.door.toggle",
  // World/game-wide setting: exactly one client should flip it and broadcast,
  // or two GM tabs racing each other could flip it twice and land back where
  // it started.
  "game.pause.toggle",
  // One authoritative reply per requestId on the mobile app: same rationale
  // as rolls — avoids primary GM finishing with moved:false while the owner tab
  // succeeded, and avoids owner.active + solo-GM leaving nobody to handle the step.
  "actor.token.step",
  // Same reasoning, and the reachability search only exists on a client whose
  // canvas is on the scene.
  "actor.token.moveToCell",
  // Movement-mode set reads canvas.scene to find the token document, same as
  // the step/moveToCell actions above.
  "actor.token.movementMode.set",
  // Every GM tab answering would create the character once each, and the
  // advancement session a class opens lives in one client's memory.
  "actor.create", "actor.race.set", "actor.class.add", "actor.background.set",
  "actor.startingEquipment.get", "actor.startingEquipment.grant",
  "actor.abilities.set", "actor.creation.finish", "actor.delete",
  "actor.rename", "actor.creation.stepBack",
  // Reads CONFIG/Trait choices (identical on every client) and creates a world
  // item, which only the GM client may do — so both route to the primary GM.
  "background.meta", "background.create",
  "race.meta", "race.create",
  "class.meta", "class.create",
  "subclass.meta", "subclass.create",
  "feat.meta", "feat.create",
  "content.list", "content.delete",
  // User document mutations: exactly one GM tab must run these, or two GM
  // clients online at once would both create/delete the same account.
  "user.create", "user.delete", "user.role.set", "user.password.set",
  // ChatMessage.create must run exactly once, or every online GM tab would
  // post its own copy of the player's message.
  "chat.message.send",
  // Feeds the player's chosen advantage/disadvantage back into midi-qol's own
  // pending save (Workflow#saveRequests) by driving actor.rollSavingThrow() —
  // that workflow instance only exists in the primary GM tab's memory, and the
  // resulting chat message must render on that same tab for midi's
  // renderChatMessageHTML listener to catch it. See map.js respondToMobileSaveRequest.
  "actor.save.respond"
]);

// Actions that require Trusted Player role (>= 2) to execute.
//
// Sheet edits used to live here: a regular player could roll and use items but
// not add/remove items, change quantities or currency, adjust spell slots or
// level up. That gate is gone — every player now makes those edits directly and
// each one is written to the character's log with a Revoke button, so the GM
// takes changes back after the fact instead of approving them up front (see the
// revocable-change ledger). `actor.hp.set` still guards the max-HP override
// alone, per field, inside actorHpSet. The set is kept (empty) so the dispatch
// check has something to consult and re-gating an action later is one line.
export const TRUSTED_REQUIRED_ACTIONS = new Set([]);
