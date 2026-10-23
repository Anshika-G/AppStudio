#!/usr/bin/env node
'use strict';
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT ? Number(process.env.PORT) : 4848;
const HOST = '127.0.0.1';
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data.json');

function loadDB() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
  catch { return { apps: {}, tvs: {}, deliveries: [], deviceCodes: {}, events: [] }; }
}
function saveDB() { fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2)); }
let db = loadDB();

function id(prefix) { return prefix + '_' + crypto.randomBytes(6).toString('hex'); }
function shortCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 6; i++) s += alphabet[crypto.randomInt(alphabet.length)];
  return s;
}
function signLink(appId, versionId, ttlMs) {
  const exp = Date.now() + ttlMs;
  const payload = `${appId}.${versionId}.${exp}`;
  const sig = crypto.createHmac('sha256', LINK_SECRET).update(payload).digest('hex').slice(0, 16);
  return `${payload}.${sig}`;
}
function verifyLink(token) {
  const parts = String(token).split('.');
  if (parts.length !== 4) return null;
  const [appId, versionId, exp, sig] = parts;
  const payload = `${appId}.${versionId}.${exp}`;
  const want = crypto.createHmac('sha256', LINK_SECRET).update(payload).digest('hex').slice(0, 16);
  if (sig !== want) return null;
  if (Date.now() > Number(exp)) return 'expired';
  return { appId, versionId };
}
const LINK_SECRET = process.env.LINK_SECRET || crypto.randomBytes(32).toString('hex');

function makePlan(description) {
  const d = description.toLowerCase();
  const numMatch = (re, dflt) => { const m = d.match(re); return m ? parseInt(m[1], 10) : dflt; };
  const seconds = numMatch(/(\d+)\s*sec/, numMatch(/(\d+)\s*s\b/, 20));
  const isYoga = /\byoga\b|stretch|\bpose/.test(d);
  const rounds = numMatch(/(\d+)\s*(?:round|pose|stretch)/, isYoga ? 6 : 3);
  const perRound = numMatch(/(\d+)\s*question/, 5);
  const teams = numMatch(/(\d+)\s*team/, 2);
  const isTrivia = /trivia|quiz|question/.test(d);
  const isTimer = (/timer|workout|interval|rest|round|hiit|exercise/.test(d) || isYoga) && !isTrivia;
  const topicMatch = description.match(/about ([^.,]+)/i);
  const timerTopic = isYoga ? 'yoga' : (/\bhiit\b/.test(d) ? 'HIIT' : (/workout|exercise|fitness|training/.test(d) ? 'workout' : 'session'));
  const topic = topicMatch ? topicMatch[1].trim() : (isTrivia ? 'general knowledge' : timerTopic);

  const kind = isTrivia ? 'trivia' : (isTimer ? 'timer' : 'trivia');
  const cap = t => t.replace(/^\w/, c => c.toUpperCase());
  const forKids = /\bkids?\b|child|children|learn/.test(d);
  const title = kind === 'trivia'
    ? (forKids ? `${cap(topic)} Learning Quiz` : `${cap(topic)} Trivia`)
    : (isYoga ? 'Yoga Flow' : `${cap(topic)} Interval Timer`);
  const restSeconds = isYoga ? numMatch(/(\d+)\s*s(?:ec(?:ond)?s?)?\s*(?:of\s*)?rest/, 10) : 10;

  return {
    plan: 1,
    kind,
    title,
    summary: kind === 'trivia'
      ? `${teams} teams answer ${rounds * perRound} ${topic} questions across ${rounds} rounds of ${perRound}, ${seconds}s per question. Pick an answer with the D-pad and press OK.`
      : (isYoga
        ? `A guided yoga session: ${rounds} poses, ${seconds}s each with ${restSeconds}s to switch. Pause and resume with the remote.`
        : `An interval timer: ${rounds} rounds, ${seconds}s work / 10s rest. Pause and resume with the remote.`),
    screens: kind === 'trivia'
      ? ['title', 'teams', 'question', 'reveal', 'round-scores', 'final-scores', 'pause']
      : ['title', 'work', 'rest', 'done', 'pause'],
    controls: {
      dpad: kind === 'trivia' ? 'move between answers' : 'move between buttons',
      select: kind === 'trivia' ? 'lock in the answer' : 'start, pause, resume',
      back: 'open the pause menu: resume or quit',
      playpause: 'pause or resume'
    },
    settings: kind === 'trivia'
      ? { teams, rounds, questionsPerRound: perRound, secondsPerQuestion: seconds }
      : { rounds, workSeconds: seconds, restSeconds, ...(isYoga ? { style: 'yoga' } : {}) },
    content: kind === 'trivia' ? { topic, questions: rounds * perRound, choicesPerQuestion: 4, writtenAtBuildTime: true } : {},
    capabilities: ['storage']
  };
}

const QUESTION_BANKS = {
  animals: [
    ['Which animal is the tallest in the world?', ['Elephant', 'Giraffe', 'Horse', 'Camel'], 1],
    ['How many legs does a spider have?', ['6', '8', '10', '4'], 1],
    ['What do bees make?', ['Milk', 'Honey', 'Silk', 'Wool'], 1],
    ['Which animal is called the king of the jungle?', ['Tiger', 'Bear', 'Lion', 'Wolf'], 2],
    ['What is a baby frog called?', ['Tadpole', 'Cub', 'Kid', 'Chick'], 0],
    ['Which animal has black and white stripes?', ['Zebra', 'Leopard', 'Panda', 'Skunk'], 0],
    ['Where do penguins mostly live?', ['The desert', 'The jungle', 'Near the South Pole', 'In caves'], 2],
    ['What is the largest animal on Earth?', ['Elephant', 'Blue whale', 'Shark', 'Giraffe'], 1],
    ['Which bird can fly backwards?', ['Eagle', 'Penguin', 'Hummingbird', 'Ostrich'], 2],
    ['How many hearts does an octopus have?', ['1', '2', '3', '8'], 2],
    ['Which animal sleeps hanging upside down?', ['Bat', 'Owl', 'Cat', 'Fox'], 0],
    ['What do caterpillars turn into?', ['Bees', 'Butterflies', 'Spiders', 'Birds'], 1],
    ['Which animal is the fastest on land?', ['Cheetah', 'Horse', 'Lion', 'Rabbit'], 0],
    ['What does a cow drink?', ['Milk', 'Water', 'Juice', 'Tea'], 1],
    ['Which animal carries its home on its back?', ['Snail', 'Dog', 'Duck', 'Mouse'], 0]
  ],
  movies: [
    ['Which fish is the main character in "Finding Nemo"?', ['Clownfish', 'Shark', 'Dolphin', 'Octopus'], 0],
    ['In "Frozen", what is Elsa\'s power?', ['Fire', 'Ice and snow', 'Wind', 'Invisibility'], 1],
    ['What is the name of the toy cowboy in "Toy Story"?', ['Buzz', 'Rex', 'Woody', 'Hamm'], 2],
    ['Which movie features a house that flies with balloons?', ['Up', 'Cars', 'Brave', 'Coco'], 0],
    ['In "The Lion King", who is Simba\'s father?', ['Scar', 'Mufasa', 'Rafiki', 'Zazu'], 1],
    ['What color is Shrek?', ['Blue', 'Purple', 'Green', 'Orange'], 2],
    ['Which movie has a snowman named Olaf?', ['Frozen', 'Moana', 'Encanto', 'Tangled'], 0],
    ['In "Finding Nemo", what is Dory\'s problem?', ['She can\'t swim', 'She forgets things', 'She is afraid of water', 'She can\'t see'], 1],
    ['What does Buzz Lightyear say instead of goodbye?', ['See you later', 'To infinity and beyond', 'Catch you on the flip side', 'Blast off'], 1],
    ['Which animal is Simba?', ['Tiger', 'Lion', 'Leopard', 'Cheetah'], 1],
    ['In "Moana", what does Moana sail across?', ['A desert', 'A mountain', 'The ocean', 'A river'], 2],
    ['What is the name of the robot in "WALL-E"?', ['WALL-E', 'EVE', 'R2D2', 'BB-8'], 0],
    ['Which movie features Elsa and Anna?', ['Frozen', 'Tangled', 'Brave', 'Encanto'], 0],
    ['In "Cars", what type of vehicle is Lightning McQueen?', ['Truck', 'Race car', 'Bus', 'Tractor'], 1],
    ['What do the minions love most in "Despicable Me"?', ['Pizza', 'Bananas', 'Candy', 'Ice cream'], 1]
  ],
  general: [
    ['What is the capital of France?', ['Berlin', 'Madrid', 'Paris', 'Rome'], 2],
    ['How many legs does a spider have?', ['6', '8', '10', '4'], 1],
    ['What planet is known as the Red Planet?', ['Venus', 'Mars', 'Jupiter', 'Saturn'], 1],
    ['What is the largest ocean on Earth?', ['Atlantic', 'Indian', 'Arctic', 'Pacific'], 3],
    ['How many colors are in a rainbow?', ['5', '6', '7', '8'], 2],
    ['What do bees make?', ['Milk', 'Honey', 'Silk', 'Butter'], 1],
    ['What is the tallest animal in the world?', ['Elephant', 'Giraffe', 'Horse', 'Bear'], 1],
    ['How many days are in a week?', ['5', '6', '7', '8'], 2],
    ['What gas do plants breathe in?', ['Oxygen', 'Carbon dioxide', 'Nitrogen', 'Helium'], 1],
    ['What is the freezing point of water in Celsius?', ['0', '10', '32', '100'], 0],
    ['Which season comes after winter?', ['Summer', 'Spring', 'Fall', 'Autumn'], 1],
    ['How many sides does a hexagon have?', ['5', '6', '7', '8'], 1],
    ['What is the fastest land animal?', ['Lion', 'Cheetah', 'Horse', 'Leopard'], 1],
    ['What do you call a baby dog?', ['Kitten', 'Puppy', 'Cub', 'Foal'], 1],
    ['How many continents are there?', ['5', '6', '7', '8'], 2]
  ]
};
function pickBank(topic) {
  const t = topic.toLowerCase();
  if (/animal|zoo|wildlife|pets?\b/.test(t)) return QUESTION_BANKS.animals;
  if (/movie|disney|pixar/.test(t)) return QUESTION_BANKS.movies;
  return QUESTION_BANKS.general;
}
function buildQuestions(topic, count) {
  const bank = pickBank(topic);
  const out = [];
  for (let i = 0; i < count; i++) out.push(bank[i % bank.length]);
  return out;
}

function buildApp(plan) {
  if (plan.kind === 'timer') return buildTimerApp(plan);
  return buildTriviaApp(plan);
}

function normalizePlan(input, description) {
  const base = makePlan(String(description || (input && input.title) || ''));
  const p = (input && typeof input === 'object') ? input : base;
  const int = (v, lo, hi, d) => { const n = Math.floor(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
  const str = (v, max, d) => (typeof v === 'string' && v.trim()) ? v.trim().slice(0, max) : d;
  const kind = p.kind === 'timer' ? 'timer' : 'trivia';
  const ref = kind === base.kind ? base : makePlan(kind === 'timer' ? 'interval timer' : 'trivia quiz');
  const s = p.settings || {};
  const settings = kind === 'trivia'
    ? { teams: int(s.teams, 1, 8, ref.settings.teams), rounds: int(s.rounds, 1, 10, ref.settings.rounds),
        questionsPerRound: int(s.questionsPerRound, 1, 20, ref.settings.questionsPerRound),
        secondsPerQuestion: int(s.secondsPerQuestion, 5, 120, ref.settings.secondsPerQuestion) }
    : { rounds: int(s.rounds, 1, 50, ref.settings.rounds), workSeconds: int(s.workSeconds, 5, 600, ref.settings.workSeconds),
        restSeconds: int(s.restSeconds, 0, 600, ref.settings.restSeconds),
        ...((s.style === 'yoga' || ref.settings.style === 'yoga') ? { style: 'yoga' } : {}) };
  const topic = str(p.content && p.content.topic, 60, ref.content.topic || '');
  return Object.assign({}, ref, {
    kind, settings,
    title: str(p.title, 80, ref.title),
    summary: str(p.summary, 300, ref.summary),
    content: kind === 'trivia'
      ? { topic, questions: settings.rounds * settings.questionsPerRound, choicesPerQuestion: 4, writtenAtBuildTime: true }
      : {}
  });
}

const modelWriter = require('./model_writer');
async function writeApp(plan, description) {
  if (!modelWriter.enabled()) {
    const html = buildApp(plan);
    return { html, report: validateApp(html, plan), writer: 'templates', attempts: 1 };
  }
  return modelWriter.writeWithModel(plan, description, { BASE_CSS, RUNTIME_SDK, escapeHtml, validateApp });
}

const RUNTIME_SDK = `
<script>
// --- App Studio runtime SDK (platform-provided, see design doc 7.3) ---
(function(){
  var backHandlers = [];
  var exitArmed = false, exitTimer = null;
  var focusables = [];
  var currentFocusIndex = -1;
  var hostKind = (window.top !== window.self) ? 'preview' : 'standalone';

  function refreshFocusables(){
    var overlay = document.querySelector('.pause-overlay.show, [data-modal].show');
    var root = overlay || document;
    focusables = Array.prototype.slice.call(root.querySelectorAll('[data-focus],button,a[href]'))
      .filter(function(el){ return el.offsetParent !== null && !el.disabled; });
  }
  function setFocus(el){
    Array.prototype.slice.call(document.querySelectorAll('.tv-focus')).forEach(function(f){ f.classList.remove('tv-focus'); });
    if (!el) return;
    el.classList.add('tv-focus');
    currentFocusIndex = focusables.indexOf(el);
    el.scrollIntoView({block:'nearest', inline:'nearest'});
  }
  function centerOf(el){
    var r = el.getBoundingClientRect();
    return {x: r.left + r.width/2, y: r.top + r.height/2, r: r};
  }
  function moveFocus(dir){
    refreshFocusables();
    if (!focusables.length) return;
    if (currentFocusIndex === -1) { setFocus(focusables[0]); return; }
    var cur = centerOf(focusables[currentFocusIndex]);
    var best = null, bestScore = Infinity;
    focusables.forEach(function(f, i){
      if (i === currentFocusIndex) return;
      var c = centerOf(f);
      var dx = c.x - cur.x, dy = c.y - cur.y;
      var ok = false, primary = 0, cross = 0;
      if (dir === 'left')  { ok = dx < -1;  primary = -dx; cross = Math.abs(dy); }
      if (dir === 'right') { ok = dx > 1;   primary = dx;  cross = Math.abs(dy); }
      if (dir === 'up')    { ok = dy < -1;  primary = -dy; cross = Math.abs(dx); }
      if (dir === 'down')  { ok = dy > 1;   primary = dy;  cross = Math.abs(dx); }
      if (!ok) return;
      var score = primary + cross * 2.2;
      if (score < bestScore) { bestScore = score; best = f; }
    });
    if (best) setFocus(best);
  }

  function sendBridge(msg){
    msg.v = 1;
    if (window.top !== window.self) {
      window.parent.postMessage(msg, '*');
    } else if (window.ReactNativeWebView) {
      window.ReactNativeWebView.postMessage(JSON.stringify(msg));
    }
  }

  var tv = {
    host: hostKind,
    ready: function(){ sendBridge({type:'ready'}); refreshFocusables(); if (focusables.length) setFocus(focusables[0]); },
    on: function(evt, fn){ if (evt === 'back') backHandlers.push(fn); if (evt === 'key') tv._keyFn = fn; },
    exit: function(){ sendBridge({type:'exit'}); },
    refocus: function(){ refreshFocusables(); if (!focusables.length) return; if (!focusables.includes(document.querySelector('.tv-focus'))) setFocus(focusables[0]); },
    storage: {
      _mem: {},
      get: function(k){ return tv.storage._mem[k]; },
      set: function(k, v){ tv.storage._mem[k] = v; sendBridge({type:'storage.set', key:k, value:v}); }
    }
  };
  window.tv = tv;

  function handleBack(){
    for (var i = backHandlers.length - 1; i >= 0; i--) {
      if (backHandlers[i]() === true) return;
    }
    if (exitArmed) { sendBridge({type:'exit'}); return; }
    exitArmed = true;
    var n = document.createElement('div');
    n.id = 'tv-back-toast'; n.textContent = 'Press Back again to leave';
    n.style.cssText = 'position:fixed;left:50%;bottom:60px;transform:translateX(-50%);background:#111;color:#fff;padding:14px 28px;border-radius:10px;font-size:28px;z-index:9999;font-family:sans-serif';
    document.body.appendChild(n);
    clearTimeout(exitTimer);
    exitTimer = setTimeout(function(){ exitArmed = false; var el = document.getElementById('tv-back-toast'); if (el) el.remove(); }, 2500);
  }

  var KEY = { 37:'left', 38:'up', 39:'right', 40:'down', 13:'select', 27:'back', 4:'back' };
  function handleKey(code){
    var k = KEY[code];
    if (k === 'left' || k === 'right' || k === 'up' || k === 'down') {
      moveFocus(k);
      if (tv._keyFn) tv._keyFn({key:k});
      return true;
    }
    if (k === 'select') {
      var f = focusables[currentFocusIndex];
      if (f) f.click();
      if (tv._keyFn) tv._keyFn({key:'select'});
      return true;
    }
    if (k === 'back') { handleBack(); return true; }
    return false;
  }
  window.addEventListener('keydown', function(e){
    if (handleKey(e.keyCode)) e.preventDefault();
  });
  window.addEventListener('message', function(e){
    var m = e.data;
    if (e.source !== window.parent || window.parent === window) return;
    if (m && m.type === 'key' && typeof m.keyCode === 'number') handleKey(m.keyCode);
  });

  setInterval(function(){ sendBridge({type:'heartbeat'}); }, 2000);
  window.addEventListener('error', function(e){
    sendBridge({type:'error', message: String(e.message), stack: e.error && e.error.stack});
  });

  var lastView = '';
  setInterval(function(){
    var s = document.querySelector('.screen.active'), f = document.querySelector('.tv-focus');
    var t = document.querySelector('h1.app-title'), p = document.getElementById('pause'), r = document.getElementById('reveal-text');
    var view = { screen: s ? s.id : null, focused: f ? f.textContent.trim() : null, appTitle: t ? t.textContent : null,
      paused: !!(p && p.classList.contains('show')), reveal: r ? r.textContent : null };
    var key = JSON.stringify(view);
    if (key !== lastView) { lastView = key; view.type = 'view'; sendBridge(view); }
  }, 150);

  document.addEventListener('DOMContentLoaded', function(){
    refreshFocusables();
  });
})();
</script>`;

const BASE_CSS = `
<style>
  * { box-sizing: border-box; }
  html, body { margin:0; padding:0; width:1920px; height:1080px; background:#0b0f14; color:#fff;
    font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif; overflow:hidden; }
  .stage { width:1920px; height:1080px; padding:54px 96px; position:relative; }
  .screen { display:none; width:100%; height:100%; flex-direction:column; }
  .screen.active { display:flex; }
  h1.app-title { font-size:64px; margin:0 0 10px; }
  p.app-sub { font-size:28px; color:#9fb0c0; margin:0 0 40px; }
  .row { display:flex; gap:28px; flex-wrap:wrap; }
  button { font-size:34px; padding:26px 36px; border-radius:16px; border:4px solid transparent;
    background:#1b2735; color:#fff; cursor:pointer; }
  button.tv-focus { border-color:#58a6ff; background:#223349; box-shadow:0 0 0 6px rgba(88,166,255,.25); }
  .big { font-size:120px; font-weight:700; text-align:center; }
  .huge { font-size:220px; font-weight:800; text-align:center; }
  .center { display:flex; flex-direction:column; align-items:center; justify-content:center; height:100%; }
  .scoreboard { position:absolute; top:54px; right:96px; font-size:30px; color:#9fb0c0; }
  .pause-overlay { position:absolute; inset:0; background:rgba(11,15,20,.94); display:none;
    flex-direction:column; align-items:center; justify-content:center; z-index:50; }
  .pause-overlay.show { display:flex; }
  .choice { font-size:38px; text-align:left; width:1200px; }
  .timerbar { height:28px; background:#1b2735; border-radius:14px; overflow:hidden; margin:30px 0; width:1200px; }
  .timerbar > div { height:100%; background:#58a6ff; width:100%; }
</style>`;

function escapeJs(s) { return JSON.stringify(s); }
function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function buildTriviaApp(plan) {
  const { teams, rounds, questionsPerRound, secondsPerQuestion } = plan.settings;
  const qs = buildQuestions(plan.content.topic, rounds * questionsPerRound);
  const qsJs = qs.map(([q, choices, correct]) => `{q:${escapeJs(q)},c:${JSON.stringify(choices)},a:${correct}}`).join(',');

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${escapeHtml(plan.title)}</title>${BASE_CSS}</head>
<body>
<div class="stage">
  <div class="scoreboard" id="scoreboard"></div>

  <section class="screen active" id="s-title">
    <div class="center">
      <h1 class="app-title">${escapeHtml(plan.title)}</h1>
      <p class="app-sub">${escapeHtml(plan.summary)}</p>
      <button data-focus onclick="renderQuestion()">Start Game</button>
    </div>
  </section>

  <section class="screen" id="s-question">
    <h1 class="app-title" id="q-round-label">Round 1</h1>
    <div class="timerbar"><div id="q-timerfill"></div></div>
    <p class="app-sub" id="q-text" style="font-size:40px;color:#fff"></p>
    <div class="row" id="q-choices"></div>
  </section>

  <section class="screen" id="s-reveal">
    <div class="center">
      <div class="big" id="reveal-text"></div>
      <button data-focus onclick="nextQuestion()">Next</button>
    </div>
  </section>

  <section class="screen" id="s-final">
    <div class="center">
      <h1 class="app-title">Final Scores</h1>
      <div class="big" id="final-text"></div>
      <button data-focus onclick="restart()">Play Again</button>
    </div>
  </section>

  <div class="pause-overlay" id="pause">
    <div class="huge" style="font-size:72px">Paused</div>
    <div class="row" style="margin-top:30px">
      <button data-focus onclick="resumeGame()">Resume</button>
      <button onclick="tv.exit()">Quit</button>
    </div>
  </div>
</div>
${RUNTIME_SDK}
<script>
  var QUESTIONS = [${qsJs}];
  var TEAMS = ${teams}, ROUNDS = ${rounds}, PER_ROUND = ${questionsPerRound}, SECS = ${secondsPerQuestion};
  var scores = []; for (var i=0;i<TEAMS;i++) scores.push(0);
  var qi = 0, turnTeam = 0, timer = null, remaining = SECS, paused = false, answered = false;

  function goTo(id){
    document.querySelectorAll('.screen').forEach(function(s){ s.classList.remove('active'); });
    document.getElementById(id).classList.add('active');
    renderScoreboard();
    if (window.tv) tv.ready();
  }
  function renderScoreboard(){
    document.getElementById('scoreboard').textContent =
      scores.map(function(s,i){ return 'Team ' + (i+1) + ': ' + s; }).join('   ·   ');
  }
  function startTimer(){
    clearInterval(timer); remaining = SECS; updateTimerBar();
    timer = setInterval(function(){
      if (paused) return;
      remaining--; updateTimerBar();
      if (remaining <= 0) { clearInterval(timer); revealAnswer(-1); }
    }, 1000);
  }
  function updateTimerBar(){
    var pct = Math.max(0, remaining / SECS) * 100;
    document.getElementById('q-timerfill').style.width = pct + '%';
  }
  function renderQuestion(){
    answered = false;
    var q = QUESTIONS[qi];
    document.getElementById('q-round-label').textContent =
      'Round ' + (Math.floor(qi/PER_ROUND)+1) + ' of ' + ROUNDS + ' — Team ' + (turnTeam+1) + "'s turn";
    document.getElementById('q-text').textContent = q.q;
    var box = document.getElementById('q-choices'); box.innerHTML = '';
    q.c.forEach(function(choice, idx){
      var b = document.createElement('button');
      b.className = 'choice'; b.setAttribute('data-focus', '');
      b.textContent = String.fromCharCode(65+idx) + '.  ' + choice;
      b.onclick = function(){ if (!answered) revealAnswer(idx); };
      box.appendChild(b);
    });
    goTo('s-question');
    startTimer();
  }
  function revealAnswer(chosenIdx){
    answered = true; clearInterval(timer);
    var q = QUESTIONS[qi];
    var correct = chosenIdx === q.a;
    if (correct) scores[turnTeam] += 10;
    document.getElementById('reveal-text').textContent =
      correct ? 'Correct! +10 points' : ('Wrong — answer was: ' + q.c[q.a]);
    goTo('s-reveal');
  }
  function nextQuestion(){
    qi++; turnTeam = (turnTeam+1) % TEAMS;
    if (qi >= QUESTIONS.length) {
      document.getElementById('final-text').textContent =
        scores.map(function(s,i){ return 'Team ' + (i+1) + ': ' + s + ' pts'; }).join('   |   ');
      goTo('s-final');
    } else {
      renderQuestion();
    }
  }
  function restart(){
    qi = 0; turnTeam = 0; scores = scores.map(function(){ return 0; });
    goTo('s-title');
  }
  function pauseGame(){ paused = true; document.getElementById('pause').classList.add('show'); tv.refocus(); }
  function resumeGame(){ paused = false; document.getElementById('pause').classList.remove('show'); tv.refocus(); }

  window.tv.on('back', function(){
    if (document.getElementById('s-title').classList.contains('active')) return false;
    if (document.getElementById('pause').classList.contains('show')) { resumeGame(); return true; }
    pauseGame(); return true;
  });
  window.tv.on('key', function(e){ if (e.key === 'select' && document.getElementById('s-title').classList.contains('active')) {} });

  document.addEventListener('DOMContentLoaded', function(){ tv.ready(); });
</script>
</body></html>`;
}

const YOGA_POSES = ['Mountain Pose', 'Tree Pose', 'Warrior II', 'Downward Dog', "Child's Pose", 'Cat-Cow', 'Cobra', 'Triangle Pose', 'Bridge Pose', 'Seated Twist'];

function buildTimerApp(plan) {
  const { rounds, workSeconds, restSeconds } = plan.settings;
  const yoga = plan.settings.style === 'yoga';
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${escapeHtml(plan.title)}</title>${BASE_CSS}</head>
<body>
<div class="stage">
  <section class="screen active" id="s-title">
    <div class="center">
      <h1 class="app-title">${escapeHtml(plan.title)}</h1>
      <p class="app-sub">${escapeHtml(plan.summary)}</p>
      <button data-focus onclick="startWorkout()">${yoga ? 'Begin' : 'Start'}</button>
    </div>
  </section>
  <section class="screen" id="s-run">
    <div class="center">
      <div class="app-sub" id="phase-label" style="font-size:40px"></div>
      <div class="huge" id="clock">00</div>
      <div class="app-sub" id="round-label"></div>
    </div>
  </section>
  <section class="screen" id="s-done">
    <div class="center">
      <h1 class="app-title" id="done-title">Workout complete</h1>
      <button data-focus onclick="goTo('s-title')">Done</button>
    </div>
  </section>
  <div class="pause-overlay" id="pause">
    <div class="huge" style="font-size:72px">Paused</div>
    <div class="row" style="margin-top:30px">
      <button data-focus onclick="resumeTimer()">Resume</button>
      <button onclick="tv.exit()">Quit</button>
    </div>
  </div>
</div>
${RUNTIME_SDK}
<script>
  var ROUNDS = ${rounds}, WORK = ${workSeconds}, REST = ${restSeconds};
  var YOGA = ${yoga ? 'true' : 'false'}, POSES = ${JSON.stringify(YOGA_POSES)};
  if (YOGA) document.getElementById('done-title').textContent = 'Namaste. Session complete';
  var round = 0, phase = 'work', remaining = WORK, timer = null, paused = false;

  function goTo(id){
    document.querySelectorAll('.screen').forEach(function(s){ s.classList.remove('active'); });
    document.getElementById(id).classList.add('active');
    if (window.tv) tv.ready();
  }
  function render(){
    document.getElementById('phase-label').textContent = YOGA
      ? (phase === 'work' ? POSES[round % POSES.length] : 'Switch to ' + POSES[(round + 1) % POSES.length])
      : (phase === 'work' ? 'WORK' : 'REST');
    document.getElementById('clock').textContent = String(remaining).padStart(2,'0');
    document.getElementById('round-label').textContent = (YOGA ? 'Pose ' : 'Round ') + (round+1) + ' of ' + ROUNDS;
  }
  function tick(){
    if (paused) return;
    remaining--;
    if (remaining < 0) {
      if (phase === 'work') { phase = 'rest'; remaining = REST; }
      else { round++; phase = 'work'; remaining = WORK; }
      if (round >= ROUNDS) { clearInterval(timer); goTo('s-done'); return; }
    }
    render();
  }
  function startWorkout(){
    round = 0; phase = 'work'; remaining = WORK;
    goTo('s-run'); render();
    clearInterval(timer); timer = setInterval(tick, 1000);
  }
  function pauseTimer(){ paused = true; document.getElementById('pause').classList.add('show'); tv.refocus(); }
  function resumeTimer(){ paused = false; document.getElementById('pause').classList.remove('show'); tv.refocus(); }

  window.tv.on('back', function(){
    if (document.getElementById('s-title').classList.contains('active')) return false;
    if (document.getElementById('pause').classList.contains('show')) { resumeTimer(); return true; }
    pauseTimer(); return true;
  });

  document.addEventListener('DOMContentLoaded', function(){ tv.ready(); });
</script>
</body></html>`;
}

function validateApp(html, plan) {
  const report = { passed: true, checks: [] };
  function check(name, ok, detail) {
    report.checks.push({ name, ok, detail });
    if (!ok) report.passed = false;
  }

  const sizeKB = Buffer.byteLength(html, 'utf8') / 1024;
  check('size-budget', sizeKB < 300, `${sizeKB.toFixed(1)} KB (limit 300 KB)`);

  const hasNetwork = /\bfetch\s*\(|XMLHttpRequest|WebSocket|<script[^>]+src=["']https?:/i.test(html);
  check('no-network-calls', !hasNetwork, hasNetwork ? 'found a network/remote-script call' : 'none found');

  const hasEval = /\beval\s*\(|new\s+Function\s*\(/.test(html);
  check('no-eval', !hasEval, hasEval ? 'eval()/Function() present' : 'none found');

  const hasTextInput = /<input\b(?![^>]*type=["']?(button|checkbox|radio)["']?)[^>]*>|<textarea\b/i.test(html);
  check('no-text-inputs', !hasTextInput, hasTextInput ? 'a text input was found' : 'none found');

  const hasRuntime = html.includes('App Studio runtime SDK');
  check('runtime-sdk-present', hasRuntime, hasRuntime ? 'present' : 'MISSING — app would have no focus engine or bridge');

  const hasBackHandler = /tv\.on\(\s*['"]back['"]/.test(html);
  check('back-handled', hasBackHandler, hasBackHandler ? 'a back handler is registered' : 'no back handler — Home/Back could get stuck');

  const screenBlocks = [...html.matchAll(/<section[^>]*class="screen[^"]*"[^>]*id="([^"]+)"[\s\S]*?<\/section>/g)];
  let allScreensHaveFocus = true, screenDetail = [];
  for (const m of screenBlocks) {
    const body = m[0];
    const focusCount = (body.match(/data-focus/g) || []).length;
    screenDetail.push(`${m[1]}: ${focusCount} focusable`);
    if (focusCount === 0 && !/id="s-reveal"/.test(m[0]) === false) {  }
  }
  check('screens-detected', screenBlocks.length > 0, `${screenBlocks.length} screens found`);

  const hasSmallText = /font-size:\s*(\d+)px/g;
  let m, tooSmall = [];
  while ((m = hasSmallText.exec(html))) { if (parseInt(m[1], 10) < 24) tooSmall.push(m[1] + 'px'); }
  check('text-size', tooSmall.length === 0, tooSmall.length ? `found ${tooSmall.join(',')}` : 'all text >= 24px');

  if (plan.kind === 'trivia') {
    const qMatch = html.match(/var QUESTIONS = \[(.*?)\];/s);
    const count = qMatch ? (qMatch[1].match(/\{q:/g) || []).length : 0;
    check('content-matches-plan', count === plan.content.questions, `${count} questions generated, plan asked for ${plan.content.questions}`);
  }

  return report;
}

const PUBLIC_DIR = path.join(__dirname, 'public');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };

function send(res, code, body, headers) {
  res.writeHead(code, headers || {});
  res.end(body);
}
function sendJSON(res, code, obj) { send(res, code, JSON.stringify(obj), { 'Content-Type': 'application/json' }); }

function readBody(req) {
  return new Promise((resolve, reject) => {
    let chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
      catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

function serveStatic(req, res, urlPath) {
  const safe = path.normalize(urlPath).replace(/^(\.\.[\/\\])+/, '');
  let filePath = path.join(PUBLIC_DIR, safe === '/' ? '/index.html' : safe);
  if (!filePath.startsWith(PUBLIC_DIR)) return send(res, 403, 'forbidden');
  fs.readFile(filePath, (err, data) => {
    if (err) return send(res, 404, 'not found');
    const ext = path.extname(filePath);
    send(res, 200, data, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
  });
}

const ALLOWED_HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);
function sameOriginWrite(req) {
  if (req.method === 'GET' || req.method === 'HEAD') return true;
  const origin = req.headers.origin;
  if (origin) {
    try { return ALLOWED_HOSTS.has(new URL(origin).host); } catch (e) { return false; }
  }
  return true;
}

const server = http.createServer(async (req, res) => {
  if (!ALLOWED_HOSTS.has(String(req.headers.host || '').toLowerCase())) return send(res, 421, 'unexpected host');
  if (!sameOriginWrite(req)) return send(res, 403, 'cross-origin request refused');
  const u = new URL(req.url, `http://${HOST}:${PORT}`);
  const p = u.pathname;

  try {
    if (p === '/v1/device/code' && req.method === 'POST') {
      const code = shortCode();
      const tvId = id('tv');
      db.deviceCodes[code] = { tvId, createdAt: Date.now(), approved: false, expiresAt: Date.now() + 10 * 60 * 1000 };
      db.tvs[tvId] = { id: tvId, name: 'Living Room TV', paired: false, apps: {} };
      saveDB();
      return sendJSON(res, 200, { code, tvId, expiresInSec: 600 });
    }
    if (p === '/v1/device/approve' && req.method === 'POST') {
      const { code } = await readBody(req);
      const entry = db.deviceCodes[code];
      if (!entry) return sendJSON(res, 404, { error: 'unknown or expired code' });
      if (Date.now() > entry.expiresAt) return sendJSON(res, 410, { error: 'code expired' });
      entry.approved = true;
      db.tvs[entry.tvId].paired = true;
      saveDB();
      return sendJSON(res, 200, { ok: true, tvId: entry.tvId });
    }
    if (p === '/v1/device/poll' && req.method === 'GET') {
      const code = u.searchParams.get('code');
      const entry = db.deviceCodes[code];
      if (!entry) return sendJSON(res, 404, { error: 'unknown or expired code' });
      if (Date.now() > entry.expiresAt) return sendJSON(res, 410, { error: 'expired' });
      return sendJSON(res, 200, { approved: entry.approved, tvId: entry.tvId });
    }
    if (p === '/v1/tvs' && req.method === 'GET') {
      return sendJSON(res, 200, { tvs: Object.values(db.tvs).filter(t => t.paired) });
    }

    if (p === '/v1/plans' && req.method === 'POST') {
      const { description } = await readBody(req);
      if (!description || !description.trim()) return sendJSON(res, 400, { error: 'description required' });
      return sendJSON(res, 200, { plan: normalizePlan(null, description) });
    }
    if (p === '/v1/apps' && req.method === 'POST') {
      const { description, plan: incomingPlan } = await readBody(req);
      const plan = normalizePlan(incomingPlan, description);
      let written;
      try { written = await writeApp(plan, description); }
      catch (e) { return sendJSON(res, 502, { error: 'the app writer is unavailable: ' + e.message }); }
      const { html, report, writer, attempts } = written;

      const appId = id('app');
      const versionId = id('ver');
      db.apps[appId] = {
        id: appId, title: plan.title, createdAt: Date.now(),
        currentVersionId: report.passed ? versionId : null,
        versions: {
          [versionId]: { id: versionId, number: 1, plan, html, report, writer, attempts, status: report.passed ? 'ready' : 'failed', createdAt: Date.now() }
        }
      };
      saveDB();
      return sendJSON(res, report.passed ? 200 : 422, { appId, versionId, plan, report, writer, attempts });
    }
    if (p === '/v1/apps' && req.method === 'GET') {
      const list = Object.values(db.apps).map(a => ({ id: a.id, title: a.title, currentVersionId: a.currentVersionId, versions: Object.keys(a.versions).length }));
      return sendJSON(res, 200, { apps: list });
    }
    if (p.startsWith('/v1/apps/') && p.endsWith('/rebuild') && req.method === 'POST') {
      const appId = p.split('/')[3];
      const app = db.apps[appId];
      if (!app) return sendJSON(res, 404, { error: 'not found' });
      const { description } = await readBody(req);
      const plan = normalizePlan(null, description || '');
      let written;
      try { written = await writeApp(plan, description); }
      catch (e) { return sendJSON(res, 502, { error: 'the app writer is unavailable: ' + e.message }); }
      const { html, report, writer, attempts } = written;
      const versionId = id('ver');
      const nextNum = Object.keys(app.versions).length + 1;
      app.versions[versionId] = { id: versionId, number: nextNum, plan, html, report, writer, attempts, status: report.passed ? 'ready' : 'failed', createdAt: Date.now() };
      if (report.passed) { app.currentVersionId = versionId; app.title = plan.title; }
      saveDB();
      return sendJSON(res, report.passed ? 200 : 422, { appId, versionId, plan, report, writer, attempts });
    }
    if (p.startsWith('/v1/apps/') && p.endsWith('/rollback') && req.method === 'POST') {
      const appId = p.split('/')[3];
      const { versionId } = await readBody(req);
      const app = db.apps[appId];
      if (!app || !app.versions[versionId]) return sendJSON(res, 404, { error: 'not found' });
      app.currentVersionId = versionId;
      saveDB();
      return sendJSON(res, 200, { ok: true, currentVersionId: versionId });
    }

    if (p === '/sandbox' && req.method === 'GET') {
      const token = u.searchParams.get('t');
      const result = verifyLink(token);
      if (!result) return send(res, 403, 'bad link');
      if (result === 'expired') return send(res, 410, 'link expired');
      const app = db.apps[result.appId];
      const version = app && app.versions[result.versionId];
      if (!version) return send(res, 404, 'version not found');
      return send(res, 200, version.html, { 'Content-Type': 'text/html', 'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'none'" });
    }
    if (p.startsWith('/v1/apps/') && p.endsWith('/preview-link') && req.method === 'POST') {
      const appId = p.split('/')[3];
      const app = db.apps[appId];
      if (!app || !app.currentVersionId) return sendJSON(res, 404, { error: 'no current version' });
      const token = signLink(appId, app.currentVersionId, 5 * 60 * 1000);
      return sendJSON(res, 200, { url: `/sandbox?t=${token}` });
    }

    if (p === '/v1/send' && req.method === 'POST') {
      const { appId, tvId } = await readBody(req);
      const app = db.apps[appId];
      const tvv = db.tvs[tvId];
      if (!app || !app.currentVersionId) return sendJSON(res, 404, { error: 'app has no ready version' });
      if (!tvv || !tvv.paired) return sendJSON(res, 404, { error: 'tv not paired' });
      tvv.apps[appId] = { appId, versionId: app.currentVersionId, deliveredAt: Date.now(), opened: false };
      db.events.push({ tvId, type: 'delivery', appId, title: app.title, at: Date.now() });
      saveDB();
      return sendJSON(res, 200, { ok: true });
    }
    if (p.startsWith('/v1/tv/') && p.endsWith('/apps') && req.method === 'GET') {
      const tvId = p.split('/')[3];
      const tvv = db.tvs[tvId];
      if (!tvv) return sendJSON(res, 404, { error: 'not found' });
      const list = Object.values(tvv.apps).map(e => {
        const app = db.apps[e.appId];
        return { appId: e.appId, title: app ? app.title : '(deleted)', deliveredAt: e.deliveredAt };
      }).sort((a, b) => b.deliveredAt - a.deliveredAt);
      return sendJSON(res, 200, { apps: list });
    }
    if (p.startsWith('/v1/tv/') && p.endsWith('/events') && req.method === 'GET') {
      const tvId = p.split('/')[3];
      const since = Number(u.searchParams.get('since') || 0);
      const events = db.events.filter(e => e.tvId === tvId && e.at > since);
      return sendJSON(res, 200, { events, now: Date.now() });
    }
    if (p.startsWith('/v1/tv/') && p.endsWith('/launch') && req.method === 'POST') {
      const tvId = p.split('/')[3];
      const { appId } = await readBody(req);
      const tvv = db.tvs[tvId];
      const entry = tvv && tvv.apps[appId];
      if (!entry) return sendJSON(res, 404, { error: 'app not delivered to this tv' });
      const app = db.apps[appId];
      const token = signLink(appId, entry.versionId, 5 * 60 * 1000);
      entry.opened = true;
      saveDB();
      return sendJSON(res, 200, { url: `/sandbox?t=${token}` });
    }

    if (req.method === 'GET') return serveStatic(req, res, p);

    return send(res, 404, 'not found');
  } catch (e) {
    console.error(e);
    return sendJSON(res, 500, { error: String(e && e.message || e) });
  }
});

if (require.main === module) {
  server.listen(PORT, HOST, () => {
    console.log(`Prompt-to-TV demo server: http://${HOST}:${PORT}`);
    console.log(`  Builder:          http://${HOST}:${PORT}/builder.html`);
    console.log(`  TV player sim:    http://${HOST}:${PORT}/player.html`);
    console.log(`  Fire TV / emulator: adb reverse tcp:${PORT} tcp:${PORT}, then connect to http://localhost:${PORT}`);
    console.log(`  App writer:       ${modelWriter.enabled() ? 'AI model ' + modelWriter.MODEL_ID + ' (Amazon Bedrock)' : 'templates (set PTV_MODEL_ID to use a model)'}`);
  });
}

module.exports = { normalizePlan, buildApp, validateApp, escapeHtml, BASE_CSS, RUNTIME_SDK };
