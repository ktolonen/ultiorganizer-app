# Status

Against [PLAN.md](PLAN.md), as of the first implementation pass (2026-10-18), with caps added on 2026-11-07.

## Verified here

`npm run typecheck`, `npm run lint` and `npm test` pass; `expo export` bundles for Android and iOS; `expo-doctor` is clean. The pure cores run against real SQLite (`node:sqlite`) and fake `fetch`. **Nothing was run on a device or simulator**: screens are typechecked and bundled, not exercised.

## Built

| Plan phase          | Done                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 Foundation        | Expo SDK 58 project, tokens (Light/Dark, 12 team swatches, contrast-tested), i18n (en complete; fi/de/es seeded from the server `.po`), SQLite schema and repository, generated API client, pairing (token paste, setup-QR parsing, `/version` check), scorekeeping-QR scan, game list                                                                                      |
| 2 Timekeeper        | Engine port with tests (all scenarios, timeout-before-pull, repeat, caps, pause, JSON round-trip recovery), persisted wall-clock anchors, timer screen, generated beeps, haptics, local notifications while backgrounded, keep-awake, bundled WFDF templates, Timekeeper-only mode                                                                                          |
| 3 Live scorekeeping | Entry-context parsing, reducer mirroring the API rules, rosters, live screen, goal sheet, timeouts, spirit stoppages, score taps, outbox with idempotent replay and backoff, sync dot, finalize                                                                                                                                                                             |
| 4 Resilience        | Conflict sheet (keep server / upload mine), full-upload fallback and fall-behind offer, offline-only sessions, undo per the rules, crash recovery from the persisted outbox                                                                                                                                                                                                 |
| 5 Caps (S2)         | "Record cap" from the timekeeper's cap notice and on the Sheet tab: time called (5-second steps) and new point cap, suggested one above the higher score; correct or remove a recorded cap. Rules mirrored in the reducer (`times_hidden`, `point_cap_too_low`, any point cap from 1 for a correction, allowed on a final game). Synced through `PUT`/`DELETE caps/{type}`. |

## Differences from the plan

- **No Drizzle.** Plain `expo-sqlite` with `PRAGMA user_version` migrations, validated with zod on read. The Drizzle migration pipeline needs a device to verify; the plain version is tested on real SQLite.
- **A refused write pauses the queue** (`needs attention`) and routes to the same server-version sheet, instead of continuing: later rows were made on top of it, and a refused row cannot be dropped without rebuilding local state.
- Score taps are used only while neither side has a roster (result-only keeping). Once a roster exists every point is a goal; a side without a roster records an Unknown/Unknown goal, so taps and goals never mix and a whole-game upload stays possible.
- Opening a stored game refreshes only the eligible player lists from the server in the background, so players added after the first open become pickable. Local rosters, goals and the outbox are untouched; a player the server dropped stays eligible while a local roster or goal uses them.
- A scanned field link (one that lists several games, or none yet with an opening day) is kept on Home as a card with its fields and day, so its game list reopens without the camera. The token stays in SecureStore under the link's row id; a link is forgotten by hand, or once it has been unopened for a week and its day is more than a week past. Single-game links are not kept, because the game itself is in Recent games. Game rows and Recent games show the day and start time.
- The scorekeeper name (the server's `official`, "Scorekeeper(s)") is set once in Settings and filled into a game when it opens with no name and is not final; a name already on the game is never replaced. It is edited per game on the Sheet tab. Clearing it there lasts until the game is reopened, when the Settings name is filled in again.
- Timekeeper sessions are scoped: one clock for Timekeeper-only mode and one per game. The template choice and local edits are shared per device.
- A 2xx answer that is not a write answer (captive portal) is retried with the same key, never marked sent.
- Server signal texts are database translations (`uo_translation`), not in the `.po` files, the app sends `Accept-Language` to the S1 templates route, so fi/de/es signal texts come from the server when it is new enough, and fall back to bundled English otherwise.
- **Caps sit outside the token and the full upload.** A full upload keeps the server's caps, so unsent cap rows stay queued ahead of an upload instead of being folded into it; a refused cap row is dropped when the whole game is uploaded. A server without the caps route answers `404 not_found` (or `405`): that cap row is settled as skipped, the outbox remembers `capsAbsent`, later caps of that game stay on the phone, and the Sheet tab says so.
- Day `signal-warn` (`#E8A200`) is 2.2:1 on white. It is used only as a fill with text on it (9.6:1), never as a line or icon; a test records this.

## Not done

- **Server work S0–S2** is done in `../ultiorganizer` (setup QR, `GET timekeeper/templates`, caps writes). `api/openapi.json` and the generated types are synced to it. The app still works against servers without them: paste-token pairing, a 404 on templates falls back to bundled defaults (probed once, cached), and caps stay on the phone.
- **EAS**: the project is linked, development and preview profiles build APKs, iOS declares exempt encryption, and `expo-updates` is in for OTA updates. **Maestro flows, store assets and submission, a beta at a real tournament** still need devices, accounts and an event.
- A way to start a game offline-only. Needs a design decision first: without a server there is no entry context (teams, rules, game id), so it would be a device-local game with typed team names that can never be uploaded. The existing `offlineOnly` outbox flag covers only a real game that falls behind.
- Landscape layout, screenshots in Light/Dark × phone/tablet × en/fi/de, an accessibility pass with VoiceOver/TalkBack, reviewed translations, Sentry (opt-in).
- Contract tests against the dev stack (`docs/dev/compose.yaml`).
- Goal and timeout times use the game clock rounded to the second. The web Scorekeeper (`script/scorekeeper.js` `roundedTime()`) floors to the second and then rounds to the nearest 5 seconds, with a carry into the minute, because its form only offers 5-second steps. The API takes any second, so the app keeps the exact time; whether to match the 5-second steps is a product decision, not yet made.

## Process note

`PLAN.md` was reformatted by an accidental `prettier --write .` during this pass (table padding and `*emphasis*` to `_emphasis_`). It was restored by reversing those two changes; the line count (211) is unchanged, but it is untracked, so there was no baseline to diff against. Check it if it matters, and `.prettierignore` now excludes it.
