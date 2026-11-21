# Design

The app is used outdoors, in direct sun or under floodlights, one-handed, often while a clock is running. People glance at it for a second and should need nothing to learn. The design comes from the field: the two teams facing each other, the officials' signal colours, and big readable numbers.

## Colour

The interface is neutral; colour comes from the teams and from the signals. Tokens are in `src/ui/tokens.ts`.

| Token        | Light     | Dark      | Role                                                            |
| ------------ | --------- | --------- | --------------------------------------------------------------- |
| `surface`    | `#FFFFFF` | `#000000` | true white and true black, the most contrast for glare and OLED |
| `ink`        | `#0A1620` | `#F2F5F7` | text, 15:1 or more on the surface                               |
| `muted`      | `#3C4A56` | `#B4C0C9` | secondary text, still 7:1                                       |
| `line`       | `#C9D2D9` | `#2A3640` | dividers, chip outlines                                         |
| `signalGo`   | `#0F8A4B` | `#3DDC84` | running timer, synced                                           |
| `signalWarn` | `#E8A200` | `#FFC93C` | warning signal, cap notice                                      |
| `signalStop` | `#D21F3C` | `#FF5A6E` | final signal, time cap, needs attention                         |

The light `signalWarn` is only 2.2:1 on white, so it is used only as a fill with text on it (9.6:1), never as a line or an icon. A test records this.

Team colours are the one bold move. Each side gets one of 12 jersey-like swatches when the game opens, light or dark, and the text colour flips to keep 7:1 contrast. The two halves of the live screen are flooded with those colours, so the scorekeeper sees the field rather than an interface.

Theme: Light, Dark, or follow the system (the default).

## Type

- **Barlow Condensed** (SemiBold and Bold) for the score, clocks and jersey numbers, with tabular figures. A condensed face fits "15" at 160 pt on half a phone screen.
- **Atkinson Hyperlegible Next** for all other text, designed for legibility, which suits glare and quick glances.
- Scale: 13 / 16 / 20 / 28 / 44 / 96 / 160 pt. Sentence case everywhere; no all-caps labels.

Both fonts are bundled with the app.

## Live screen

- The score halves take most of the screen; tapping one opens the goal sheet.
- The Timekeeper's action bar fills the full width and changes colour at each signal (go, warn, stop), so the state reads from across a field. The bar also shows the signal text, so colour is never the only signal.
- The actions sit in the thumb zone with 64 pt targets.
- Motion only answers an action: the score changes on a goal, the bar reacts to a signal, and a sheet slides up.
- Hints are minimal: one line per state, with no legends or tutorials on the live screen.

## Wording

Terms follow the server's [terminology reference](https://github.com/ktolonen/ultiorganizer/blob/master/docs/terminology.md), and the shared terms in Finnish, German and Spanish are seeded from the server's translations (`npm run i18n:seed`), so the app and the website use the same words. `C`, `SC` and `TO` are the approved abbreviations for narrow layouts. Server error messages are English, so the app maps each `error.code` to its own sentence and keeps the server's text only as a detail.

## Accessibility

Touch targets are at least 48 pt, and 64 pt on the live screen. Timekeeper signals vibrate as well as beep and change colour. Still to do: a full pass with VoiceOver and TalkBack, and checks of large Dynamic Type sizes.
