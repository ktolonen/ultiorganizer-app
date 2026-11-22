# Ultiorganizer Scorekeeper

A phone app for the person at the sideline of an ultimate game. It keeps the WFDF time limits and the scoresheet on one screen and sends every entry to the tournament's [Ultiorganizer](https://github.com/ktolonen/ultiorganizer) as it happens, so results, scorers and the game clock show up on the tournament site live. It also works as a plain timekeeper with no server at all.

## What you can do

### Get set up in seconds

- **Pair with a tournament** by scanning the setup QR code from Ultiorganizer, or by pasting the server address and token. Pair several installations if you work at more than one event.
- **Open a game by scanning** its scorekeeping QR code, the same code Scorekeeper uses in the browser. Scan a field's code instead to see all of that field's games for the day; the field stays on the home screen, so the next game opens without the camera.
- **Set your name once** in Settings, and it is filled in as the scorekeeper of each game you open.

### Keep the scoresheet

- **Pick the rosters** by tapping the players who are at the game. Captains and Spirit captains are marked.
- **Record goals** with two taps: the assist, then the scorer. Callahans and unknown players have their own buttons, and without rosters a tap on the score just counts the point.
- **Record everything else on the sheet**: timeouts, spirit stoppages (when the event uses them), caps, the starting offence and halftime.
- **Run the game clock**. Goal times come from it, starting it starts the game on the tournament site, and spectators see the clock as you run it.
- **Fix mistakes** by tapping a goal to change its players, or undoing the last goal.
- **Finish the game** by confirming the final score, and, with your own app token, add a game note for the organisers.

### Keep time

- **Run every WFDF time limit**: start of game, start of point, timeouts, halftime, calls and discussions, and disc retrieval.
- **Get warning and final signals** as a colour change, a beep and a vibration, also when the phone is locked or the app is in the background.
- **Let goals start the clock**: a recorded goal starts the start-of-point timer automatically, unless you turn that off.
- **See halftime and time cap** coming as notices on the screen, and record a cap to the scoresheet with one tap.
- **Use the event's own limits**: the app picks up the tournament's Timekeeper templates, falls back to the WFDF defaults, and lets you choose another template for each game.
- **Use it alone**: _Keep time only_ runs the timers with no game and no server.

### Keep going without a connection

- **Nothing is lost**: every entry is saved on the phone first and sent in order when the connection is there. Closing the app or losing the signal mid-game is fine.
- **Always know where you are**: the game header shows _Synced_, _Sending_, _N queued_, _Offline_ or _Needs attention_, and _Send now_ retries at once.
- **Open games offline**: a field's games are saved on the phone when its list loads, so they open later at a field with no signal.
- **Score a game the server doesn't know**, such as one added after a late schedule change, as a local game on the phone.
- **Settle conflicts** when someone else edits the same game: the app shows both scores side by side, and you keep the server's version or upload your own.

### Stay in control of your data

Games are removed from the phone 30 days after they are final and synced, and you can delete one sooner or forget a whole server. Tokens are kept in the phone's secure storage. See [privacy](docs/privacy.md) for everything the app stores and sends.

## Install

Android: download the APK from [Releases](https://github.com/ktolonen/ultiorganizer-app/releases) on the phone and open it. Android asks once to allow installing apps from the browser or file manager. iOS builds are not published yet.

To keep score, the Ultiorganizer installation needs the scorekeeping API, and the event's _Scorekeeping app_ setting has to admit you. Timekeeper-only mode needs neither. The [user guide](docs/user-guide.md) walks through pairing a server and keeping a game.

The app is in English, Finnish, German and Spanish. It follows the phone's language, and _Language_ in Settings picks one of the four instead. The game terms (goal, timeout, spirit stoppage…) are the server's own translations, so the app and the website use the same words.

## Status

The server's translations do not have the Timekeeper's built-in signal texts (_Offence warning_, _Start of play_…) yet, so those stay in English until the server's `.po` files have them and `npm run i18n:seed` is run again. Signal texts from the server's own templates are translated by the server.

Pasting the setup link on the pairing screen needs the server's copyable setup link on the Scorekeeping app page (ktolonen/ultiorganizer#152, not merged yet). Until then, paste the address and the token.

Version 0.2.0 is the current release, and everything above is in it. Still to come: iOS builds, a landscape layout, a screen reader pass with VoiceOver and TalkBack, a native speaker's review of the Finnish, German and Spanish strings, and store listings.

## Documentation

For users:

- [User guide](docs/user-guide.md): pairing, scanning, keeping score, the Timekeeper, offline use
- [Privacy](docs/privacy.md): what the app stores and sends

For developers:

- [Development](docs/development.md): setup, tests, local builds, the API client
- [Architecture](docs/architecture.md): data flow, sync and conflicts, the Timekeeper engine, storage
- [Design](docs/design.md): colours, type and accessibility rules
- [Releasing](docs/releasing.md): EAS build profiles and publishing a release

## License

Ultiorganizer Scorekeeper is released under the [GNU General Public License v3](LICENSE) or (at your option) any later version, the same as Ultiorganizer. The Timekeeper engine is a port of the server's `script/timekeeper.js`, the shared terms in the fi, de and es catalogs come from the server's translations, and the language flags are the server's.
