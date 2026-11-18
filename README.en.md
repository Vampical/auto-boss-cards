# Auto Boss Cards

[Документация на русском](README.md)

A TERA Toolbox module that automatically selects cards and collection effects for bosses and BAMs based on your class, stats and chosen priorities.

## Installation and controls

Place the `auto-boss-cards` folder in `Toolbox/mods`, then restart Toolbox or reconnect to the game. The settings window requires the graphical version of Toolbox.

Enter `bcards` in the Toolbox channel to open settings. The interface and messages automatically follow your Toolbox language. English and Russian are supported; other languages use English. Settings are saved automatically and preserved when updating.

| Command | Action |
| --- | --- |
| `bcards` | Open settings |
| `bcards status` | Show module status and the current target |
| `bcards preview` | Show the selected set without applying it |
| `bcards on` | Enable automatic selection |
| `bcards off` | Disable automatic selection |
| `bcards refresh` | Update card and collection information and retry selection |
| `bcards apply` | Retry selection using the available information |

You can use `bosscards` instead of `bcards`.

## When the set changes

The module selects the nearest living boss or BAM when an eligible enemy appears, is killed or disappears. If the selected target changes, cards and collections are applied once. With several enemies present, the death or disappearance of the selected target causes a switch to the nearest surviving target.

Normal hits, enemy health changes, movement and stat updates do not reapply a completed set. Enemies that appear while the area is loading are considered after loading finishes.

If your character is in combat, changes wait until combat ends. The module changes your current card preset. After application, you can manually remove a card or disable a collection: your choice remains until the next target change or an explicit request to select again. A manual action also stops any remaining changes in an unfinished application.

## How cards are selected

Only activated cards in your collection are used. Selection respects available slots, the total cost budget, limits on cards of the same type and the restriction against equipping different rarities of the same card together. Equally useful sets favor cards that are already equipped.

Choose a shared priority or a separate priority for each of the 13 classes, plus an optional tiebreaker stat. Priest and Mystic default to magical defense; other classes default to the appropriate physical or magical crit power.

With damage selection enabled, the module evaluates the whole set using your current stats, class characteristics and **the highest learned level of each skill**. Lower and unlearned levels are excluded. Temporary changes to available skills do not erase known skills or their levels; a newly learned higher level is considered at the next selection.

Power, physical and magical attack, crit power and the appropriate piercing are compared by their expected benefit to your character. A card with another offensive stat can therefore be better than a card with the selected crit-power stat. With damage selection disabled, the module aims to maximize the chosen stat. Bonuses against specific enemy species follow the current target when that setting is enabled.

The percentage shown for a deck is an approximate estimate of the critical-hit damage gained from its cards. It is not a complete estimate of damage over a fight: your play, skill usage frequency and buff uptime also affect the result.

## Collections and healers

Collections can use separate priorities or automatic selection. They are selected after the cards, taking the resulting deck, unlocked collections, activated card rarities and the active-effect limit into account.

Permanent bonuses and supported critical-hit buffs count toward selection. Buffs that require a kill or resurrection do not improve a set's score against a living boss; permanent bonuses from those collections still count.

For Priest and Mystic, **Magical Defense** selects general magical defense to improve the resistance reduction from Triple Nemesis and Volley of Curses. Defense against a specific monster species is excluded from this purpose.

With damage selection enabled, magical defense is maximized first, then offensive benefit breaks ties. Remaining cost and slots may be used for offensive cards. Collections are compared by their total magical defense from permanent bonuses and compatible temporary buffs, with damage also breaking ties. With damage selection disabled, only cards that increase general magical defense are selected.

Choosing **Magical Crit Power** for a healer removes magical defense as a selection goal and prioritizes offense.

## Additional settings

You can separately enable BAM selection, bonuses against the enemy species, automatic collection changes and chat notifications. Detection range and a preview mode are also available; preview mode calculates sets without changing cards or collections.

Use `bcards apply` or `bcards refresh` to select again for the same target. Changing priorities also requests a new selection. If the module is waiting for character information after installation, re-enter your character. If application did not finish, leave combat and use `bcards refresh`.
