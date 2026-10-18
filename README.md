# Ultiorganizer Field

A phone app for the person at the sideline: WFDF time limits (Timekeeper) and score and scoresheet (Scorekeeper) on one screen, syncing with an [Ultiorganizer](../ultiorganizer) installation through its scorekeeping API. Expo / React Native, TypeScript, Android and iOS.

The plan is in [PLAN.md](PLAN.md); what is built, stubbed and blocked is in [STATUS.md](STATUS.md).

## Develop

```sh
nvm use                      # Node 22
npm ci                       # .npmrc sets legacy-peer-deps: openapi-typescript wants TypeScript 5, the SDK ships 6
npm run typecheck && npm run lint && npm test
npx expo start               # dev server; a development build is needed for camera, SQLite, notifications
APP_VARIANT=development eas build --profile development --platform android   # allows http to LAN / 10.0.2.2
```

Develop on the host. Jest, `tsc` and ESLint need only Node; emulators and simulators do not run well in containers, and native builds go through EAS. Docker is for the server's dev stack (`docs/dev/compose.yaml` in `ultiorganizer`), used for contract tests.

## API client

`api/openapi.json` is a copy of the server's spec (branch `scorekeeping-api-live`). `npm run api:types` regenerates `src/api/schema.d.ts`. The spec leaves the scorekeeping read responses as bare objects, so the entry context and the game list are parsed with zod (`src/game/types.ts`, `src/api/http.ts`) from the server's `ScorekeeperEntryContext()` and `ScorekeeperDiscoverGames()`.

## Layout

```
src/app/         Expo Router screens
src/api/         HTTP transport, typed client, templates read
src/game/        reducer, runtime (apply/undo/upload), goal picker, game screen parts
src/sync/        outbox state machine and sender loop
src/timekeeper/  engine (pure), signals (sound, haptics, notifications), UI
src/store/       SQLite migrations, repository, zod read guards, SecureStore tokens
src/pairing/     QR parsing
src/i18n/        catalogs en/fi/de/es (shared terms seeded from the server .po files)
src/ui/          tokens, theme, shared components
```
