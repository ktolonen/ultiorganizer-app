# Status

Against [PLAN.md](PLAN.md), as of the first implementation pass (2026-10-18).

## Verified here

`npm run typecheck`, `npm run lint` and `npm test` pass; `expo export` bundles for Android and iOS; `expo-doctor` is clean. The pure cores run against real SQLite (`node:sqlite`) and fake `fetch`. **Nothing was run on a device or simulator**: screens are typechecked and bundled, not exercised.

## Built

| Plan phase          | Done                                                                                                                                                                                                                                                                                  |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 Foundation        | Expo SDK 58 project, tokens (Day/Night, 12 team swatches, contrast-tested), i18n (en complete; fi/de/es seeded from the server `.po`), SQLite schema and repository, generated API client, pairing (token paste, setup-QR parsing, `/version` check), scorekeeping-QR scan, game list |
| 2 Timekeeper        | Engine port with tests (all scenarios, timeout-before-pull, repeat, caps, pause, JSON round-trip recovery), persisted wall-clock anchors, timer screen, generated beeps, haptics, local notifications while backgrounded, keep-awake, bundled WFDF templates, Timekeeper-only mode    |
| 3 Live scorekeeping | Entry-context parsing, reducer mirroring the API rules, rosters, live screen, goal sheet, timeouts, spirit stoppages, score taps, outbox with idempotent replay and backoff, sync dot, finalize                                                                                       |
| 4 Resilience        | Conflict sheet (keep server / upload mine), full-upload fallback and fall-behind offer, offline-only sessions, undo per the rules, crash recovery from the persisted outbox                                                                                                           |

## Differences from the plan

- **No Drizzle.** Plain `expo-sqlite` with `PRAGMA user_version` migrations, validated with zod on read. The Drizzle migration pipeline needs a device to verify; the plain version is tested on real SQLite.
- **A refused write pauses the queue** (`needs attention`) and routes to the same server-version sheet, instead of continuing: later rows were made on top of it, and a refused row cannot be dropped without rebuilding local state.
- Score taps are used only while neither side has a roster (result-only keeping). Once a roster exists every point is a goal; a side without a roster records an Unknown/Unknown goal, so taps and goals never mix and a whole-game upload stays possible.
- Timekeeper sessions are scoped: one clock for Timekeeper-only mode and one per game. The template choice and local edits are shared per device.
- A 2xx answer that is not a write answer (captive portal) is retried with the same key, never marked sent.
- Server signal texts are database translations (`uo_translation`), not in the `.po` files, so fi/de/es signal texts fall back to English until S1 serves them translated.
- Day `signal-warn` (`#E8A200`) is 2.2:1 on white. It is used only as a fill with text on it (9.6:1), never as a line or icon; a test records this.

## Not done

- **Server work S0–S2** (setup QR, `GET timekeeper/templates`, caps writes) lives in `../ultiorganizer` and was not touched. The app already degrades without them: paste-token pairing, a 404 on templates falls back to bundled defaults (probed once, cached), caps stay local. "Record cap" is not built (needs S2).
- **Maestro flows, EAS builds, store assets and submission, a beta at a real tournament**: need devices, accounts and an event.
- A team-colour picker (colours are chosen automatically per game from the 12 swatches) and a way to start a game offline-only.
- Landscape layout, screenshots in Day/Night × phone/tablet × en/fi/de, an accessibility pass with VoiceOver/TalkBack, reviewed translations, Sentry (opt-in).
- Contract tests against the dev stack (`docs/dev/compose.yaml`).
- Goal times use the game clock rounded to the second; the web Scorekeeper's exact rounding rule was not checked beyond `roundedTime()`.

## Process note

`PLAN.md` was reformatted by an accidental `prettier --write .` during this pass (table padding and `*emphasis*` to `_emphasis_`). It was restored by reversing those two changes; the line count (211) is unchanged, but it is untracked, so there was no baseline to diff against. Check it if it matters, and `.prettierignore` now excludes it.
