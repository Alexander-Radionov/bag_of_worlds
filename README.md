# Bag of Worlds — companion module for Foundry VTT

**Bag of Worlds** lets players use their **dnd5e character sheet and the battle map from an Android phone** while the game runs in Foundry Virtual Tabletop. This module is the server-side half: it runs inside the Game Master's browser tab and answers the phone app's requests in the context of the world.

> Unofficial. Not affiliated with, endorsed or sponsored by Foundry Gaming LLC. "Foundry Virtual Tabletop" / "Foundry VTT" are used only to describe what this works with.

## What players get on the phone

- Character sheet: abilities, skills, saves, HP, rolls with advantage/disadvantage.
- Inventory, spells (with spell slots), features with charges, biography, journals.
- Full-screen battle map: move your token by tapping a cell (XCOM-style movement grid with difficult terrain), target tokens, open doors, place and aim spell templates, ping.
- Chat with roll commands (`/r`, `/gmroll`, …) and pop-up saving-throw prompts for your character.
- Game Master tools: pause the game and manage users right from the phone.

## Requirements

- **Foundry VTT v12–v14** (v13+ for the built-in movement grid), **dnd5e** system.
- The **Bag of Worlds** app on the players' Android phones (Google Play).
- **A Game Master must be logged in with a browser tab open** — the module runs there and executes the phone's requests. Without that tab most features wait. (Pausing the game and managing users work without it.)

## Install

1. In Foundry: **Add-on Modules → Install Module**, paste the manifest URL into the field at the bottom:
   ```
   https://github.com/Alexander-Radionov/bag_of_worlds/releases/latest/download/module.json
   ```
2. In your world: **Game Settings → Manage Modules**, enable **Bag of Worlds**, save.
3. Reload the Game Master's tab (F5).
4. Players install the app, enter your server address, pick their user and log in.

## Settings and controls

- **Movement grid** for the player at the PC: the grid button in Token Controls, `Alt+G`, or the module settings (colours, terrain, blocking by tokens, max cells).
- The diagonal rule follows Foundry's core setting **Grid Diagonals** (e.g. *Alternating 5/10/5* for the DMG variant).

## Privacy

The module itself sends nothing anywhere: it talks only to the phones connected to your own Foundry server. The app's optional, opt-in diagnostics are described in the privacy policy: <https://63-184-52-233.sslip.io/privacy>.

## Support

Issues: <https://github.com/Alexander-Radionov/bag_of_worlds/issues> · E-mail: death.for.enemy@gmail.com

---

## По-русски кратко

**Bag of Worlds** — неофициальный модуль-компаньон для Foundry VTT (dnd5e): игроки открывают с Android-телефона лист персонажа, инвентарь, заклинания, журналы, чат и боевую карту (ход по клеткам, цели, двери, шаблоны заклинаний). Модуль работает во вкладке ГМа — **вкладка ГМа в браузере должна быть открыта**.

Установка: *Add-on Modules → Install Module* → вставить ссылку на манифест `https://github.com/Alexander-Radionov/bag_of_worlds/releases/latest/download/module.json` → включить **Bag of Worlds** в мире → перезагрузить вкладку ГМа. Приложение и модуль обновляйте вместе.

## License

MIT — see [LICENSE](LICENSE).
