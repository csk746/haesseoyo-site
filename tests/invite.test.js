import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseInviteCode, storeUrl, renderInvite, renderDownloads, copyInvite, initialize } from '../invite.js';

function fixture() {
  const nodes = new Map();
  const document = {
    body: { classList: { toggle: () => {} } },
    getElementById: (id) => {
      if (!nodes.has(id)) nodes.set(id, { textContent: '', hidden: false, href: undefined, disabled: false,
        lastElementChild: { textContent: '' }, focus() { this.focused = true; },
        removeAttribute(name) { delete this[name]; }, addEventListener(name, callback) { this[name] = callback; } });
      return nodes.get(id);
    },
    createRange: () => ({ selectNodeContents: () => {} }),
  };
  return { document, get: document.getElementById };
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
  await initialize(document, { location: { search: '?code=a1b2c3d4e5f6' }, fetch: async (...args) => {
    calls.push(args); return { ok: true, json: async () => ({}) };
  } });
  assert.deepEqual(calls, [['./downloads.json', { credentials: 'omit', referrerPolicy: 'no-referrer' }]]);
});

test('page has local assets, referrer protection, manual installation fallback, and no analytics', async () => {
  const html = await readFile(new URL('../invite.html', import.meta.url), 'utf8');
  const js = await readFile(new URL('../invite.js', import.meta.url), 'utf8');
  assert.match(html, /name="referrer" content="no-referrer"/);
  assert.match(html, /설정 → 가족 스페이스에 합류/);
  assert.match(html, /받은 초대 링크를 다시 열어/);
  assert.doesNotMatch(html, /(?:src|href)="https?:/);
  assert.doesNotMatch(js, /innerHTML|console\.|sendBeacon|localStorage|sessionStorage|document\.cookie|location\.(?:assign|replace)|setTimeout/);
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
