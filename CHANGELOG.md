# Changelog — Bag of Worlds (Foundry module)

Install the app and the module of the **same version** together.

## 1.1.0

- **Item, feature and spell descriptions** are resolved by Foundry before they are sent to the phone: dnd5e enrichers such as `[[lookup @name]]` or `@UUID[...]{label}` show the real text (the character's name, the link label) instead of raw syntax. If enrichment fails for an item, its plain text is sent as before. The reply shape of `actor.inventory.list`, `actor.spells.list` and `actor.features.list` is unchanged, so there is no new capability and the oldest supported module version is still 0.12.0.
- Tap-to-move confirmation (first tap previews the route, second tap moves) is an app-side change and needs nothing from the module.

## 1.0.0 — first public release

- **Version handshake:** the module reports its real version and a list of capabilities to the app; the app warns players when the module is too old, and the GM gets a one-time notice when a player connects with a newer app.
- **Spell templates on Foundry v14:** size and position are read from the backing Region, so templates are correct on any grid size; cubes report their side (`widthFt`); template coordinates are rounded.
- **Map cache support:** the phone can keep map backgrounds on disk and check whether the scene image changed (`scene.background.stamp`, `scene.versions`).

## 0.14.1

- Doors: always the normal icon, sized with the map zoom.
- Saving-throw prompts are sent only for player characters played in the app.

## 0.14.0

- The phone never receives the GM's vision of the map on vision scenes; the map is revealed only after background, vision and tokens are ready.
- Self-range spells and features without an area auto-target the caster.

## 0.13.0

- The movement grid (formerly the separate **token-path-grid** module) is built in. If the old standalone module is still enabled it takes precedence — disable it. Requires Foundry v13+.
- Grid toggle button in Token Controls and `Alt+G` for the player at the PC.
