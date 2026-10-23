// Only the authenticated mCrew site has this bridge; no cookies leave Chrome.
const channel = 'mcrew-chrome-v2';
window.addEventListener('message', async event => {
  if (event.source !== window || event.origin !== location.origin) return;
  const data = event.data;
  if (data?.channel !== channel || data.direction !== 'request' || typeof data.id !== 'string' || data.id.length > 100) return;
  if (!['app-status', 'app-start'].includes(data.type)) return;
  try {
    const result = await chrome.runtime.sendMessage({ type: data.type,
      ...(data.type === 'app-start' ? { token: data.token, target: data.target } : {}) });
    window.postMessage({ channel, direction: 'response', id: data.id, result }, location.origin);
  } catch {
    window.postMessage({ channel, direction: 'response', id: data.id, result: { error: '擴充套件已更新，請重新整理此頁。' } }, location.origin);
  }
});
