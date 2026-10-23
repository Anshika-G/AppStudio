'use strict';
const http = require('http');
const { spawn } = require('child_process');
const os = require('os');
const path = require('path');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9333;
const PROFILE = path.join(os.tmpdir(), 'ptv-cdp-profile-' + Date.now());

function fetchJSON(url, method) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method: method || 'GET' }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(new Error('non-JSON response from ' + url + ': ' + d.slice(0, 200))); } });
    });
    req.on('error', reject);
    req.end();
  });
}

async function main() {
  const watchdog = setTimeout(() => { console.error('FATAL: test exceeded 45s watchdog — likely stuck on an await'); process.exit(3); }, 45000);
  const chrome = spawn(CHROME, [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
    '--no-first-run', '--no-default-browser-check', 'about:blank'
  ], { stdio: 'ignore' });

  await new Promise(r => setTimeout(r, 1200));
  for (let i = 0; i < 20; i++) {
    try { await fetchJSON(`http://127.0.0.1:${PORT}/json/version`); break; }
    catch (e) { if (i === 19) throw new Error('Chrome CDP endpoint never came up: ' + e.message); await new Promise(r => setTimeout(r, 500)); }
  }

  async function newTab(url) {
    const target = await fetchJSON(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(url)}`, 'PUT');
    return connect(target.webSocketDebuggerUrl);
  }
  function connect(wsUrl) {
    const ws = new WebSocket(wsUrl);
    let id = 0;
    const pending = new Map();
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    });
    const ready = new Promise(r => ws.addEventListener('open', r));
    return {
      send(method, params = {}) {
        return ready.then(() => new Promise(resolve => {
          const myId = ++id;
          pending.set(myId, resolve);
          ws.send(JSON.stringify({ id: myId, method, params }));
        }));
      },
      close() { ws.close(); }
    };
  }

  async function evalJS(tab, expr) {
    const r = await Promise.race([
      tab.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('evalJS timed out after 8s: ' + expr.slice(0, 80))), 8000))
    ]);
    if (r.result && r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
    return r.result.result.value;
  }
  async function dispatchKey(tab, keyCode, keyName) {
    await tab.send('Input.dispatchKeyEvent', { type: 'keyDown', windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode, key: keyName, code: keyName });
    await tab.send('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode, key: keyName, code: keyName });
  }

  const results = [];
  const check = (name, ok, detail) => { results.push({ name, ok, detail }); console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + '  — ' + detail); };

  const builder = await newTab('http://127.0.0.1:4848/builder.html');
  await builder.send('Page.enable');
  await new Promise(r => setTimeout(r, 800));

  await evalJS(builder, `document.getElementById('desc').value = 'A movie trivia game for my family: 2 teams, 3 rounds of 5 questions about movies, 20 seconds per question'`);
  await evalJS(builder, `plan()`);
  await new Promise(r => setTimeout(r, 500));
  const planVisible = await evalJS(builder, `document.getElementById('planCard').style.display === 'block'`);
  check('builder-plan-step', planVisible, 'plan card shown after clicking Plan it');

  await evalJS(builder, `build()`);
  await new Promise(r => setTimeout(r, 800));
  const buildOk = await evalJS(builder, `document.querySelector('#buildPill .pill').textContent`);
  check('builder-build-step', buildOk === 'READY', 'build pill reads: ' + buildOk);

  await new Promise(r => setTimeout(r, 500));
  const previewSrc = await evalJS(builder, `document.getElementById('previewFrame').src`);
  check('builder-preview-link-issued', previewSrc.includes('/sandbox?t='), 'preview iframe src: ' + previewSrc);

  const appIdVar = await evalJS(builder, `document.getElementById('previewFrame').src.match(/sandbox\\?t=([^.]+)\\./)[1]`);
  check('builder-appId-captured', !!appIdVar, 'appId = ' + appIdVar);

  const player = await newTab('http://127.0.0.1:4848/player.html');
  await player.send('Page.enable');
  let pairCode = null;
  for (let i = 0; i < 20; i++) {
    pairCode = await evalJS(player, `(document.getElementById('pair-code') || {}).textContent || ''`);
    if (/^[A-Z0-9]{6}$/.test(pairCode)) break;
    await new Promise(r => setTimeout(r, 500));
  }
  check('player-shows-pairing-code', /^[A-Z0-9]{6}$/.test(pairCode), 'code shown: ' + pairCode);

  const approveResp = await evalJS(builder, `
    (async () => {
      const r = await fetch('/v1/device/approve', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ code: ${JSON.stringify(pairCode)} }) });
      return await r.json();
    })()
  `);
  check('builder-approves-pairing', approveResp.ok === true, JSON.stringify(approveResp));

  await new Promise(r => setTimeout(r, 2200));
  const playerPaired = await evalJS(player, `document.getElementById('paired').style.display === 'block'`);
  check('player-detects-approval-via-poll', playerPaired, 'paired panel visible after poll');

  const tvId = await evalJS(player, `localStorage.getItem('ptv_tvId')`);
  check('player-has-tvId', !!tvId, 'tvId = ' + tvId);

  await evalJS(builder, `
    (async () => {
      await refreshTvs();
      document.getElementById('tvSelect').value = ${JSON.stringify(tvId)};
    })()
  `);
  await evalJS(builder, `sendToTv()`);
  await new Promise(r => setTimeout(r, 1800));
  const bannerShown = await evalJS(player, `document.getElementById('banner').classList.contains('show')`);
  const bannerText = await evalJS(player, `document.getElementById('banner-text').textContent`);
  check('player-banner-appears-after-send', bannerShown, 'banner text: ' + bannerText);

  await evalJS(player, `openDelivered(bannerAppId)`);
  await new Promise(r => setTimeout(r, 900));
  const frameVisible = await evalJS(player, `document.getElementById('frame').style.display === 'block'`);
  check('player-opens-app-in-frame', frameVisible, 'frame visible: ' + frameVisible);

  const iframeUrl = await evalJS(player, `document.getElementById('appframe').src`);
  check('player-iframe-loaded-sandbox-url', iframeUrl.includes('/sandbox?'), 'iframe src: ' + iframeUrl);

  await evalJS(player, `document.getElementById('appframe').focus()`);
  await new Promise(r => setTimeout(r, 700));

  const beforeFocus = await evalJS(player, `
(window.__ptvAppView || {}).focused || null
  `);
  check('iframe-has-initial-dpad-focus', !!beforeFocus, 'initially focused element text: ' + JSON.stringify(beforeFocus));

  await dispatchKey(player, 13, 'Enter');
  await new Promise(r => setTimeout(r, 500));
  const onQuestionScreen = await evalJS(player, `(window.__ptvAppView || {}).screen === 's-question'`);
  check('real-enter-keyevent-starts-game', onQuestionScreen, 'moved from title to question screen via real Enter keypress');

  const beforeFocus2 = await evalJS(player, `
(window.__ptvAppView || {}).focused || null
  `);

  await dispatchKey(player, 40, 'ArrowDown');
  await new Promise(r => setTimeout(r, 500));
  const afterDown = await evalJS(player, `
(window.__ptvAppView || {}).focused || null
  `);
  check('real-arrowdown-keyevent-moves-focus', afterDown !== beforeFocus2, 'focus moved from ' + JSON.stringify(beforeFocus2) + ' to ' + JSON.stringify(afterDown));

  const screenBefore = await evalJS(player, `(window.__ptvAppView || {}).screen`);
  await dispatchKey(player, 13, 'Enter');
  await new Promise(r => setTimeout(r, 500));
  const screenAfter = await evalJS(player, `(window.__ptvAppView || {}).screen`);
  check('real-enter-keyevent-selects-and-navigates', screenBefore === 's-question' && screenAfter === 's-reveal', `screen: ${screenBefore} -> ${screenAfter}`);

  await dispatchKey(player, 13, 'Enter');
  await new Promise(r => setTimeout(r, 400));
  await dispatchKey(player, 27, 'Escape');
  await new Promise(r => setTimeout(r, 500));
  const pauseShown = await evalJS(player, `!!(window.__ptvAppView || {}).paused`);
  check('real-escape-keyevent-opens-pause-menu', pauseShown, 'pause overlay shown: ' + pauseShown);

  const resumeFocusedBefore = await evalJS(player, `
(window.__ptvAppView || {}).focused || null
  `);
  await dispatchKey(player, 13, 'Enter');
  await new Promise(r => setTimeout(r, 500));
  const pauseClosed = await evalJS(player, `!!!(window.__ptvAppView || {}).paused`);
  check('real-enter-keyevent-resumes-from-pause', pauseClosed, 'pause overlay closed: ' + pauseClosed + ' (focused element when Enter was pressed: ' + resumeFocusedBefore + ')');

  await dispatchKey(player, 27, 'Escape'); await new Promise(r => setTimeout(r, 400));
  await dispatchKey(player, 39, 'ArrowRight'); await new Promise(r => setTimeout(r, 500));
  await dispatchKey(player, 13, 'Enter'); await new Promise(r => setTimeout(r, 600));
  const backHome = await evalJS(player, `document.getElementById('home').style.display === 'block' && document.getElementById('frame').style.display === 'none'`);
  check('exit-bridge-message-returns-to-home', backHome, 'home visible, frame hidden: ' + backHome);

  const unauthorizedLaunch = await evalJS(builder, `
    (async () => {
      const r = await fetch('/v1/device/code', { method:'POST' });
      const dev = await r.json();
      const r2 = await fetch('/v1/tv/' + dev.tvId + '/launch', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ appId: ${JSON.stringify(appIdVar)} }) });
      return r2.status;
    })()
  `);
  check('fresh-unpaired-tv-cannot-launch-undelivered-app', unauthorizedLaunch === 404, 'HTTP status: ' + unauthorizedLaunch);

  const timerBuild = await evalJS(builder, `
    (async () => {
      const r = await fetch('/v1/apps', { method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ description: 'A workout interval timer: 3 rounds, 5 seconds work, rest between rounds' }) });
      return await r.json();
    })()
  `);
  check('timer-app-builds-and-validates', timerBuild.report && timerBuild.report.passed, JSON.stringify(timerBuild.report && timerBuild.report.checks.filter(c => !c.ok)));

  const timerLaunch = await evalJS(builder, `
    (async () => {
      const r = await fetch('/v1/apps/${timerBuild.appId}/preview-link', { method:'POST' });
      return await r.json();
    })()
  `);
  await evalJS(player, `
    document.getElementById('home').style.display = 'none';
    document.getElementById('frame').style.display = 'block';
    document.getElementById('appframe').src = ${JSON.stringify(timerLaunch.url)};
  `);
  await new Promise(r => setTimeout(r, 600));
  await evalJS(player, `document.getElementById('appframe').focus()`);
  await dispatchKey(player, 13, 'Enter');
  await new Promise(r => setTimeout(r, 400));
  await dispatchKey(player, 27, 'Escape');
  await new Promise(r => setTimeout(r, 500));
  const timerPauseFocus = await evalJS(player, `
(window.__ptvAppView || {}).focused || null
  `);
  check('timer-app-pause-overlay-focuses-resume', timerPauseFocus === 'Resume', 'focused element in pause overlay: ' + JSON.stringify(timerPauseFocus));
  await dispatchKey(player, 13, 'Enter');
  await new Promise(r => setTimeout(r, 500));
  const timerResumed = await evalJS(player, `!!!(window.__ptvAppView || {}).paused`);
  check('timer-app-resume-closes-overlay', timerResumed, 'pause overlay closed: ' + timerResumed);

  console.log('\n=== SUMMARY ===');
  const failed = results.filter(r => !r.ok);
  console.log(`${results.length - failed.length}/${results.length} passed`);
  if (failed.length) console.log('FAILED:', failed.map(f => f.name).join(', '));

  builder.close(); player.close();
  chrome.kill();
  clearTimeout(watchdog);
  process.exit(failed.length ? 1 : 0);
}

main().catch(e => { console.error('FATAL:', e); process.exit(2); });
