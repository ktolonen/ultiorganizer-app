# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

AGENTS.md is the Expo guidance for this repo and applies in full: fetch the versioned Expo docs before touching Expo, EAS or React Native APIs, use `npx expo install` for dependencies, and never hand-edit `ios/` or `android/` (they are generated). Ultiorganizer Scorekeeper is the sideline companion for an Ultiorganizer server. README.md is the overview and current status; `docs/` has the user guide, architecture, design, development, releasing and privacy docs. Keep them in step with the code when behaviour changes.

## Commands

Node 22 (`.nvmrc`). `.npmrc` sets `legacy-peer-deps`, so use plain `npm ci`, not `--force`.

```sh
npm ci
npm run typecheck          # tsc --noEmit
npm run lint               # eslint . (flat config, eslint-config-expo)
npm test                   # jest, preset jest-expo; CI runs `npm test -- --ci`
npx jest src/game/reducer.test.ts               # one file
npx jest -t "name of the test"                  # one test by name
npm run api:types          # regenerate src/api/schema.d.ts from api/openapi.json
npm run format             # prettier --write .
npx expo start             # dev server; camera, SQLite and notifications need a development build
```

CI (`.github/workflows/ci.yml`) runs typecheck, lint, tests, a check that `schema.d.ts` is current after `api:types` (so commit regenerated types), and `expo export` for both android and ios. Run all of those before calling a change done.

Native builds go through EAS, not local Xcode or Android Studio: `APP_VARIANT=development npx eas-cli build --profile development --platform android` (the dev profile allows cleartext http to LAN and `10.0.2.2`). The `preview` profile is internal distribution, `production` auto-increments and submits. Emulators and simulators do not run well in containers.

## Architecture

**Single-game data flow (the core of the app).** A user action goes to the pure reducer in `src/game/reducer.ts`, which mirrors the server's scorekeeping rules and is the only place they live. `applyEvent` in `src/game/runtime.ts` runs the reducer and, only for an accepted event, enqueues an outbox row. The outbox (`src/sync/outbox.ts`) is a pure state machine over JSON: each row gets its `Idempotency-Key` before any network call, so a resend after a crash reuses the same key. `src/sync/sender.ts` drives it with one request per game in flight, strictly in order: `nextToSend` → `markSending` → request → `onResponse`. Responses update the concurrency token and the confirmed result. Because the outbox is persisted after every transition, the queue survives app kills.

Failures are handled by pausing the queue rather than skipping rows. A refused write sets `paused` (`conflict`, `auth` or `failed`), and conflicts route to a sheet where the user keeps the server version or uploads their own. A full-game upload (`toGameData` in `src/game/upload.ts`) is the fallback when a live correction is not expressible through the API, such as removing an older timeout. A game marked `offlineOnly` records state locally and queues nothing.

**Server contract.** `api/openapi.json` is a copy of the server spec. The generated types in `src/api/schema.d.ts` are used by `src/api/client.ts` (openapi-fetch) and `src/api/http.ts`. Scorekeeping read responses are bare objects in the spec, so the entry context and game list are validated with zod in `src/game/types.ts` and `src/api/http.ts` instead.

**Timekeeper** (`src/timekeeper/`) is the same split: `engine.ts` is pure and fully tested, while `signals.ts` owns sound, haptics and local notifications. Timer state is stored as wall-clock anchors, so the clock stays correct while the app is backgrounded. Clocks are scoped per game, or one for Timekeeper-only mode.

**Persistence.** `src/store/sqlite.ts` opens one `expo-sqlite` database (WAL, foreign keys on). `migrations.ts` uses `PRAGMA user_version`, not an ORM. `repo.ts` is the only writer, and reads go through zod guards in `schemas.ts`. Auth tokens live in SecureStore (`secure.ts`), never in SQLite. Repo tests run against real SQLite via `node:sqlite`, and HTTP tests use a fake `fetch`.

**Screens** are Expo Router routes in `src/app/`; `_layout.tsx` defines the navigators and `game/[serverId]/[gameId].tsx` is the live scorekeeping screen. Game screen components are in `src/game/ui.tsx`, with hooks in `useGame.ts`.

**Dev vs release builds.** `app.config.ts` switches on `APP_VARIANT=development`: different bundle ID and name, cleartext http allowed on Android and iOS, and `extra.devHttp`, which `src/config.ts` reads to decide whether the QR pairing parser accepts http. Release builds are https-only; do not loosen that for release.

**Tests** sit beside the code as `*.test.ts`. The pure cores (reducer, outbox, engine, QR parsing, i18n) are the ones with real coverage; screens are typechecked and bundled, not exercised on a device.

**i18n.** Catalogs are in `src/i18n/locales/` (en, fi, de, es): `<lang>.app.json` for the app's strings, which every language must have in full, and `<lang>.terms.json` for the shared terms that `npm run i18n:seed` rewrites from the server `.po` files. The language is the `language` setting, chosen in Settings. Server-provided signal texts are not translated here yet.

The server code is in a sibling checkout, `../ultiorganizer`, and is not part of this repo. Changes that need server support are made there first, not worked around here; list anything still waiting for the server under Status in README.md.
