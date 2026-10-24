# Build Your Own App with App Studio for Fire TV

Describe an app on your phone and play it on your TV seconds later.

Build Your Own App lets anyone create a small interactive TV app by describing it in plain words, such as "an animal quiz for my kids, two teams, three rounds". There's no code to write and nothing to install per app.

## What it does

The project has two parts:

- App Studio: one TV app you install once, on Fire OS or Vega OS.
- The builder: a phone-sized web page where you describe the app you want.

The flow:

1. Pair once. App Studio shows a 6-character code. You enter it in the builder, and the TV is linked.
2. Describe the app. The service plans it, writes it, checks that it works with a TV remote, and shows a TV-sized preview.
3. Tap Send to TV. The app shows up in My Apps on the TV with a "ready" banner. Play it with the D-pad, OK and Back.

Each creation is a real interactive app with screens, scoring, timers and remote handling. It runs inside App Studio in a sandbox with no network access. Example uses: a children's learning quiz, a family trivia night, and an at-home yoga session.

## How it works

```
 Phone (builder.html)            server.js (your device, 127.0.0.1 only)       TV (App Studio)
 ─────────────────────           ─────────────────────────────────────────       ──────────────────
 enter pairing code      ───►    device-code pairing (like RFC 8628)     ◄───    shows code, polls
 describe the app        ───►    plan → write → validate → store
 Send to TV              ───►    delivery for that TV                    ───►    "ready" banner
                                 short-lived signed launch link          ───►    runs app in sandbox
```

- Server (`server.js`): a single Node.js file with no npm dependencies. It handles pairing, the plan → write → validate → deliver pipeline, versioning, and signed launch links.
- App writer: by default, apps are written from built-in templates: a quiz or trivia game, and an interval timer for yoga or workouts. `model_writer.js` can use a model on Amazon Bedrock instead. Either way, every app goes through the same validator.
- Validator: checks each app's size, that it makes no network calls and uses no `eval`, that it has no text inputs, that its text is large enough for TV, that it handles Back, and that it matches its plan. An app that fails isn't delivered.
- Runtime SDK: added to every app by the platform. It provides D-pad spatial focus, Back and pause handling, and focus that stays inside overlays, and it reports the current screen to the host app.
- Player page (`public/player.html`): the TV interface (pairing, My Apps, banner, running apps). Apps run in `<iframe sandbox="allow-scripts">` under a strict Content-Security-Policy, and they talk to the Player only through `postMessage`.
- TV apps:
  - Fire OS (`android-player/`): a thin Android (Java) WebView app with Leanback launcher support.
  - Vega OS (`vega-player/`): a React Native for Vega app built from the Vega SDK's `vegaWebview` template.
  - Both host the same Player page. Both also have an offline demo mode that runs bundled apps without a server.

### Security defaults

- The server listens on `127.0.0.1` only and accepts only `127.0.0.1:4848` / `localhost:4848` Host headers. It sends no CORS headers and refuses cross-site writes.
- Devices reach it only through a tunnel over the device connection: `adb reverse` for Fire OS, `vda reverse` for Vega OS.
- The TV apps allow plain HTTP to `localhost` only.
- Generated apps can't reach the network or see App Studio's page or storage.

## Project layout

```
server.js                     server: pairing, pipeline, validator, templates, runtime SDK
model_writer.js               optional Amazon Bedrock app writer
public/builder.html           phone builder
public/player.html            TV player page (also bundled into both TV apps)
android-player/               Fire OS / Android TV app (Java, Gradle)
vega-player/                  Vega OS app (React Native for Vega, TypeScript)
test/                         automated tests
```

## Requirements

- macOS (Apple Silicon recommended) or Linux
- Node.js 18 or newer
- Google Chrome, for the automated browser test

Optional, for the TV apps:

- Fire OS: JDK 17, Gradle, the Android SDK command-line tools, and an Android TV emulator or a Fire TV with ADB debugging on
- Vega OS: the Vega SDK, installed with Amazon's public installer from the Vega developer docs on developer.amazon.com. It includes the Vega Virtual Device.

On macOS with Homebrew:

```bash
brew install node
brew install --cask google-chrome
```

## Quick start (browser only, about 2 minutes)

```bash
cd prompt-to-tv
node server.js
```

You should see `http://127.0.0.1:4848`. There's no `npm install` step for the server.

If port 4848 is already in use, pick another one, for example `PORT=4850 node server.js`, and use that port in the addresses below.

1. Open http://127.0.0.1:4848/player.html. This is the TV. Note the 6-character code.
2. Open http://127.0.0.1:4848/builder.html in a second window (not a tab), so you can watch the TV and the phone side by side. This is the phone. To make it phone-sized on a Mac, press Cmd+Option+I, then Cmd+Shift+M, and pick a phone such as iPhone 12 Pro.
3. In the builder:
   - type the code into the six boxes. It pairs on its own once all six are in (pasting works too).
   - tap an idea card, tap the dice for a random idea, or type or dictate your own with the microphone
   - choose Plan it, adjust the plan if you like (name, teams, rounds, timings), then Build it
   - try the app in the preview with the on-screen remote, or swipe and tap on the preview
   - pick your TV and choose Send to TV
4. On the player page, open the app from the banner, and play it with:
   - the arrow keys (D-pad)
   - Enter (OK)
   - Escape (Back, which opens the pause menu)

While you do this, the builder shows each step live: Sent, then On your TV once the TV picks it up, then Playing once the TV opens it.

Things to try:
- Type a wrong code first to see the error, then the real one.
- On the plan, change the number of teams or the seconds per question, then rename the app. The TV's title screen uses your name.
- In the preview, press OK to start, swipe up or down to move between answers, and press Back to pause.
- After Send to TV, open the app on the TV and watch the builder switch to Playing.
- Tap Make another app to start over without pairing again.

To reset all pairings and apps, stop the server and delete `data.json`.

### What the builder does on a phone

- A header chip shows the paired TV and whether it's on right now.
- A progress bar across the top tracks Pair, Describe, Build and Send. Tap a step to jump to it.
- The plan is editable: rename the app and change the numbers with the + and − buttons (hold to repeat). The summary, the estimated length and what the TV shows all follow your changes.
- The build shows its stages as they run, then every check the app passed, in plain words.
- The preview has an on-screen remote (D-pad, OK, Back, Restart), swipe and tap gestures, a live line showing what's on the screen and which item is highlighted, and full screen on browsers that allow it.
- Phones that support it vibrate lightly on taps. Animations are turned off when the phone asks for reduced motion.
- The microphone uses the browser's built-in speech recognition, which can send your voice to the browser maker's speech service (Google for Chrome, Apple for Safari). It only appears where the browser supports it.

### Use a real Android phone as the builder

The server only listens on your computer, so the phone reaches it over USB instead of Wi-Fi. Turn on USB debugging on the phone, connect it, then run:

```bash
adb devices                                    # note the phone's serial
adb -s <phone-serial> reverse tcp:4848 tcp:4848
```

Open http://localhost:4848/builder.html in Chrome on the phone. Use `-s` because the TV emulator also uses adb. If you started the server on another port, use that port in both the `adb reverse` command and the address.

An iPhone can't connect this way. Reaching the server over Wi-Fi would mean opening it to your network, and it has no login.

## Run on the Fire OS / Android TV app

Set up the Android tools (once):

```bash
brew install --cask android-commandlinetools corretto@17
brew install gradle
export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
export JAVA_HOME=$(/usr/libexec/java_home -v 17)
export PATH=$PATH:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator
sdkmanager "platform-tools" "emulator" "platforms;android-33" "build-tools;33.0.2" \
  "system-images;android-33;android-tv;arm64-v8a"
avdmanager create avd -n ptv_tv -k "system-images;android-33;android-tv;arm64-v8a" -d tv_1080p
```

Build, install and connect (with `node server.js` running in another terminal):

```bash
emulator -avd ptv_tv &                    # wait for the TV home screen
echo "sdk.dir=$ANDROID_HOME" > android-player/local.properties
(cd android-player && gradle assembleDebug)
adb install -r android-player/app/build/outputs/apk/debug/app-debug.apk
adb reverse tcp:4848 tcp:4848             # the TV's localhost:4848 -> your computer's server
```

Open App Studio on the TV and choose Connect, keeping the address `http://localhost:4848`. Then pair and send apps from builder.html as in the quick start. To try it without a server, choose Offline demo (no server needed).

To use a real Fire TV, first connect it over ADB (see Amazon's public guide "Connect to Fire TV Through ADB"). Then run the same `adb install` and `adb reverse` commands.

## Run on the Vega OS app (Vega Virtual Device)

With the Vega SDK installed and `node server.js` running:

```bash
source ~/vega/env
vega virtual-device start --display-res 1920,1080
cd vega-player
npm ci                                                    # uses the public npm registry (vega-player/.npmrc)
PTV_SERVER_URL=http://localhost:4848 npm run build:debug  # leave out PTV_SERVER_URL for offline demo mode
"$(vega which vda | tail -1)" reverse tcp:4848 tcp:4848
vega run-app build/aarch64-debug/vega-player_aarch64.vpkg com.prompttotv.player.main -d VirtualDevice
cd ..
```

App Studio opens on the virtual TV with a pairing code, and you pair and send from builder.html. Use the remote in the Virtual Device window, or press keys from the terminal:

```bash
VDA=$(vega which vda | tail -1)
"$VDA" shell "inputd-cli button_press KEY_DOWN"   # also KEY_UP, KEY_LEFT, KEY_RIGHT, KEY_ENTER, KEY_BACK
```

## Testing

Each command prints a summary such as `22/22 passed` and exits with a non-zero code if any check fails.

### 1. App writer and validator (no browser or device needed)

```bash
DATA_FILE=/tmp/ptv_test.json node test/model_writer_test.js
```

This runs 8 checks with a stand-in model, covering:
- a good app
- an app that tries a network call
- an attempt to break out of the script
- a malformed reply
- a bad plan

### 2. End-to-end in the browser (server and Chrome)

Terminal 1:

```bash
rm -f data.json && node server.js
```

Terminal 2:

```bash
node test/e2e_cdp_test.js
```

This runs 22 checks in a real Chrome window:
- pairing, then plan → build → validate → send → launch
- real arrow, Enter and Escape key events in the generated apps (D-pad focus, selecting answers, the pause menu, Resume, Quit)
- both templates
- a check that a TV can't launch an app that wasn't sent to it

The test uses ports 4848 and 9333, so close any other Chrome using port 9333 first.

### 3. Fire OS / Android TV app (emulator or Fire TV over ADB)

```bash
(cd android-player && gradle assembleDebug)
node test/android_native_test.js                    # offline demo mode: 26 checks
node test/android_native_test.js --server           # live flow through adb reverse: 25 checks (needs node server.js)
ANDROID_SERIAL=emulator-5554 node test/android_native_test.js   # pick a device if several are connected
node test/android_native_test.js --no-install       # reuse an already installed APK
```

These press real remote keys (`adb shell input keyevent`) and cover:
- pairing, My Apps and the banner
- opening apps from the remote
- the full-screen TV layout
- D-pad, Select and Back inside an app
- Quit, and Back leaving App Studio
- the Content-Security-Policy

### 4. Vega OS app (unit test, lint and type check)

```bash
cd vega-player
npm ci
npm run sync          # generates src/playerConfig.ts and assets/ (the build does this too)
npm test
npm run lint
npx tsc --noEmit
cd ..
```

### Manual check on a TV

Use the quick start flow on the emulator, the Virtual Device or a Fire TV, and confirm that:
- the pairing code appears and switches to My Apps after you pair
- a sent app shows the "ready" banner
- the D-pad moves a visible highlight, and OK selects
- Back opens the app's pause menu, and Quit returns to My Apps

## Configuration

| Variable | Used by | Default | Purpose |
|---|---|---|---|
| `PORT` | server.js | `4848` | Server port |
| `DATA_FILE` | server.js | `./data.json` | Where pairings and apps are stored |
| `LINK_SECRET` | server.js | random at startup | Key for signing launch links; set it to keep links valid across restarts |
| `PTV_MODEL_ID` | server.js | unset (templates) | Bedrock model ID; turns on the AI writer |
| `PTV_MODEL_REGION` | model_writer.js | `us-east-1` | Bedrock region |
| `PTV_SERVER_URL` | vega-player build | unset (offline) | Server address for the Vega app; only `localhost` / `127.0.0.1` are allowed |
| `ANDROID_SERIAL` | Android test | first device | Which adb device to use |

### Optional: AI app writer on Amazon Bedrock

```bash
export AWS_PROFILE=<a profile with Bedrock access>
export PTV_MODEL_ID=<a Bedrock model ID>
node server.js        # the startup line says which writer is active
```

The model writes only the app's markup and script. The platform adds the page, the styles and the runtime SDK, then runs the same validator as template builds. A failed build gets one repair attempt, and is rejected if it still fails. The builder shows which writer produced each build. Bedrock calls are billed per token by AWS.

## Troubleshooting

- The TV page shows no pairing code:
  - If it shows `...` and "needs the App Studio server", the page was opened as a file. Start `node server.js` and open http://127.0.0.1:4848/player.html instead.
  - If it shows "Can't reach the App Studio server", check that `node server.js` is still running. The page keeps retrying and shows a code once the server is back.
  - If the terminal says the port is already in use, the server didn't start, and your browser may be showing a different server on that port. Stop the other server or use `PORT=4850 node server.js`.
  - The TV page remembers its pairing. When you start with fresh data (a new copy, or after deleting `data.json`), it notices the old pairing is gone and shows a new code on its own. To force a new code at any time, open http://127.0.0.1:4848/player.html?reset=1.
- `421 unexpected host`: open the pages at `127.0.0.1:4848` or `localhost:4848`.
- The TV can't reach the server: run `adb reverse` / `vda reverse` again, because it resets when the emulator restarts. Also check that `node server.js` is still running.
- Port 4848 is already in use: start on another port with `PORT=4850 node server.js`, or stop whatever holds it with `kill $(lsof -tiTCP:4848 -sTCP:LISTEN)`.
- `npm ci` fails with an authentication error: run it inside `vega-player/` so its `.npmrc` (public registry) applies.
