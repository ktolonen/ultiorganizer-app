# Ultiorganizer Field — app plan

A phone app for the person at the sideline: it keeps the WFDF time limits (Timekeeper) and the score and scoresheet (Scorekeeper) in one screen, and syncs with an Ultiorganizer installation through the scorekeeping API. Android and iOS from one codebase.

Written 2026-10-18 against `ultiorganizer` branch `scorekeeping-api-live` (PR #139, stacked on #138 and #137, DB 104). The API contract is `docs/api.md` ("Scorekeeping app endpoints") and `api/openapi.json` in that repo.

## Decisions

| Topic | Decision |
| --- | --- |
| Framework | Expo / React Native, TypeScript, Expo Router. Pin the current stable Expo SDK at scaffold time. |
| Server pairing | A setup QR on the server's `admin/apitokens.php` encodes the installation root and an app token. The app scans it once per installation and keeps the token in Keychain/Keystore. Pasting the token by hand is the fallback. |
| Game access | Scan the game's or field's existing scorekeeping QR (`<root>/scorekeeper/?t=<32 hex>`). No user login in the app. |
| Sync modes | Live (one write per event) with an offline outbox, and full upload (`PUT game-data`) for reconciling. Both settled earlier for the API. |
| Server additions | Timekeeper templates read, and halftime/time caps writes (Phase S below). The server game clock stays out of scope, so the app's clock is local to the phone. |
| Languages | English, Finnish, German, Spanish at launch, with wording from `docs/terminology.md` and the server `.po` catalogs. |
| Timekeeper without a server | Works fully offline with bundled WFDF defaults, with no pairing and no QR needed. |

## What the API gives and what it does not

Available (PR #139): discovery, entry context, goals add and delete-last, timeouts, spirit stoppages, score taps, rosters, metadata (starting offence, halftime, official), finalize, full upload, idempotency receipts, `ETag` tokens.

Missing, and how the plan handles it:

- **Timekeeper templates** are only in the database (`TimekeeperTemplatesForClient()`). Phase S1 adds a read route. The app bundles the WFDF defaults as a fallback.
- **Caps** (`half_cap`, `time_cap`) are out of API v1. Phase S2 adds them. Until then, cap notices show in the app only.
- **Server game clock** (`uo_game.timer_*`) is not exposed and stays out of scope. Goal and timeout times are sent as seconds from the app's own clock, so the server receives correct times. The browser scoreboard just won't show a running clock for app-kept games.
- **Game notes, defences, spirit scores, forfeits**: out of scope, as in the API.

## Server-side work (in `ultiorganizer`, Phase S)

Stack on `scorekeeping-api-live` until #137–#139 merge. Each item follows the repo rules: SQL in `lib/`, OpenAPI and `docs/api.md`, harness cases in `../ultiorganizer-tests`, `./test:matrix`.

- **S0: setup QR.** On `admin/apitokens.php`, add a "Show app setup QR" for installation- and event-scoped tokens (user-scoped tokens can't keep score). The QR holds `ultiorganizer-app://pair?root=<BASEURL>&token=<value>` and reuses the QR helper already used by `user/scorekeepinglink.php`. The token row already stores `token_value`, so no schema change is needed. Screen text warns that anyone holding the QR can keep score with any scorekeeping link. Run the user-language review afterwards.
- **S1: `GET /api/v1/timekeeper/templates`.** Returns the templates, the default id, signal rows per action, and cap defaults from `TimekeeperTemplatesForClient()`, with signal texts translated by `Accept-Language`. Any valid app token works; no link is needed. The data is public anyway: `timekeeper/` is a no-login page.
- **S2: caps.** `PUT /api/v1/games/{id}/caps/{half_cap|time_cap}` with `{time, target}` and `DELETE` for the same paths, through `GameSetCapEvent()` inside `ScorekeepingApiWrite()` (receipt, history source `api`). Refused while times are hidden, mirroring the Scorekeeper UI. Entry context already lists cap events.
- S0 depends on nothing else. S1 and S2 come before app Phase 3.
- The app must also work against an installation that has #139 but not S0-S2: pairing falls back to pasting the token, a `404` on templates falls back to bundled defaults, and caps stay local. The app probes each route once per server and caches the answer, rather than gating on version numbers.

## Architecture

```
app/                     Expo Router screens (file-based routes)
src/api/                 typed client, generated from api/openapi.json (openapi-typescript + openapi-fetch)
src/sync/                outbox, replay, conflict handling, upload fallback
src/game/                game state reducer (pure TS, unit-tested)
src/timekeeper/          signal engine, scenarios, caps (pure TS, port of script/timekeeper.js)
src/store/               SQLite persistence (expo-sqlite + Drizzle)
src/ui/                  design system components and tokens
src/i18n/                i18next catalogs en/fi/de/es
```

Main libraries (check versions at scaffold): `expo-camera` (QR), `expo-secure-store` (tokens), `expo-sqlite` (games and outbox), `expo-keep-awake`, `expo-haptics`, `expo-audio` (generated beeps), `expo-notifications` (signals while backgrounded), `expo-localization`, `react-native-reanimated`, TanStack Query (reads), Zustand (UI state), zod (persisted-data guards).

### Credentials

- `servers` table: root URL, label, app token reference (SecureStore key), last `/version` result. Several installations can be paired.
- Scanning a scorekeeping QR: split at `/scorekeeper/` to get the root and `t`. If the root has no paired server, show "Pair this server first" with the scan button. Accept `https` only. Dev builds also allow `http` to private-network addresses and the Android emulator (`10.0.2.2`). This needs ATS and Android cleartext exceptions in the dev build config only.
- Link tokens are stored per game in SecureStore and sent only in `X-Scorekeeping-Token`.
- The setup QR is read only by the in-app scanner. The app does not register `ultiorganizer-app://` as a deep-link handler: Android does not verify custom schemes, so a system-camera scan could hand the token to another app claiming the scheme.

### Offline-first sync

The device is the source of truth during play. The server is a mirror the app keeps converging to.

1. **Event log.** Every user action (goal, timeout, spirit stoppage, tap, roster, metadata, finalize, undo) becomes a row in a per-game ordered `outbox` with an `Idempotency-Key` (UUID v4). The row and its key are written to SQLite *when the action happens*, before any network attempt, so a resend after a crash reuses the same key.
2. **Sender.** One in-flight request per game, strictly in order. On a network error or timeout, retry the same request with backoff. On `429`/`503`, wait for `Retry-After`. On success, store the returned `token` and `result`, then mark the row sent.
3. **Conflicts.** On `409 goal_changed`, `409 score_changed` or `409 fixture_changed`, pause the queue and refetch entry context. A sheet then shows "Someone else changed this game" with server vs phone and two choices: *Keep the server version* (drop unsent rows and rebuild local state) or *Upload my version* (`PUT game-data` with `If-Match` set to the fresh token and a new key). Other 4xx answers mark the row failed with the server's error path, shown inline.
4. **Fall-behind.** When the queue holds more than about 10 unsent rows, or a game was kept fully offline, offer a full upload instead of replay, using the last token received.
5. **Finalize** is sent only when the outbox is empty, with the score the server last confirmed. The end-of-game screen blocks until it's synced, or offers to save the game on the phone and retry automatically.

**Undo** follows what the live API can do:

- An action not yet sent is simply dropped from the outbox.
- A sent goal that is still the last goal queues `DELETE goals/{num}` with the `num` the server returned for it.
- A sent timeout, spirit stoppage or older goal has no live delete. The app corrects it locally and syncs with a full upload (`If-Match` = last token).
- A roster change is a new `PUT rosters/{side}`. A score tap is undone by a `-1` tap.

Sync status is always visible: a small dot in the game header (synced / sending / offline with N queued / needs attention).

### Game state

A pure reducer over the event log gives the scoreboard, goal list, timeouts used, and the derived scores. It is unit-tested against the API's validation rules: time ordering, Callahan without an assist, scorer differs from assist, timeout limits, hidden times as `null`.

### Timekeeper engine

A port of `script/timekeeper.js` into a pure, clock-injected TypeScript module:

- The scenarios are Start of game, Start of point, Timeout (including the timeout-before-pull rule from `docs/timekeeper.md`), Halftime, Call or discussion (repeating restart signal), and Disc retrieval.
- Elapsed time is derived on every frame from stored anchors, never from accumulated ticks. The anchors are wall-clock (`Date.now()` at start plus accumulated pause time) and are persisted in SQLite on every start, pause and resume, because iOS often kills a backgrounded app during a 100-minute game, and a monotonic clock starts from zero after a relaunch. The monotonic clock only smooths the display within one run. Trade-off: changing the device clock mid-game shifts the timers. This is acceptable, and the same as the web Timekeeper.
- A game clock counts up, can pause, and logs marks. Halftime and time-cap notices come from the template cap times.
- Signals give a colour state, a generated beep, and haptics (one pulse for a warning, two for the final signal).
- **Backgrounding.** JS timers stop on iOS, so every pending signal is also scheduled as a local notification with sound when the app goes to background, and cancelled when it returns. Keep-awake is on while a timer or the clock runs.
- Template source order: server S1 → cached copy → bundled WFDF defaults. Local edits are per device, like the web Timekeeper.

### Integration of the two halves

- The game clock is shared. A goal, timeout or spirit stoppage is stamped with the current clock time rounded as the web Scorekeeper does, and can be edited before saving. With hidden times the app sends `null` and shows no times.
- *Timeout* in the action bar asks which team (two team-coloured buttons in a small sheet; the web Timekeeper's Timeout has no team). Choosing one both starts the timeout action timer and records the timeout. *Spirit stoppage* pauses the game clock and records the stoppage.
- A recorded goal starts the *Start of point* timer automatically. This can be turned off in settings.
- *Start of game* asks for the starting offence (`PATCH metadata`) and starts the game clock. The *Halftime* action also saves `metadata.halftime` with the current clock time.
- Timeout slots come from `rules.timeouts_per_team`. A used-up team's button is disabled with a terse hint.
- Cap notices offer "Record cap" (S2) with a suggested target one above the leading score.
- **Timekeeper-only mode**: opened from the home screen with no game. It shows the same timer screen without the scoreboard.

## Screens and flow

```
Home ─┬─ Pair server (scan setup QR / paste)        first run, or Settings
      ├─ Scan scorekeeping QR ─→ Game list ─→ Game
      ├─ Timekeeper only
      └─ Recent games (local, with sync state)

Game ─┬─ Rosters (per team; tap to toggle, jersey number, C / SC)
      ├─ Live (default tab)
      ├─ Sheet (goal list, edit / delete last, timeouts, metadata)
      └─ Finish (summary, finalize)
```

- **Game list**: games the link covers, sorted by time, grouped by field. Outside the game day it shows "Opens on <date>" from `available_from`.
- **Rosters**: prefilled from the entry context. Players appear as large chips with the jersey number first; Team captain and Spirit captain show as `C` and `SC` badges (approved abbreviations in `docs/terminology.md`). Unaccredited players are greyed out with a "Not accredited" hint, when the event requires accreditation.
- **Live**: the main screen (wireframe below).
- **Goal sheet** (bottom sheet after tapping a team's score): a grid of the team's jersey numbers. Tap the assist, then the scorer, and the goal saves on the second tap. *Callahan* and *Unknown* are chips above the grid (the API accepts a `null` scorer and assist). For result-only keeping (no rosters), tapping a score records a score tap instead.
- **Finish**: the final score, a short summary, and the sync state. "Save final result" uses a confirm sheet that shows the score, as the web `endgame.php` does.

## Visual design

### Context

Used outdoors, in direct sun or under floodlights, one-handed, often while running a clock. People glance at it for a second and need no learning curve. The design comes from the field itself: the two teams facing each other, the officials' signal colours, and big readable numbers.

### Tokens

| Token | Light | Dark | Role |
| --- | --- | --- | --- |
| `surface` | `#FFFFFF` | `#000000` | true white and true black, the most contrast for glare and OLED |
| `ink` | `#0A1620` | `#F2F5F7` | text, 15:1+ on surface |
| `line` | `#C9D2D9` | `#2A3640` | dividers, chip outlines |
| `signal-go` | `#0F8A4B` | `#3DDC84` | running timer, synced |
| `signal-warn` | `#E8A200` | `#FFC93C` | warning signal, cap notice |
| `signal-stop` | `#D21F3C` | `#FF5A6E` | final signal, time cap, needs attention |

Team colours are the one bold move. Each side gets a colour picked from a set of 12 jersey-like swatches when the game opens; light and dark are allowed, and text colour flips automatically to keep 7:1 contrast. The two halves of the live screen are flooded with those colours, so the scorekeeper sees the field, not an interface. Everything else stays neutral.

Theme: Light, Dark, or follow the system (the default). No sunset-based auto mode: that would need location permission for a cosmetic feature.

### Type

- **Barlow Condensed** (SemiBold/Bold) for the score, clocks and jersey numbers, with tabular figures. A condensed face fits "15" at 160 pt on half of a phone screen.
- **Atkinson Hyperlegible Next** for all other text. It was designed for legibility, which suits glare and quick glances.
- Scale: 13 / 16 / 20 / 28 / 44 / 96 / 160. Sentence case everywhere; no all-caps labels.

### Live screen

```
┌──────────────────────────────┐
│ ● Field 3 · Pool A    ⋯      │  sync dot, game, menu
│ 23:41  game clock   ⏸  ⚑    │  pause, mark
├──────────────┬───────────────┤
│              │               │
│   Team A     │    Team B     │  flooded team colours
│     07       │      06       │  160 pt, tap = goal sheet
│  TO ●●○      │   TO ●○○      │  timeouts left (TO: approved abbreviation)
├──────────────┴───────────────┤
│  Start of point     0:52     │  action timer bar, colour = signal state
│  ▸ next: defence warning 60  │
├──────┬──────┬──────┬─────────┤
│Point │Timeout│Spirit│ More ▾ │  thumb zone, 64 pt targets; More = call, disc, halftime
└──────┴──────┴──────┴─────────┘
```

- The action timer bar fills the full width and changes colour at each signal (go → warn → stop), so the state reads from across a field.
- In landscape (tablet on a table) the halves sit side by side with the timer bar centred below.
- Motion only answers an action: the score number rolls on a goal, the bar pulses once at a signal, and a sheet slides up. Reduce Motion is respected.
- Hints are minimal: one line per state, with no legends or tutorials on the live screen.

### Accessibility and quality floor

Minimum 48 pt targets (64 pt on the live screen), Dynamic Type up to 200% on everything except the score and clocks, VoiceOver/TalkBack labels (for example "Team A, 7 points, 2 timeouts left"), colour never the only signal (the bar also shows the signal text), and haptics for every save.

## Localization

i18next with keys in English. Finnish, German and Spanish are seeded from the server `.po` msgstrs for shared terms (goal, assist, timeout, spirit stoppage, halftime cap, time cap, starting offence…) so the app and the website use the same words. Server API error messages are English JSON, so the app maps each `error.code` to its own translated sentence and keeps the server text only as a detail.

## Quality and tooling

- TypeScript strict, ESLint (flat config), Prettier.
- Unit tests (Jest): the reducer, the outbox state machine, the timekeeper engine with a fake clock, and QR parsing.
- Contract tests: run the client against the dev stack (`docs/dev/compose.yaml` in `ultiorganizer`) for every endpoint, including idempotent replay and `409` paths. Generated types are regenerated in CI when `openapi.json` changes.
- E2E: Maestro flows (pair → scan → roster → goals → finalize; offline then reconnect; conflict) on Android emulator and iOS simulator.
- CI: GitHub Actions for lint, typecheck, unit tests and EAS preview builds. Store builds use EAS Build and Submit; JS-only fixes ship through EAS Update.
- Crash reporting: Sentry, opt-in, with no player names in breadcrumbs.

## Privacy

The app stores player names and numbers for the games it opened. Local game data is deleted 30 days after a game is finalized and synced, and can be deleted by hand from Recent games. Tokens live only in SecureStore. There are no analytics by default. A privacy policy page is required for store listing.

## Phases

1. **Foundation**: Expo project, design tokens and core components, i18n skeleton, SQLite schema, generated API client, server pairing (paste token; setup-QR parsing ready for S0), and QR scan with game list.
2. **Timekeeper**: the engine port with tests, persisted clock anchors and relaunch recovery, the timer screen, background notifications, keep-awake, bundled WFDF templates, and Timekeeper-only mode. Usable on its own and shippable as an early TestFlight / internal track build.
3. **Live scorekeeping**: entry context, rosters, the live screen, goal sheet, timeouts and spirit stoppages, score taps, the outbox with idempotent replay, the sync indicator, and finalize. Needs server S0 and S1.
4. **Resilience**: conflict sheet, full-upload fallback, offline-only games, undo per the rules above, and crash recovery from the event log.
5. **Caps and polish**: S2 caps, landscape layout, accessibility pass, translations reviewed, store assets, and the privacy policy.
6. **Release**: Maestro suite green on both platforms, beta at a real tournament, then store submission.

## Verification per phase

- App: `tsc --noEmit`, lint, Jest, and Maestro on both platforms. Screenshots of every screen in Light and Dark, phone and tablet, en and fi (longest strings: de).
- Server (S0–S2): the `ultiorganizer` rules in `AGENTS.md`: `composer check`, DB-access checker, user-language review, screenshot-verify of `admin/apitokens.php`, harness cases, `./test:matrix`.
- End to end: a full game against the dev stack, then the result and scoresheet checked on the website, and the history rows showing source `api` with the app token.
