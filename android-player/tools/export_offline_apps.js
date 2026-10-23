#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');

const SERVER = process.env.PTV_SERVER || 'http://127.0.0.1:4848';
const OUT_DIR = path.join(__dirname, '..', 'app', 'src', 'main', 'assets', 'offline');
const APPS_DIR = path.join(OUT_DIR, 'apps');

const DESCRIPTIONS = [
  'A movie trivia game for my family about movies, 2 teams, 3 rounds of 5 questions, 20 seconds per question',
  'A general knowledge quiz for the family, 2 teams, 2 rounds of 5 questions, 30 seconds per question',
  'A workout interval timer about HIIT, 5 rounds, 30 seconds work with rest between rounds'
];

async function post(p, body) {
  const r = await fetch(SERVER + p, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {})
  });
  return { status: r.status, data: await r.json() };
}

async function main() {
  fs.mkdirSync(APPS_DIR, { recursive: true });
  for (const f of fs.readdirSync(APPS_DIR)) if (f.endsWith('.html')) fs.unlinkSync(path.join(APPS_DIR, f));

  const manifest = [];
  for (const [i, description] of DESCRIPTIONS.entries()) {
    const built = await post('/v1/apps', { description });
    if (built.status !== 200 || !built.data.report || !built.data.report.passed) {
      throw new Error('build failed for "' + description + '": ' + JSON.stringify(built.data.report || built.data));
    }
    const { appId, plan } = built.data;
    const link = await post('/v1/apps/' + appId + '/preview-link');
    if (link.status !== 200) throw new Error('preview-link failed: ' + JSON.stringify(link.data));
    const page = await fetch(SERVER + link.data.url);
    if (page.status !== 200) throw new Error('sandbox fetch failed: HTTP ' + page.status);
    const html = await page.text();

    fs.writeFileSync(path.join(APPS_DIR, appId + '.html'), html);
    manifest.push({ appId, title: plan.title, kind: plan.kind, featured: i === 0 });
    console.log('exported', appId, plan.kind.padEnd(7), JSON.stringify(plan.title), html.length + ' bytes');
  }
  fs.writeFileSync(path.join(OUT_DIR, 'apps.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log('wrote', path.relative(process.cwd(), path.join(OUT_DIR, 'apps.json')));
}

main().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
