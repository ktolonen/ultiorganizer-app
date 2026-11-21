# Ultiorganizer Scorekeeper

A phone app for the person at the sideline of an ultimate game. It keeps the WFDF time limits (Timekeeper) and the score and scoresheet (Scorekeeper) on one screen, and syncs them with an [Ultiorganizer](https://github.com/ktolonen/ultiorganizer) installation through its scorekeeping API. Built with Expo / React Native and TypeScript for Android and iOS.

- **Timekeeper**: start of game, start of point, timeouts, halftime, calls and disc retrieval, with warning and final signals as sound, vibration and colour, also while the phone is locked. Works on its own with no server.
- **Scorekeeper**: rosters, goals with assist and scorer, timeouts, spirit stoppages, caps, the game clock and the final result, sent to the server as they happen.
- **Offline first**: every entry is saved on the phone first and sent in order when there is a connection. A game list loaded once still opens without a connection.
- In English. Finnish, German and Spanish cover the shared game terms (goal, timeout, spirit stoppage…) so far, and the rest of the app falls back to English.

## Install

Android: download the APK from [Releases](https://github.com/ktolonen/ultiorganizer-app/releases) on the phone and open it. Android asks once to allow installing apps from the browser or file manager. iOS builds are not published yet.

To keep score, the Ultiorganizer installation needs the scorekeeping API, and the event's _Scorekeeping app_ setting has to admit you. Timekeeper-only mode needs neither. See the [user guide](docs/user-guide.md) for pairing a server and keeping score.

## Documentation

- [User guide](docs/user-guide.md): pairing, scanning, keeping score, offline use
- [Architecture](docs/architecture.md): data flow, sync and conflicts, the Timekeeper engine, storage
- [Design](docs/design.md): colours, type and accessibility rules
- [Development](docs/development.md): setup, tests, local builds, the API client
- [Releasing](docs/releasing.md): EAS build profiles and publishing a release
- [Privacy](docs/privacy.md): what the app stores and sends

## Status

Version 0.1.0 is the first release. All of the scorekeeping and timekeeping above is built, and its logic is covered by unit tests. Not done yet: a landscape layout, an accessibility pass with VoiceOver and TalkBack, full Finnish, German and Spanish translations, end-to-end tests on devices, contract tests against a live server, and store listings.

## License

Ultiorganizer Scorekeeper is released under the [GNU General Public License v3](LICENSE) or (at your option) any later version, the same as Ultiorganizer. The Timekeeper engine is a port of the server's `script/timekeeper.js`, and the shared terms in the fi, de and es catalogs come from the server's translations.
