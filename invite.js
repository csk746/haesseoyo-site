/** Accept the short numeric code and legacy invitations; never render untrusted URL text. */
export function parseInviteCode(search) {
  const values = new URLSearchParams(search).getAll('code');
  return values.length === 1 && /^(?:[0-9]{6}|[a-f0-9]{12})$/i.test(values[0]) ? values[0].toLowerCase() : null;
}

export function storeUrl(value, platform) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.hash) return null;
    if (platform === 'android' && url.hostname === 'play.google.com' && url.pathname === '/store/apps/details' &&
        url.searchParams.getAll('id').length === 1 && url.searchParams.get('id') === 'com.kyeot.haesseoyo') return url.href;
    if (platform === 'ios' && url.hostname === 'apps.apple.com' &&
        /^\/[a-z]{2}\/app\/(?:[^/]+\/)?id6806529896\/?$/i.test(url.pathname) && !url.search) return url.href;
  } catch { /* Unconfigured or invalid destinations remain visibly unavailable. */ }
  return null;
}

export function renderDownloads(document, configuration) {
  for (const platform of ['android', 'ios']) {
    const anchor = document.getElementById(`download-${platform}`);
    const unavailable = document.getElementById(`${platform}-unavailable`);
    const url = storeUrl(configuration?.[platform], platform);
    anchor.hidden = !url;
    unavailable.hidden = Boolean(url);
    if (url) anchor.href = url;
    else {
      anchor.removeAttribute('href');
      unavailable.lastElementChild.textContent = platform === 'android' ? 'Android 다운로드 준비 중' : 'App Store 다운로드 준비 중';
    }
  }
}

export function renderInvite(document, search) {
  const code = parseInviteCode(search);
  const output = document.getElementById('invite-code');
  const copy = document.getElementById('copy-code');
  const open = document.getElementById('open-app');
  const note = document.getElementById('open-note');
  const status = document.getElementById('invite-status');
  document.body.classList.toggle('invalid-invite', !code);
  output.textContent = code ?? '코드 확인 필요';
  copy.disabled = !code;
  open.hidden = !code;
  note.hidden = !code;
  if (code) {
    open.href = `haesseoyo://invite?code=${code}`;
    status.textContent = code.length === 6 ? '가족에게 받은 6자리 초대 코드예요.' : '이 초대 링크에 연결된 코드예요. 앱에서 바로 참여할 수 있어요.';
  } else {
    open.removeAttribute('href');
    document.getElementById('page-title').textContent = '초대 링크를 다시 확인해 주세요';
    document.getElementById('intro').textContent = '초대 코드가 없거나 올바르지 않아요. 가족에게 새 초대 링크를 받아주세요.';
    status.textContent = '올바른 초대 링크로 다시 열어주세요.';
  }
  return code;
}

export async function copyInvite(code, document, browser = window) {
  if (!code) return false;
  const status = document.getElementById('invite-status');
  try {
    await browser.navigator.clipboard.writeText(code);
    document.getElementById('copy-code').textContent = '복사했어요';
    status.textContent = '앱의 초대 코드 입력란에 붙여넣어 주세요.';
    return true;
  } catch {
    // Clipboard permission is optional: selecting the code keeps a manual path available.
    const output = document.getElementById('invite-code');
    output.focus();
    const selection = browser.getSelection?.();
    const range = document.createRange();
    range.selectNodeContents(output);
    selection?.removeAllRanges();
    selection?.addRange(range);
    status.textContent = '코드를 길게 누르거나 선택한 뒤 복사해 주세요.';
    return false;
  }
}

export async function initialize(document, browser) {
  const code = renderInvite(document, browser.location.search);
  document.getElementById('copy-code').addEventListener('click', () => void copyInvite(code, document, browser));
  try {
    // A local static config is the only request; the invitation is never included in it.
    const response = await browser.fetch('./downloads.json', { credentials: 'omit', referrerPolicy: 'no-referrer' });
    if (!response.ok) throw new Error('unavailable');
    renderDownloads(document, await response.json());
  } catch {
    renderDownloads(document, null);
    document.getElementById('download-status').textContent = '스토어 연결을 불러오지 못했어요. 잠시 후 다시 열어주세요.';
  }
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') void initialize(document, window);
