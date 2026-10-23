'use strict';
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const PKG = 'com.prompttotv.player';
const ACTIVITY = PKG + '/.PlayerActivity';
const APK = path.join(__dirname, '..', 'android-player', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
const ADB = process.env.ADB || (fs.existsSync('/opt/homebrew/share/android-commandlinetools/platform-tools/adb')
  ? '/opt/homebrew/share/android-commandlinetools/platform-tools/adb' : 'adb');
const SERVER_MODE = process.argv.includes('--server');
const PORT = 4848;
const HOST_API = `http://127.0.0.1:${PORT}`;
const DEVICE_URL = `http://localhost:${PORT}`;
const DESCRIPTIONS = {
  timer: 'A workout interval timer about HIIT, 5 rounds, 30 seconds work with rest between rounds',
  general: 'A general knowledge quiz for the family, 2 teams, 2 rounds of 5 questions, 30 seconds per question',
  movies: 'A movie trivia game for my family about movies, 2 teams, 3 rounds of 5 questions, 20 seconds per question'
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

function pickSerial() {
  if (process.env.ANDROID_SERIAL) return process.env.ANDROID_SERIAL;
  const lines = execFileSync(ADB, ['devices']).toString().split('\n').slice(1);
  const ready = lines.map(l => l.trim().split(/\s+/)).filter(p => p[1] === 'device').map(p => p[0]);
  if (!ready.length) throw new Error('no adb device in "device" state');
  return ready[0];
}
const SERIAL = pickSerial();
function adb(...args) { return execFileSync(ADB, ['-s', SERIAL, ...args], { timeout: 60000 }).toString().trim(); }
function shell(cmd) { return adb('shell', cmd); }
async function key(name, waitMs = 700) { shell('input keyevent ' + name); await sleep(waitMs); }

async function waitFor(fn, timeoutMs, stepMs = 300) {
  const end = Date.now() + timeoutMs;
  let last;
  while (Date.now() < end) {
    try { last = await fn(); if (last) return last; } catch (e) { last = e; }
    await sleep(stepMs);
  }
  return last instanceof Error ? null : last;
}

async function api(method, p, body) {
  const r = await fetch(HOST_API + p, {
    method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined
  });
  return { status: r.status, data: await r.json() };
}
async function buildAndSend(description, tvId) {
  const built = await api('POST', '/v1/apps', { description });
  if (built.status !== 200) throw new Error('build failed: ' + JSON.stringify(built.data.report || built.data));
  const sent = await api('POST', '/v1/send', { appId: built.data.appId, tvId });
  if (sent.status !== 200) throw new Error('send failed: ' + JSON.stringify(sent.data));
  return built.data.plan.title;
}

function connectCDP(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', ev => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  });
  const open = new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
  return {
    async eval(expr) {
      await open;
      const myId = ++id;
      const p = new Promise(res => pending.set(myId, res));
      ws.send(JSON.stringify({ id: myId, method: 'Runtime.evaluate', params: { expression: expr, returnByValue: true, awaitPromise: true } }));
      const r = await Promise.race([p, sleep(8000).then(() => { throw new Error('CDP eval timed out: ' + expr.slice(0, 60)); })]);
      if (r.result && r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.text + ' in: ' + expr.slice(0, 60));
      return r.result.result.value;
    },
    close() { try { ws.close(); } catch (e) {} }
  };
}

const VIEW = `(window.__ptvAppView || {})`;
const focusedText = `${VIEW}.focused || null`;
const activeScreen = `${VIEW}.screen || null`;
const pauseShown = `!!${VIEW}.paused`;
const appTitle = `${VIEW}.appTitle || null`;
const frameOpen = `document.getElementById('frame').style.display === 'block'`;
const homeShown = `document.getElementById('home').style.display === 'block' && document.getElementById('frame').style.display === 'none'`;
const tileTitles = `Array.from(document.querySelectorAll('#app-tiles .tile b')).map(b => b.textContent)`;
const highlightedTile = `(() => { const t = document.querySelector('#app-tiles .tile.tv-focus b'); return t ? t.textContent : null; })()`;
const appRect = `(() => { const r = document.getElementById('appframe').getBoundingClientRect();
  return { w: innerWidth, h: innerHeight, r: [r.left, r.top, r.width, r.height].map(Math.round) }; })()`;

function playerResumed() {
  return shell('dumpsys activity activities | grep ResumedActivity').split('\n').some(l => l.includes(PKG));
}

async function main() {
  const results = [];
  const check = (name, ok, detail) => { results.push({ name, ok }); console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + '  — ' + detail); };
  let forwardPort = null, page = null, addedReverse = false;
  console.log('device:', SERIAL, '|', shell('getprop ro.product.model'), '| Android', shell('getprop ro.build.version.release'),
    '| Fire OS:', shell('getprop ro.build.version.name') || '(n/a)', '| mode:', SERVER_MODE ? 'server' : 'offline');

  try {
    if (SERVER_MODE) {
      const up = await fetch(HOST_API + '/player.html').then(r => r.status === 200, () => false);
      if (!up) throw new Error('server.js is not running on ' + HOST_API + ' (run `node server.js` first)');
      if (!adb('reverse', '--list').includes(`tcp:${PORT} tcp:${PORT}`)) {
        adb('reverse', `tcp:${PORT}`, `tcp:${PORT}`);
        addedReverse = true;
      }
    }
    if (!process.argv.includes('--no-install')) {
      if (!fs.existsSync(APK)) throw new Error('APK not built: ' + APK);
      adb('install', '-r', APK);
    }
    shell('pm clear ' + PKG);
    shell('logcat -c');
    shell(SERVER_MODE
      ? `am start -W -S -n ${ACTIVITY} --es ptv_server_url ${DEVICE_URL}`
      : `am start -W -S -n ${ACTIVITY} --es ptv_mode offline`);

    const pid = await waitFor(() => shell('pidof ' + PKG), 10000);
    const sock = await waitFor(() => {
      const m = shell('cat /proc/net/unix').match(new RegExp('@(webview_devtools_remote_' + pid + ')\\b'));
      return m && m[1];
    }, 15000);
    if (!sock) throw new Error('WebView DevTools socket not found (is this a debug build?)');
    forwardPort = adb('forward', 'tcp:0', 'localabstract:' + sock);
    const target = await waitFor(async () => {
      const list = await (await fetch(`http://127.0.0.1:${forwardPort}/json/list`)).json();
      return list.find(t => t.type === 'page' && /\/player\.html/.test(t.url));
    }, 15000);
    if (!target) throw new Error('player.html page target not found');
    if (SERVER_MODE) {
      check('player-loads-from-server', target.url === DEVICE_URL + '/player.html?tv=1', 'page url: ' + target.url);
    } else {
      check('player-loads-from-apk', target.url.startsWith('https://appassets.androidplatform.net/'), 'page url: ' + target.url);
    }
    page = connectCDP(target.webSocketDebuggerUrl);

    if (SERVER_MODE) {
      check('no-offline-stand-in', await page.eval('window.__ptvOffline === true') === false, 'Player API answered by server.js');
    } else {
      check('offline-backend-active', await waitFor(() => page.eval('window.__ptvOffline === true'), 5000) === true, 'in-page API stand-in loaded before the Player script');
    }
    const code = await waitFor(async () => { const c = await page.eval(`document.getElementById('pair-code').textContent`); return /^[A-Z0-9]{6}$/.test(c) && c; }, 8000);
    check('pairing-code-shown', !!code, 'code: ' + code);
    let tvId = null;
    if (SERVER_MODE && code) {
      const approved = await api('POST', '/v1/device/approve', { code });
      tvId = approved.data.tvId;
    }
    const paired = await waitFor(() => page.eval(`document.getElementById('paired').style.display === 'block'`), 12000);
    check('pairing-approved', paired === true, SERVER_MODE ? 'approved through the builder API' : 'approved automatically (offline demo)');

    if (SERVER_MODE) {
      await buildAndSend(DESCRIPTIONS.timer, tvId);
      await buildAndSend(DESCRIPTIONS.general, tvId);
    }
    const firstTiles = await waitFor(async () => { const t = await page.eval(tileTitles); return t.length >= 2 ? t : null; }, 8000);
    check('my-apps-lists-apps', Array.isArray(firstTiles) && firstTiles.length >= 2, 'tiles: ' + JSON.stringify(firstTiles));
    if (SERVER_MODE) await buildAndSend(DESCRIPTIONS.movies, tvId);
    let bannerText = null;
    const banner = await waitFor(async () => {
      if (!(await page.eval(`document.getElementById('banner').classList.contains('show')`))) return null;
      bannerText = await page.eval(`document.getElementById('banner-text').textContent`);
      return bannerText.includes('Movies Trivia') ? bannerText : null;
    }, 10000);
    check('delivery-banner-appears', !!banner, 'banner: ' + JSON.stringify(bannerText));
    const tiles = await waitFor(async () => { const t = await page.eval(tileTitles); return t.length === 3 ? t : null; }, 5000);
    check('new-app-first-in-my-apps', !!tiles && tiles[0] === 'Movies Trivia', 'tiles: ' + JSON.stringify(tiles));

    const firstHighlight = await waitFor(() => page.eval(highlightedTile), 3000);
    check('my-apps-has-initial-focus', firstHighlight === 'Movies Trivia', 'highlighted tile: ' + JSON.stringify(firstHighlight));
    await key('KEYCODE_DPAD_LEFT');
    await key('KEYCODE_DPAD_CENTER', 1500);
    check('remote-opens-app', await page.eval(frameOpen), 'app frame visible after Select on the highlighted tile');
    const src = await page.eval(`document.getElementById('appframe').src`);
    const opened = await waitFor(() => page.eval(appTitle), 4000);
    const srcOk = SERVER_MODE
      ? new RegExp('^' + DEVICE_URL + '/sandbox\\?t=app_[0-9a-f]{12}\\.ver_').test(src)
      : /^https:\/\/appassets\.androidplatform\.net\/sandbox\?t=app_[0-9a-f]{12}$/.test(src);
    check('app-served-from-sandbox', srcOk && opened === 'Movies Trivia', 'opened ' + JSON.stringify(opened) + ' from ' + src);
    const layout = await page.eval(appRect);
    const [l, t, w, h] = layout.r;
    check('app-fills-tv-screen', l >= 0 && t >= 0 && l + w <= layout.w && t + h <= layout.h && (w === layout.w || h === layout.h),
      `app ${w}x${h} at ${l},${t} on a ${layout.w}x${layout.h} screen`);
    const iso = await page.eval(`(async () => {
      const f = document.getElementById('appframe');
      const r = await fetch(f.src);
      return { sandbox: f.getAttribute('sandbox'), csp: r.headers.get('content-security-policy') || '' };
    })()`);
    check('app-sandboxed-and-network-blocked', iso.sandbox === 'allow-scripts' && /connect-src 'none'/.test(iso.csp) && /default-src 'none'/.test(iso.csp),
      `frame sandbox="${iso.sandbox}", served with CSP "${iso.csp}"`);
    const f0 = await waitFor(() => page.eval(focusedText), 4000);
    check('app-has-initial-focus', f0 === 'Start Game', 'focused: ' + JSON.stringify(f0));

    await key('KEYCODE_DPAD_CENTER');
    check('select-starts-game', await page.eval(activeScreen) === 's-question', 'screen: ' + await page.eval(activeScreen));
    const f1 = await page.eval(focusedText);
    await key('KEYCODE_DPAD_DOWN');
    const f2 = await page.eval(focusedText);
    check('dpad-moves-focus', !!f1 && !!f2 && f1 !== f2, JSON.stringify(f1) + ' -> ' + JSON.stringify(f2));

    await key('KEYCODE_BACK');
    check('back-opens-app-pause-menu', await page.eval(pauseShown) === true, 'pause overlay shown');
    check('back-does-not-close-player', playerResumed(), 'Player still the resumed activity');
    await key('KEYCODE_BACK');
    check('back-again-resumes', await page.eval(pauseShown) === false, 'pause overlay closed');

    await key('KEYCODE_BACK');
    await key('KEYCODE_DPAD_RIGHT');
    const quitFocus = await page.eval(focusedText);
    await key('KEYCODE_DPAD_CENTER', 1200);
    check('quit-returns-to-my-apps', quitFocus === 'Quit' && await page.eval(homeShown), 'focused ' + JSON.stringify(quitFocus) + ', then home shown');
    const homeHighlight = await waitFor(() => page.eval(highlightedTile), 3000);
    check('my-apps-focus-visible-after-quit', homeHighlight === 'Movies Trivia', 'highlighted tile: ' + JSON.stringify(homeHighlight));

    await key('KEYCODE_DPAD_RIGHT');
    await key('KEYCODE_DPAD_RIGHT');
    const timerTile = await page.eval(highlightedTile);
    await key('KEYCODE_DPAD_CENTER', 1500);
    const timerTitle = await waitFor(() => page.eval(appTitle), 4000);
    check('remote-opens-timer-app', timerTile === 'HIIT Interval Timer' && timerTitle === 'HIIT Interval Timer', 'highlighted tile ' + JSON.stringify(timerTile) + ', opened ' + JSON.stringify(timerTitle));
    await key('KEYCODE_DPAD_CENTER');
    await key('KEYCODE_BACK');
    const tf = await page.eval(focusedText);
    check('timer-back-pauses-with-resume-focused', await page.eval(pauseShown) === true && tf === 'Resume', 'pause shown, focused ' + JSON.stringify(tf));
    await key('KEYCODE_DPAD_CENTER');
    check('timer-select-resumes', await page.eval(pauseShown) === false, 'pause overlay closed');
    await key('KEYCODE_BACK');
    await key('KEYCODE_DPAD_RIGHT');
    await key('KEYCODE_DPAD_CENTER', 1200);
    check('timer-quit-returns-to-my-apps', await page.eval(homeShown), 'home shown');

    if (!SERVER_MODE) {
      const refused = shell('logcat -d -s PromptToTVPlayer:W').split('\n').filter(l => /refused a request/.test(l));
      check('no-off-device-requests', refused.length === 0, refused.length ? refused.join(' | ') : 'no request was attempted to any other host');
    }

    page.close(); page = null;
    await key('KEYCODE_BACK', 1500);
    check('back-on-my-apps-exits-player', !playerResumed(), 'Player no longer the resumed activity');
  } catch (e) {
    check('test-harness', false, e.message);
  } finally {
    if (page) page.close();
    if (forwardPort) { try { adb('forward', '--remove', 'tcp:' + forwardPort); } catch (e) {} }
    if (addedReverse) { try { adb('reverse', '--remove', `tcp:${PORT}`); } catch (e) {} }
  }

  const failed = results.filter(r => !r.ok);
  console.log(`\n=== SUMMARY ===\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) console.log('FAILED:', failed.map(f => f.name).join(', '));
  process.exit(failed.length ? 1 : 0);
}

main();
