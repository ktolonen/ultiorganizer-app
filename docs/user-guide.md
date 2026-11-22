# User guide

Ultiorganizer Scorekeeper is used at the sideline: one person keeps the time limits and the scoresheet of a game, and the app sends each entry to the Ultiorganizer server as it happens.

## Before the event

The tournament's Ultiorganizer installation decides who may use the app. An event admin sets the event's _Scorekeeping app_ setting to event admins or to all logged-in users; while it is off, the server refuses the app.

### Pair the server

The app needs an app token from the installation once. Get its setup QR code from one of these pages:

- **Scorekeeping app** in the Ultiorganizer menu, for a logged-in user. It appears while a current event admits you. The token there is your own: games you keep are recorded under your name, and only this kind of token can save a game note. _Replace token_ cuts off a lost phone.
- **API tokens** in the administration pages, for tokens an administrator hands out.

In the app, tap _Pair a server_ and scan the setup QR, or paste the server address and the token. Anyone holding the QR code or the token can keep score with any scorekeeping link of that installation, so keep it private. Several installations can be paired. _Forget_ in Settings removes a server and deletes its games from the phone.

## Keeping score

1. Tap _Scan QR for scorekeeping_ and scan the game's or the field's scorekeeping QR code, the same code Scorekeeper uses in the browser.
2. A game link opens the game. A field link lists its games for the day; outside the game day it explains that games open for scorekeeping only on their game day, and shows the date. A field link stays on Home under _Field links_, so it reopens without the camera.
3. The game has four tabs:
   - **Rosters**: tap players to put them on the game roster. Team captain and Spirit captain show as `C` and `SC`.
   - **Live**: the score, the game clock, the Timekeeper and the actions. Tap a team's score to record a goal: tap the assist, then the scorer. _Callahan_ and _Unknown_ are above the player grid. Without rosters, tapping a score just counts the point.
   - **Sheet**: the goal list, timeouts, spirit stoppages, caps, starting offence, halftime and the scorekeeper's name. Tap a goal to change its players (for a team with a roster). _Undo last goal_ removes the latest goal.
   - **Finish**: the final result, the game note and the sync state. _Finish game_ asks you to confirm the score before saving it as final.

The goal times come from the game clock. Starting the game clock also starts the game on the server. The server shows the clock as the app runs it.

Your name in Settings is filled in as the game's scorekeeper when a game opens without one.

### Sync status

The game header always shows whether the entries have reached the server: _Synced_, _Sending_, _N queued_, _Offline, N queued_, or _Needs attention_. Entries are saved on the phone before they are sent, and they are sent in order, so closing the app or losing the connection loses nothing. _Send now_ retries at once.

If someone else changes the game on the server at the same time, sending stops and the app shows _Someone else changed this game_, with the server's score and this phone's score side by side. _Keep the server version_ drops what this phone has not sent yet. _Upload my version_ replaces the game on the server with this phone's scoresheet.

Some corrections, such as removing an older timeout, can't be sent as a single change. The app then uploads the whole game instead, which it also offers when many entries are waiting.

### Without a connection

When a field link's game list loads, the app also saves its games in the background. They open later without a connection, and the entries are sent when the connection returns. The saved data is kept for a week.

For a game the server doesn't know, for example after a late schedule change, use _Local game_: type the team names and keep the result, timeouts and the clock. A local game stays on this phone and is never uploaded, so enter its result in Ultiorganizer afterwards.

## Timekeeper

_Timekeeper only_ on Home opens the timer without a game or a server. In a game, the Timekeeper sits on the Live tab and shares the game clock.

- Actions: Start of game, Start of point, Timeout, Halftime, Call or discussion, and Disc retrieval. Each runs a timer with warning and final signals: a colour change, a beep and a vibration (one for a warning, two for the final signal).
- A recorded goal starts the Start of point timer automatically. Turn this off in Settings.
- The halftime and time cap times show as notices; _Record cap_ saves a cap to the scoresheet.
- The time limits come from the server's Timekeeper templates when the server has them, and otherwise from the WFDF defaults built into the app. Pick another template under _Time limits_.
- The screen stays on while a timer runs. When the app is in the background, the signals still arrive as notifications with sound, so allow notifications when the app asks.
- The timers are based on the phone's clock, so they stay right after the app is closed and reopened. Changing the phone's time during a game moves them.

## Removing data

Games are deleted from the phone 30 days after they are final and synced. Delete one sooner from _Recent games_ on Home. Forgetting a server deletes its games. See [privacy](privacy.md) for everything the app stores.
