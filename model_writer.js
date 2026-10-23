'use strict';
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const MODEL_ID = (process.env.PTV_MODEL_ID || '').trim();
const REGION = (process.env.PTV_MODEL_REGION || process.env.AWS_REGION || 'us-east-1').trim();
const AWS = process.env.PTV_AWS_CLI || (fs.existsSync('/opt/homebrew/bin/aws') ? '/opt/homebrew/bin/aws' : 'aws');
const MAX_ATTEMPTS = 2;
const enabled = () => !!MODEL_ID;

const SYSTEM = `You write small apps for a TV that is controlled only with a remote (D-pad, OK, Back).
The platform wraps your output in a page that already has: a 1920x1080 stage, base CSS, and the
runtime SDK below. Write ONLY the app's markup and script, in exactly this format:

<<<MARKUP
...HTML that goes inside <div class="stage">...</div>...
>>>
<<<SCRIPT
...JavaScript (no <script> tags)...
>>>

Runtime SDK (already loaded before your script):
- Screens: <section class="screen" id="s-NAME">...</section>; exactly one has class "screen active".
  Write the class attribute before the id attribute. Switch screens by moving the "active" class,
  then call tv.ready().
- Focus: give every control <button data-focus>. The D-pad moves focus between visible buttons
  automatically and OK clicks the focused one. Never handle arrow keys yourself.
- Back: tv.on('back', function(){ ...; return true; }) when you handle it. Every screen except the
  first must handle Back (usually: open a pause menu).
- Pause menu: <div class="pause-overlay" id="pause"><div class="huge" style="font-size:72px">Paused</div>
  <div class="row"><button data-focus onclick="...">Resume</button><button onclick="tv.exit()">Quit</button></div></div>.
  Show it by adding class "show", hide by removing it; call tv.refocus() after either.
- tv.exit() leaves the app. tv.storage.get(key) / tv.storage.set(key, value) keep small values.
- Available classes: app-title, app-sub, row, big, huge, center, scoreboard, choice, timerbar.

Rules (the build is rejected otherwise):
- No network of any kind: no fetch, XMLHttpRequest, WebSocket, external scripts, images or fonts.
- No eval or new Function. No text inputs or textareas (there is no keyboard).
- Every font-size you set is at least 24px. Text must be readable from across a room.
- Keep it under 100 KB. Put all content (questions, words, numbers) inline.
- For a trivia game, define: var QUESTIONS = [{q:"...", c:["A","B","C","D"], a:INDEX}, ...];
  with exactly the number of questions the plan asks for.
- Family friendly content only.`;

function userPrompt(plan, description, failures) {
  let p = `What the person asked for:\n${description || '(no description)'}\n\nPlan (JSON):\n${JSON.stringify(plan, null, 2)}\n`;
  if (failures && failures.length) {
    p += `\nYour previous version failed these checks. Fix them and send the whole app again:\n` +
      failures.map(c => `- ${c.name}: ${c.detail}`).join('\n') + '\n';
  }
  return p;
}

function invokeBedrock(system, user) {
  return new Promise((resolve, reject) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ptv-model-'));
    const file = path.join(dir, 'request.json');
    fs.writeFileSync(file, JSON.stringify({
      modelId: MODEL_ID,
      system: [{ text: system }],
      messages: [{ role: 'user', content: [{ text: user }] }],
      inferenceConfig: { maxTokens: 12000, temperature: 0.4 }
    }), { mode: 0o600 });
    execFile(AWS, ['bedrock-runtime', 'converse', '--region', REGION, '--cli-input-json', 'file://' + file, '--output', 'json'],
      { timeout: 180000, maxBuffer: 1 << 24 }, (err, stdout, stderr) => {
        fs.rmSync(dir, { recursive: true, force: true });
        if (err) return reject(new Error('model call failed: ' + String(stderr || err.message).trim().split('\n').pop()));
        try {
          const out = JSON.parse(stdout);
          const text = (out.output.message.content || []).map(c => c.text || '').join('');
          resolve({ text, usage: out.usage || null });
        } catch (e) { reject(new Error('model reply was not understood')); }
      });
  });
}

function section(text, name) {
  const m = text.match(new RegExp(`<<<${name}\\s*\\n([\\s\\S]*?)\\n?>>>`));
  return m ? m[1] : null;
}

function assemble(plan, text, { BASE_CSS, RUNTIME_SDK, escapeHtml }) {
  let markup = section(text, 'MARKUP');
  let script = section(text, 'SCRIPT');
  if (markup == null || script == null) throw new Error('reply did not contain MARKUP and SCRIPT sections');
  markup = markup.replace(/<script\b[\s\S]*?<\/script\s*>/gi, '').replace(/<\/?(html|head|body|script|style|link|meta|iframe|object|embed|base)\b[^>]*>/gi, '');
  if (/<\/script/i.test(script)) throw new Error('script section tried to close the script tag');
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${escapeHtml(plan.title)}</title>${BASE_CSS}</head>
<body>
<div class="stage">
${markup}
</div>
${RUNTIME_SDK}
<script>
${script}
</script>
</body></html>`;
}

async function writeWithModel(plan, description, deps, invoke = invokeBedrock) {
  let failures = null, last = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const { text } = await invoke(SYSTEM, userPrompt(plan, description, failures));
    let html, report;
    try {
      html = assemble(plan, text, deps);
      report = deps.validateApp(html, plan);
    } catch (e) {
      report = { passed: false, checks: [{ name: 'model-output-format', ok: false, detail: e.message }] };
      html = '';
    }
    last = { html, report, writer: 'model:' + (MODEL_ID || 'test'), attempts: attempt };
    if (report.passed) return last;
    failures = report.checks.filter(c => !c.ok);
  }
  return last;
}

module.exports = { enabled, writeWithModel, assemble, MODEL_ID, SYSTEM };
