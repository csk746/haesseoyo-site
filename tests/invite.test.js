import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseInviteCode, storeUrl, renderInvite, renderDownloads, copyInvite, initialize, mobilePlatform, appOpenUrl, prepareHandoff } from '../invite.js';

function fixture() {
  const nodes = new Map();
  const listeners = new Map();
  const document = {
    visibilityState: 'visible',
    addEventListener: (event, callback) => { if (!listeners.has(event)) listeners.set(event, []); listeners.get(event).push(callback); },
    removeEventListener: (event, callback) => { listeners.set(event, (listeners.get(event) ?? []).filter((item) => item !== callback)); },
    body: { classList: { toggle: () => {} } },
    getElementById: (id) => {
      if (!nodes.has(id)) nodes.set(id, { textContent: '', hidden: false, href: undefined, disabled: false,
        lastElementChild: { textContent: '' }, focus() { this.focused = true; },
        removeAttribute(name) { delete this[name]; }, addEventListener(name, callback) { this[name] = callback; } });
      return nodes.get(id);
    },
    createRange: () => ({ selectNodeContents: () => {} }),
  };
  return { document, get: document.getElementById, emit: (event) => { for (const callback of listeners.get(event) ?? []) callback(); } };
}

test('accepts exactly one six-digit or legacy twelve-hex invite and preserves leading zeros', () => {
  assert.equal(parseInviteCode('?code=001234'), '001234');
  assert.equal(parseInviteCode('?code=987654'), '987654');
  assert.equal(parseInviteCode('?code=a1b2c3d4e5f6'), 'a1b2c3d4e5f6');
  assert.equal(parseInviteCode('?code=A1B2C3D4E5F6'), 'a1b2c3d4e5f6');
  for (const search of ['', '?code=', '?code=12345', '?code=1234567', '?code=ABCDEF', '?code=12a456', '?code=１２３４５６', '?code=123456&code=123456', '?code=12345678', '?code=123456789abcd', '?code=gggggggggggg', '?code=123456789abc&code=123456789abc', '?code=%3Cscript%3E', '?code=%20123456789abc', '?code=123456789abc%0A']) {
    assert.equal(parseInviteCode(search), null, search);
  }
});

test('renders only validated code and an explicit app link, never automatic navigation', () => {
  const { document, get } = fixture();
  assert.equal(renderInvite(document, '?code=A1B2C3D4E5F6'), 'a1b2c3d4e5f6');
  assert.equal(get('invite-code').textContent, 'a1b2c3d4e5f6');
  assert.equal(get('open-app').href, 'haesseoyo://invite?code=a1b2c3d4e5f6');
  assert.equal(get('copy-code').disabled, false);
  assert.equal(renderInvite(document, '?code=%3Cimg%20src=x%3E'), null);
  assert.equal(get('invite-code').textContent, '코드 확인 필요');
  assert.equal(get('open-app').href, undefined);
  assert.equal(get('open-app').hidden, true);
});

test('only verified public stores for this app may be configured', async () => {
  const configuration = JSON.parse(await readFile(new URL('../downloads.json', import.meta.url), 'utf8'));
  assert.equal(storeUrl(configuration.android, 'android'), configuration.android);
  assert.equal(storeUrl(configuration.ios, 'ios'), configuration.ios);
  for (const value of ['javascript:alert(1)', 'https://example.com/app.apk', 'https://play.google.com/store/apps/details?id=other.app', 'https://user:pass@play.google.com/store/apps/details?id=com.kyeot.haesseoyo', 'https://apps.apple.com/kr/app/id123', null]) {
    assert.equal(storeUrl(value, 'android'), null);
    assert.equal(storeUrl(value, 'ios'), null);
  }
});

test('missing platform is visibly unavailable without a placeholder destination', () => {
  const { document, get } = fixture();
  renderDownloads(document, { android: 'https://play.google.com/store/apps/details?id=com.kyeot.haesseoyo', ios: null });
  assert.equal(get('download-android').hidden, false);
  assert.equal(get('android-unavailable').hidden, true);
  assert.equal(get('download-ios').hidden, true);
  assert.equal(get('download-ios').href, undefined);
  assert.equal(get('ios-unavailable').lastElementChild.textContent, 'App Store 다운로드 준비 중');
});

test('copy success and denied clipboard both keep clear manual instructions', async () => {
  const { document, get } = fixture();
  let copied;
  assert.equal(await copyInvite('a1b2c3d4e5f6', document, { navigator: { clipboard: { writeText: async (text) => { copied = text; } } } }), true);
  assert.equal(copied, 'a1b2c3d4e5f6');
  assert.equal(await copyInvite('a1b2c3d4e5f6', document, { navigator: {} }), false);
  assert.equal(get('invite-code').focused, true);
  assert.match(get('invite-status').textContent, /길게/);
});

test('initialization requests local configuration without code, credentials, or referrer', async () => {
  const { document } = fixture();
  const calls = [];
  await initialize(document, { addEventListener() {}, location: { search: '?code=a1b2c3d4e5f6' }, fetch: async (...args) => {
    calls.push(args); return { ok: true, json: async () => ({}) };
  } });
  assert.deepEqual(calls, [['./downloads.json', { credentials: 'omit', referrerPolicy: 'no-referrer' }]]);
});

test('page has local assets, referrer protection, manual installation fallback, and no analytics', async () => {
  const html = await readFile(new URL('../invite.html', import.meta.url), 'utf8');
  const js = await readFile(new URL('../invite.js', import.meta.url), 'utf8');
  assert.match(html, /name="referrer" content="no-referrer"/);
  assert.match(html, /설정 → 초대 코드 입력/);
  assert.match(html, /받은 초대 링크를 다시 열어/);
  assert.doesNotMatch(html, /(?:src|href)="https?:/);
  assert.doesNotMatch(js, /innerHTML|console\.|sendBeacon|localStorage|sessionStorage|document\.cookie/);
});


test('six-digit invitations keep the manual fallback and app target consistent without navigation', async () => {
  const { document, get } = fixture();
  assert.equal(renderInvite(document, '?code=001234'), '001234');
  assert.equal(get('invite-code').textContent, '001234');
  assert.equal(get('open-app').href, 'haesseoyo://invite?code=001234');
  assert.match(get('invite-status').textContent, /6자리/);
  let copied;
  await copyInvite('001234', document, { navigator: { clipboard: { writeText: async (value) => { copied = value; } } } });
  assert.equal(copied, '001234');
});


const stores = {
  android: 'https://play.google.com/store/apps/details?id=com.kyeot.haesseoyo',
  ios: 'https://apps.apple.com/kr/app/id6806529896',
};
function mobileFixture(platform = 'ios', state = 'visible') {
  const f = fixture(); f.document.visibilityState = state;
  let now = 1000; let timerId = 0;
  const timers = new Map(); const events = new Map(); const visits = [];
  const browser = {
    navigator: { userAgent: platform === 'android' ? 'Mozilla Android KAKAOTALK' : platform === 'ios' ? 'Mozilla iPhone KAKAOTALK' : 'Mozilla MacIntel' },
    Date: { now: () => now },
    setTimeout: (callback, delay) => { const id = ++timerId; timers.set(id, { callback, delay }); return id; },
    clearTimeout: (id) => timers.delete(id),
    addEventListener: (name, callback) => events.set(name, callback),
    location: { assign: (url) => visits.push(['app', url]), replace: (url) => visits.push(['store', url]) },
  };
  return { ...f, browser, visits, timers,
    tick: (ms = 2200) => { now += ms; const pending = [...timers.values()]; timers.clear(); pending.forEach((timer) => timer.callback()); },
    pagehide: () => events.get('pagehide')?.(),
  };
}

test('platform routing distinguishes Android, iOS, desktop-mode iPad, desktop, and preview bots', () => {
  assert.equal(mobilePlatform({ userAgent: 'Android KAKAOTALK' }), 'android');
  assert.equal(mobilePlatform({ userAgent: 'iPhone Safari' }), 'ios');
  assert.equal(mobilePlatform({ userAgent: 'Macintosh Safari', platform: 'MacIntel', maxTouchPoints: 5 }), 'ios');
  assert.equal(mobilePlatform({ userAgent: 'Macintosh Safari', platform: 'MacIntel', maxTouchPoints: 0 }), null);
  assert.equal(mobilePlatform({ userAgent: 'Android KakaoTalkScrap' }), null);
});

test('Android app attempt uses the intended package and encoded verified Play fallback only', () => {
  const url = appOpenUrl('001234', 'android', stores);
  assert.equal(url, `intent://invite?code=001234#Intent;scheme=haesseoyo;package=com.kyeot.haesseoyo;S.browser_fallback_url=${encodeURIComponent(stores.android)};end`);
  assert.equal(appOpenUrl('123456;package=bad', 'android', stores), null);
  assert.equal(appOpenUrl('001234', 'android', { android: 'https://evil.example' }), 'haesseoyo://invite?code=001234');
  assert.equal(appOpenUrl('ABCDEF123456', 'ios', stores), 'haesseoyo://invite?code=abcdef123456');
});

test('valid mobile invitations attempt the app once and automatically fall back to the correct store', () => {
  for (const platform of ['android', 'ios']) {
    const f = mobileFixture(platform);
    prepareHandoff('001234', f.document, f.browser, stores);
    assert.deepEqual(f.visits, [['app', appOpenUrl('001234', platform, stores)]]);
    f.tick();
    assert.deepEqual(f.visits[1], ['store', stores[platform]]);
    assert.equal(f.visits[1][1].includes('001234'), false);
    f.tick(); assert.equal(f.visits.length, 2);
  }
});

test('app opening, page leaving, and returning never trigger a delayed store redirect', () => {
  for (const signal of ['hidden', 'pagehide', 'late']) {
    const f = mobileFixture();
    prepareHandoff('abcdef123456', f.document, f.browser, stores);
    if (signal === 'hidden') { f.document.visibilityState = 'hidden'; f.emit('visibilitychange'); f.document.visibilityState = 'visible'; f.emit('visibilitychange'); }
    if (signal === 'pagehide') f.pagehide();
    f.tick(signal === 'late' ? 6000 : 2200);
    assert.equal(f.visits.length, 1, signal);
  }
});

test('desktop, hidden pages, invalid codes, and missing store config do not automatically navigate', () => {
  for (const [platform, visibility, code, config] of [
    ['desktop', 'visible', '001234', stores], ['ios', 'hidden', '001234', stores],
    ['android', 'visible', 'invalid', stores], ['ios', 'visible', '001234', null],
  ]) {
    const f = mobileFixture(platform, visibility);
    prepareHandoff(code, f.document, f.browser, config);
    f.tick(); assert.equal(f.visits.length, 0);
  }
});

test('choosing manual fallback cancels automatic redirection and the app button still retries deliberately', () => {
  const f = mobileFixture();
  prepareHandoff('001234', f.document, f.browser, stores);
  f.emit('pointerdown'); f.tick(); assert.equal(f.visits.length, 1);
  let prevented = false;
  f.get('open-app').click({ preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true); assert.equal(f.visits.length, 2);
  f.emit('keydown'); f.tick(); assert.equal(f.visits.length, 2);
});

test('an embedded browser refusing app navigation falls back only to the verified store', () => {
  const f = mobileFixture();
  f.browser.location.assign = () => { throw new Error('scheme blocked'); };
  prepareHandoff('001234', f.document, f.browser, stores);
  assert.deepEqual(f.visits, [['store', stores.ios]]);
  assert.equal(f.timers.size, 0);
});


test('slow configuration never overrides someone already using the manual fallback', async () => {
  const f = mobileFixture('android');
  f.browser.location.search = '?code=001234';
  let resolveConfig;
  f.browser.fetch = () => new Promise((resolve) => { resolveConfig = resolve; });
  const ready = initialize(f.document, f.browser);
  f.emit('pointerdown');
  resolveConfig({ ok: true, json: async () => stores });
  await ready;
  f.tick();
  assert.deepEqual(f.visits, []);
  f.get('open-app').click({ preventDefault() {} });
  assert.deepEqual(f.visits, [['app', appOpenUrl('001234', 'android', stores)]]);
});
