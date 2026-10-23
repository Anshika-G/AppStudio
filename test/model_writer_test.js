'use strict';
process.env.PTV_MODEL_ID = process.env.PTV_MODEL_ID || 'test-model';
const path = require('path');
const writer = require(path.join(__dirname, '..', 'model_writer'));
const srv = require(path.join(__dirname, '..', 'server'));

const results = [];
const check = (name, ok, detail) => { results.push(ok); console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + '  — ' + detail); };

const GOOD = `<<<MARKUP
<section class="screen active" id="s-title"><div class="center">
  <h1 class="app-title">Space Quiz</h1><button data-focus onclick="start()">Start Game</button></div></section>
<section class="screen" id="s-question"><h1 class="app-title" id="q"></h1><div class="row" id="choices"></div></section>
<div class="pause-overlay" id="pause"><div class="huge" style="font-size:72px">Paused</div>
  <div class="row"><button data-focus onclick="resume()">Resume</button><button onclick="tv.exit()">Quit</button></div></div>
>>>
<<<SCRIPT
var QUESTIONS = [{q:"Closest star?", c:["Sun","Sirius","Vega","Rigel"], a:0},{q:"Red planet?", c:["Mars","Venus","Jupiter","Mercury"], a:0}];
var i = 0;
function show(id){ document.querySelectorAll('.screen').forEach(function(s){ s.classList.remove('active'); }); document.getElementById(id).classList.add('active'); tv.ready(); }
function start(){ render(); show('s-question'); }
function render(){ var q = QUESTIONS[i]; document.getElementById('q').textContent = q.q; var box = document.getElementById('choices'); box.innerHTML = '';
  q.c.forEach(function(t, k){ var b = document.createElement('button'); b.setAttribute('data-focus',''); b.textContent = t; b.onclick = function(){ i = (i + 1) % QUESTIONS.length; render(); tv.ready(); }; box.appendChild(b); }); }
function resume(){ document.getElementById('pause').classList.remove('show'); tv.refocus(); }
tv.on('back', function(){ if (document.getElementById('s-title').classList.contains('active')) return false;
  var p = document.getElementById('pause'); p.classList.toggle('show'); tv.refocus(); return true; });
>>>`;
const BAD_NET = GOOD.replace("var i = 0;", "var i = 0; fetch('https://example.com/x');");
const BREAKOUT = GOOD.replace("var i = 0;", "var i = 0;</script><script src=https://evil.example/x.js>");
const NO_SECTIONS = 'Sure! Here is your app: <html>...</html>';

const plan = srv.normalizePlan({ kind: 'trivia', title: 'Space Quiz', settings: { teams: 2, rounds: 1, questionsPerRound: 2, secondsPerQuestion: 20 }, content: { topic: 'space' } }, 'a space quiz');
const deps = { BASE_CSS: srv.BASE_CSS, RUNTIME_SDK: srv.RUNTIME_SDK, escapeHtml: srv.escapeHtml, validateApp: srv.validateApp };
const fake = replies => { const prompts = []; let n = 0; const f = async (system, user) => { prompts.push(user); return { text: replies[Math.min(n++, replies.length - 1)] }; }; f.prompts = prompts; return f; };

(async () => {
  let f = fake([GOOD]);
  let r = await writer.writeWithModel(plan, 'a space quiz', deps, f);
  check('good-reply-passes-validator', r.report.passed && r.attempts === 1, `passed=${r.report.passed}, attempts=${r.attempts}, writer=${r.writer}`);
  check('runtime-sdk-added-by-platform', r.html.includes('App Studio runtime SDK') && r.html.indexOf('runtime SDK') < r.html.indexOf('var QUESTIONS'), 'SDK present and loaded before the app script');

  f = fake([BAD_NET, GOOD]);
  r = await writer.writeWithModel(plan, 'a space quiz', deps, f);
  check('network-call-rejected-then-repaired', r.report.passed && r.attempts === 2 && /no-network-calls/.test(f.prompts[1]), `attempts=${r.attempts}; repair prompt names the failed check: ${/no-network-calls/.test(f.prompts[1])}`);

  f = fake([BAD_NET, BAD_NET]);
  r = await writer.writeWithModel(plan, 'a space quiz', deps, f);
  check('persistent-failure-is-rejected', !r.report.passed && r.attempts === 2, `passed=${r.report.passed} after ${r.attempts} attempts`);

  f = fake([BREAKOUT, BREAKOUT]);
  r = await writer.writeWithModel(plan, 'a space quiz', deps, f);
  check('script-breakout-rejected', !r.report.passed && !r.html.includes('evil.example'), r.report.checks.filter(c => !c.ok).map(c => c.name + ': ' + c.detail).join('; '));

  f = fake([NO_SECTIONS, NO_SECTIONS]);
  r = await writer.writeWithModel(plan, 'a space quiz', deps, f);
  check('unformatted-reply-rejected', !r.report.passed, r.report.checks.map(c => c.name).join(', '));

  const evil = srv.normalizePlan({ kind: 'trivia', title: '<img src=x onerror=alert(1)>', settings: { teams: '2;alert(1)', rounds: 99999 } }, '');
  check('plan-normalized', Number.isInteger(evil.settings.teams) && evil.settings.rounds <= 10, `teams=${evil.settings.teams}, rounds=${evil.settings.rounds}`);
  const html = srv.buildApp(evil);
  check('template-escapes-title', !html.includes('<img src=x') && html.includes('&lt;img'), 'title appears escaped in the page');

  const ok = results.filter(Boolean).length;
  console.log(`\n=== SUMMARY ===\n${ok}/${results.length} passed`);
  process.exit(ok === results.length ? 0 : 1);
})();
