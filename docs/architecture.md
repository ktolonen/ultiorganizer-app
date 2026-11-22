# Architecture

The phone is the source of truth during play. The server is a mirror that the app keeps converging to. Every rule that decides what an entry may be lives in pure TypeScript modules with unit tests; the screens only call them.

```
src/app/         Expo Router screens; game/[serverId]/[gameId].tsx is the live game
src/api/         HTTP transport, typed client generated from api/openapi.json
src/game/        reducer (the scorekeeping rules), runtime (apply, undo, upload), goal picker, game screen parts
src/sync/        outbox state machine and the sender loop
src/timekeeper/  engine (pure), signals (sound, haptics, notifications), UI
src/store/       SQLite migrations, repository, zod read guards, SecureStore tokens
src/services/    pairing, field links, game lists and saved server data, templates
src/pairing/     QR parsing
src/i18n/        catalogs en/fi/de/es
src/ui/          tokens, theme, shared components
```

## Server contract

The app talks to the Ultiorganizer scorekeeping API, documented in the server's [`docs/api.md`](https://github.com/ktolonen/ultiorganizer/blob/master/docs/api.md) ("Scorekeeping app endpoints"). `api/openapi.json` is a copy of the server's spec, and `src/api/schema.d.ts` is generated from it. The spec leaves the scorekeeping read responses as bare objects, so the entry context and the game list are validated with zod (`src/game/types.ts`, `src/api/http.ts`).

Every request carries two credentials: the app token from pairing in `Authorization: Bearer`, and the scorekeeping link token from the QR code in `X-Scorekeeping-Token`. Neither alone gives access.

The app works against older servers too. It probes each optional route once per server or game and remembers a `404` (or `405`) instead of checking version numbers:

| Missing on the server                         | What the app does                            |
| --------------------------------------------- | -------------------------------------------- |
| setup QR                                      | pairing by pasting the address and token     |
| Timekeeper templates                          | bundled WFDF defaults                        |
| caps                                          | caps stay on the phone (`capsAbsent`)        |
| game clock                                    | the clock stays on the phone (`clockAbsent`) |
| goal, timeout and spirit stoppage corrections | a whole-game upload (`correctionsAbsent`)    |
| game note                                     | the Finish tab hides the note                |

## Pairing and links

A setup QR holds `ultiorganizer-app://pair?root=<root>&token=<token>`; a scorekeeping QR holds `<root>/scorekeeper/?t=<32 hex>`. Both are read only by the in-app scanner (`src/pairing/qr.ts`); the setup link can also be pasted on the pairing screen, for a phone that shows the server page and so cannot scan it. The app does not register the `ultiorganizer-app://` scheme, because Android does not verify custom schemes, and another app claiming it could receive the token from a system camera scan. A scanned root must match a paired server. Release builds accept only `https`; development builds also accept `http` to private-network addresses and the Android emulator.

## Single-game data flow

1. A user action becomes a `GameEvent` and goes to the pure reducer in `src/game/reducer.ts`. The reducer mirrors the server's validation (time ordering, Callahan without an assist, scorer differs from assist, timeout limits, hidden times as `null`, cap rules), so an event it accepts is one the server should accept, and an event it refuses never enters the outbox.
2. `applyEvent` in `src/game/runtime.ts` runs the reducer and, only for an accepted event, enqueues an outbox row.
3. The outbox (`src/sync/outbox.ts`) is a pure state machine over JSON. Each row gets its `Idempotency-Key` when it is created, before any network call, so a resend after a crash reuses the same key.
4. `src/sync/sender.ts` drives it with one request per game in flight, strictly in order: `nextToSend` → `markSending` → request → `onResponse`. Responses update the concurrency token (`ETag`) and the confirmed result.
5. The outbox is persisted after every transition, so the queue survives the app being killed. A row left "sending" by a crash is sent again with the same key.

Network errors and timeouts retry the same request with backoff; `429` and `503` wait for `Retry-After`. A `2xx` that is not a write answer, such as a captive portal page, is retried with the same key, never marked sent.

### Refusals and conflicts

A refused write pauses the queue (`conflict`, `auth` or `failed`) rather than skipping the row, because later rows were made on top of it. On `409 goal_changed`, `score_changed` or `fixture_changed` the app refetches the entry context and shows the conflict sheet:

- _Keep the server version_ drops every unsent row, takes the fresh token and rebuilds local state from the server.
- _Upload my version_ sends the whole game with `PUT game-data` (`toGameData` in `src/game/upload.ts`), with `If-Match` set to the fresh token and a new key.

The same full upload is the fallback whenever a correction can't be expressed through the live routes, and is offered when more than 10 rows are waiting (`FALL_BEHIND_ROWS`).

### Undo and corrections

- An entry not yet sent is dropped from the outbox.
- A sent goal that is still the last goal queues `DELETE goals/{num}` with the number the server gave it.
- Removing a team's last timeout or spirit stoppage sends `DELETE timeouts|spirit-stoppages/{side}/{num}`.
- Changing a sent goal's players sends `PATCH goals/{num}` with only the changed fields, also on a final game.
- A roster change is a new `PUT rosters/{side}`; a score tap is undone by a `-1` tap.
- Anything else (an older goal or timeout, a server without the correction routes, a `*_changed` or `goal_not_found` answer) becomes a full upload. Its `If-Match` still catches a real conflict.

### Outside the token

Caps, the game note and the game clock are not part of the concurrency token or the full upload. Their rows stay queued ahead of an upload instead of being folded into it, and a refusal settles the row without pausing the queue:

- **Caps** go through `PUT`/`DELETE caps/{type}`.
- **The game note** is written with `PUT note`, only by a personal (user-scoped) app token. The first `403 user_token_required` is remembered for that server until it is paired again.
- **The game clock**: each start, resume, pause and reset of the game's clock is sent with `POST clock`. A start sent late leaves the server behind, so after the next pause a reading more than 2 s off the phone's is corrected with `set`. When a game opens with the server's clock running or paused and this phone's clock for it has never run, the phone takes it over.

### Finalize

Finalize is sent only when the outbox is empty, with the score the server last confirmed.

## Saved server data and local games

After a link's game list loads, the list and the entry context of each game not yet on the phone are saved in the background, one request at a time, skipping final games and any saved in the last 10 minutes, because the API's rate limit (120 requests a minute per app token and address) is shared with live writes. Saving stops at a network failure, a rate limit or a refused link. An older saved context is refreshed with `If-None-Match`.

Opening a game or its list falls back to saved data when the server can't answer (no connection, timeout, `408`/`429`, any `5xx`, or a body that is not the server's), never on a refusal: a `401`/`403`/`404` still shows an error. A game opened that way is an ordinary game; its entries queue as during any outage, and a server that moved on in the meantime surfaces through the conflict sheet. Saved data is dropped a week after it was fetched, when its game is opened, or with its server.

Local games belong to a reserved server row (id 0, root `local:`). Their entry context is built on the phone with no players, their outbox is offline-only and never sends, and they are never purged automatically.

## Timekeeper

`src/timekeeper/engine.ts` is a port of the server's `script/timekeeper.js` as pure functions over plain JSON state, with a clock passed in. `signals.ts` owns sound, haptics and local notifications.

- Elapsed time is always derived from wall-clock anchors (start time, accumulated time, pause time) and the current time, never from counted ticks. The anchors are saved on every start, pause and resume, so a timer survives a backgrounded or killed app. The trade-off, the same as the web Timekeeper, is that changing the device clock mid-game shifts the timers.
- JavaScript timers stop in the background on iOS, so every pending signal is also scheduled as a local notification with sound when the app goes to the background, and cancelled when it returns.
- The beeps are generated WAV square waves (`wav.ts`), with no audio files: one 880 Hz beep for a warning, two 1320 Hz beeps for the final signal.
- Templates come from the server's `GET timekeeper/templates` (with `Accept-Language` for the signal texts), then a cached copy, then the bundled WFDF defaults in `templates.ts`.
- Clocks are scoped: one per game and one for Timekeeper-only mode. The template choice and local edits are per device.

## Persistence

`src/store/sqlite.ts` opens one `expo-sqlite` database (WAL, foreign keys on). `migrations.ts` uses `PRAGMA user_version`; there is no ORM. `repo.ts` is the only writer, and reads go through zod guards in `schemas.ts`, so a corrupted or older row is dropped instead of crashing the app.

App tokens and link tokens live in SecureStore (Keychain or Keystore, `secure.ts`), never in SQLite. Saved game lists are keyed by a SHA-256 of the server id and link token for that reason.

On launch, games finalized and synced more than 30 days ago are deleted with their Timekeeper sessions, along with expired field links and saved server data.

## Builds

`app.config.ts` switches on `APP_VARIANT=development`: a separate bundle ID and name, cleartext `http` allowed on Android and iOS, and `extra.devHttp`, which `src/config.ts` reads to let the QR parser accept `http`. Release builds are `https` only. Over-the-air updates come through `expo-updates`, and a build only takes updates published for its own app version.

## Tests

Tests sit beside the code as `*.test.ts`. The pure cores (reducer, runtime, outbox, sender, Timekeeper engine, QR parsing, i18n) have real coverage. Repository tests run against real SQLite through `node:sqlite`, and HTTP tests use a fake `fetch`. Screens are typechecked and bundled, not exercised on a device.
