// Plain-text rendering of item / feature / spell descriptions for the phone.
// No Foundry globals at import time and no imports, so the module loads (and is
// unit-tested) outside Foundry — see tests/bridge/itemText.test.js.
//
// dnd5e descriptions carry enricher syntax: `[[lookup @name]]`, `[[/r 1d6]]`,
// `@UUID[...]{label}`, `&Reference[...]`. Foundry resolves these when it renders
// the sheet; stripping the raw HTML would leave them on the phone verbatim
// ("[[lookup @name]] attacks using Quarterstaff"). So they go through
// TextEditor.enrichHTML first and only then lose their tags.

export function stripHtmlText(text) {
  return String(text ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// `[[...` inline rolls/lookups, `@UUID[`/`@Compendium[`/`@Embed[`, `&Reference[`.
const ENRICHER_SYNTAX = /\[\[|[@&][A-Za-z]+\[/;

/** True when the text holds something enrichHTML would rewrite (so it is worth the call). */
export function hasEnricherSyntax(text) {
  return typeof text === "string" && ENRICHER_SYNTAX.test(text);
}

/** Same TextEditor resolution as the journals code (v13+ namespaced, v12 global). */
export function resolveTextEditor() {
  return globalThis.foundry?.applications?.ux?.TextEditor?.implementation ?? globalThis.TextEditor;
}

/**
 * Plain text of one description. Enriches against `item` (so `@name`, `@abilities...`
 * and relative links resolve for the owner) when the text has enricher syntax; any
 * enrichHTML failure falls back to stripping the raw source.
 */
export async function enrichedPlainText(raw, item, textEditor = resolveTextEditor()) {
  const source = String(raw ?? "");
  if (!source || !hasEnricherSyntax(source) || typeof textEditor?.enrichHTML !== "function") {
    return stripHtmlText(source);
  }
  try {
    const html = await textEditor.enrichHTML(source, {
      // The caller already restricted the item to ones the user owns, and the raw
      // text used to ship with secrets in it, so keep them rather than dropping blocks.
      secrets: true,
      relativeTo: item,
      rollData: item?.getRollData?.() ?? {}
    });
    return stripHtmlText(String(html));
  } catch (err) {
    return stripHtmlText(source);
  }
}

/**
 * Plain texts for many `{ raw, item }` entries at once, concurrently, in input order.
 * An actor can own 100+ items; serial awaits would add up.
 */
export function enrichedPlainTexts(entries, textEditor = resolveTextEditor()) {
  return Promise.all(entries.map((e) => enrichedPlainText(e.raw, e.item, textEditor)));
}
