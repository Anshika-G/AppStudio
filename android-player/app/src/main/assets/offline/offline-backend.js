(function () {
  'use strict';
  var DEBUG = /[?&]debug=1\b/.test(location.search);
  var APPROVE_AFTER_MS = DEBUG ? 7000 : 4000;
  var DELIVER_AFTER_MS = 3000;
  var STATE_KEY = 'ptv_offline_state';
  var TV_NAME = 'Living Room TV (offline demo)';
  var FILE_MODE = location.protocol === 'file:';
  var BASE = location.href.replace(/[^/]*([?#].*)?$/, '');

  var manifestPromise = null;
  function manifest() {
    if (!manifestPromise) {
      manifestPromise = FILE_MODE
        ? Promise.resolve(window.__ptvApps || [])
        : realFetch('/offline/apps.json').then(function (r) {
            if (!r.ok) throw new Error('apps.json missing: ' + r.status);
            return r.json();
          });
    }
    return manifestPromise;
  }

  function loadState() {
    try { return JSON.parse(localStorage.getItem(STATE_KEY)) || {}; } catch (e) { return {}; }
  }
  function saveState(s) { localStorage.setItem(STATE_KEY, JSON.stringify(s)); }

  function shortCode() {
    var alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    var out = '', buf = new Uint32Array(6);
    crypto.getRandomValues(buf);
    for (var i = 0; i < 6; i++) out += alphabet[buf[i] % alphabet.length];
    return out;
  }
  function randomHex(bytes) {
    var buf = new Uint8Array(bytes), s = '';
    crypto.getRandomValues(buf);
    for (var i = 0; i < buf.length; i++) s += ('0' + buf[i].toString(16)).slice(-2);
    return s;
  }

  function json(status, body) {
    return new Response(JSON.stringify(body), { status: status, headers: { 'Content-Type': 'application/json' } });
  }

  function settleDeliveries(state, apps) {
    if (!state.pairedAt) return;
    state.delivered = state.delivered || {};
    state.events = state.events || [];
    var featured = apps.filter(function (a) { return a.featured; })[0] || apps[0];
    apps.forEach(function (a, i) {
      if (state.delivered[a.appId]) return;
      if (a === featured) {
        var at = state.pairedAt + DELIVER_AFTER_MS;
        if (Date.now() < at) return;
        state.delivered[a.appId] = at;
        state.events.push({ tvId: state.tvId, type: 'delivery', appId: a.appId, title: a.title, at: at });
      } else {
        state.delivered[a.appId] = state.pairedAt - (i + 1) * 60000;
      }
    });
  }

  function handle(method, url, body) {
    var p = apiPath(url), m;
    var state = loadState();

    if (p === '/v1/device/code' && method === 'POST') {
      state = { code: shortCode(), tvId: 'tv_' + randomHex(6), issuedAt: Date.now() };
      saveState(state);
      return Promise.resolve(json(200, { code: state.code, tvId: state.tvId, expiresInSec: 600 }));
    }
    if (p === '/v1/device/poll' && method === 'GET') {
      if (url.searchParams.get('code') !== state.code) return Promise.resolve(json(404, { error: 'unknown or expired code' }));
      if (!state.pairedAt && Date.now() - state.issuedAt >= APPROVE_AFTER_MS) {
        state.pairedAt = Date.now();
        state.name = TV_NAME;
        saveState(state);
      }
      return Promise.resolve(json(200, { approved: !!state.pairedAt, tvId: state.tvId }));
    }

    m = p.match(/^\/v1\/tv\/([^/]+)\/(apps|events|launch)$/);
    if (!m) return Promise.resolve(json(404, { error: 'not found (offline demo)' }));
    var tvId = m[1], what = m[2];
    if (tvId !== state.tvId || !state.pairedAt) return Promise.resolve(json(404, { error: 'not found' }));

    return manifest().then(function (apps) {
      settleDeliveries(state, apps);
      saveState(state);

      if (what === 'apps' && method === 'GET') {
        var list = apps.filter(function (a) { return state.delivered[a.appId]; })
          .map(function (a) { return { appId: a.appId, title: a.title, deliveredAt: state.delivered[a.appId] }; })
          .sort(function (a, b) { return b.deliveredAt - a.deliveredAt; });
        return json(200, { apps: list });
      }
      if (what === 'events' && method === 'GET') {
        var since = Number(url.searchParams.get('since') || 0);
        return json(200, { events: state.events.filter(function (e) { return e.at > since; }), now: Date.now() });
      }
      if (what === 'launch' && method === 'POST') {
        var appId = body && body.appId;
        if (!appId || !state.delivered[appId] || !/^app_[0-9a-f]{12}$/.test(appId)) return json(404, { error: 'app not delivered to this tv' });
        return json(200, { url: FILE_MODE ? BASE + 'offline/apps/' + appId + '.html' : '/sandbox?t=' + encodeURIComponent(appId) });
      }
      return json(404, { error: 'not found' });
    });
  }

  function apiPath(url) { return url.pathname; }
  function isApiCall(url) {
    if (url.pathname.indexOf('/v1/') !== 0) return false;
    return FILE_MODE ? url.protocol === 'file:' : url.origin === location.origin;
  }

  var realFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    var req = (typeof input === 'string') ? null : input;
    var url = new URL(req ? req.url : String(input), location.href);
    var method = ((init && init.method) || (req && req.method) || 'GET').toUpperCase();
    if (!isApiCall(url)) {
      return realFetch(input, init);
    }
    var body = null;
    try { body = init && init.body ? JSON.parse(init.body) : null; } catch (e) { body = null; }
    return handle(method, url, body);
  };

  window.__ptvOffline = true;
  console.log('[offline-backend] active: Player API answered in-page, no network');
})();
