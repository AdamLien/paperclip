let sharing = null;
let pairing = false;
let generation = 0;
let selectedTab = null;
const workspacePaths = new Map();
const origins = ['https://crew.metabiz.work', 'https://crew-uat.metabiz.work'];
const send = (tabId, method, params = {}) => chrome.debugger.sendCommand({ tabId }, method, params);
async function stop() {
  const revision = ++generation;
  const previous = sharing; sharing = null;
  if (previous) {
    await chrome.debugger.detach({ tabId: previous.tabId }).catch(() => {});
    await fetch(`${previous.origin}/api/browser-workspace/relay`, { method: 'DELETE', credentials: 'omit', redirect: 'error', headers: { 'X-Crew-Browser-Pairing': previous.token }, signal: AbortSignal.timeout(3000) }).catch(() => {});
  }
  await chrome.action.setBadgeText({ text: '' });
  return revision;
}
chrome.debugger.onDetach.addListener(source => { if (source.tabId === sharing?.tabId) void stop(); });
chrome.tabs.onRemoved.addListener(tabId => { if (tabId === sharing?.tabId) void stop(); });
async function page(tabId) {
  const result = await send(tabId, 'Runtime.evaluate', { expression: 'JSON.stringify({url:location.href,title:document.title.slice(0,200),width:innerWidth,height:innerHeight,text:(document.body?.innerText??"").slice(0,45000)})', returnByValue: true });
  if (typeof result.result?.value !== 'string') throw new Error('工作分頁內容尚未就緒，請重新啟動。');
  return JSON.parse(result.result.value);
}
async function execute(tabId, command) {
  if (!/^https?:\/\//.test((await page(tabId)).url)) throw new Error('只能操作已分享的網站分頁');
  switch (command.action) {
    case 'snapshot': {
      const state = await page(tabId);
      const controls = await send(tabId, 'Runtime.evaluate', { expression: 'JSON.stringify(Array.from(document.querySelectorAll("a,button,input,textarea,select,[role=button]")).map(el=>{const r=el.getBoundingClientRect();const sensitive=el.type==="password"||/password|cc-|one-time-code/i.test(el.autocomplete||"");return {label:(el.getAttribute("aria-label")||el.labels?.[0]?.innerText||el.innerText||el.getAttribute("placeholder")||el.tagName).slice(0,150),...(!sensitive&&["INPUT","TEXTAREA","SELECT"].includes(el.tagName)?{value:String(el.value||"").slice(0,1000)}:{}),...(["checkbox","radio"].includes(el.type)?{checked:el.checked}:{}),x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2),visible:r.width>0&&r.height>0&&r.x>=0&&r.y>=0&&r.right<=innerWidth&&r.bottom<=innerHeight}}).filter(x=>x.visible).slice(0,100))', returnByValue: true });
      return JSON.stringify({ ...state, controls: JSON.parse(controls.result.value) }).slice(0,50000);
    }
    case 'navigate': {
      const url = new URL(command.url);
      if (url.protocol !== 'https:' || url.username || url.password) throw new Error('網址必須使用 HTTPS');
      await chrome.tabs.update(tabId, { url: url.href }); return '已導向指定網址';
    }
    case 'click':
      await send(tabId, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: command.x, y: command.y, button: 'left', clickCount: 1 });
      await send(tabId, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: command.x, y: command.y, button: 'left', clickCount: 1 }); return '已點選';
    case 'type': await send(tabId, 'Input.insertText', { text: command.text }); return '已輸入文字';
    case 'key':
      const keyCode = { Enter: 13, Tab: 9, Escape: 27, Backspace: 8, ArrowDown: 40, ArrowUp: 38, ArrowLeft: 37, ArrowRight: 39 }[command.key];
      if (!keyCode) throw new Error('不支援的按鍵');
      await send(tabId, 'Input.dispatchKeyEvent', { type: 'keyDown', key: command.key, code: command.key, windowsVirtualKeyCode: keyCode, ...(command.key === 'Enter' ? { text: '\r' } : {}) });
      await send(tabId, 'Input.dispatchKeyEvent', { type: 'keyUp', key: command.key, code: command.key, windowsVirtualKeyCode: keyCode }); return '已送出按鍵';
    case 'scroll': await send(tabId, 'Input.dispatchMouseEvent', { type: 'mouseWheel', x: 50, y: 50, deltaX: 0, deltaY: command.deltaY }); return '已捲動';
    default: throw new Error('不支援的操作');
  }
}
async function loop(session) {
  let result;
  let capturing = false;
  let pendingFrame;
  while (sharing === session) {
    try {
      const state = await page(session.tabId);
      if (!/^https?:\/\//.test(state.url)) throw new Error('分頁已離開網站');
      // A background tab's compositor can stall. Keep relay/commands alive
      // independently, with at most one capture in flight and no action retries.
      if (!capturing) {
        capturing = true;
        void send(session.tabId, 'Page.captureScreenshot', { format: 'jpeg', quality: 45, captureBeyondViewport: false })
          .then(capture => {
            const frame = `data:image/jpeg;base64,${capture.data}`;
            if (sharing === session && frame.length <= 1500000) pendingFrame = { url: state.url, frame };
          })
          .catch(() => { if (sharing === session) void stop(); })
          .finally(() => { capturing = false; });
      }
      if (sharing !== session) break;
      const frame = pendingFrame?.url === state.url ? pendingFrame.frame : undefined;
      pendingFrame = undefined;
      const response = await fetch(`${session.origin}/api/browser-workspace/relay`, {
        method: 'POST', credentials: 'omit', redirect: 'error',
        headers: { 'Content-Type': 'application/json', 'X-Crew-Browser-Pairing': session.token },
        body: JSON.stringify({ url: state.url.slice(0,2048), title: state.title, width: state.width, height: state.height,
          ...(frame ? { frame } : {}), ...(result ? { result } : {}) }),
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) throw new Error('分享已停止或配對失效');
      const data = await response.json(); result = undefined;
      if (sharing !== session) break;
      if (data.command) {
        try { result = { id: data.command.id, text: (await execute(session.tabId, data.command)).slice(0,50000) }; }
        catch { result = { id: data.command.id, error: '分頁操作失敗，請檢查 Chrome 分頁。' }; }
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch { if (sharing === session) await stop(); break; }
  }
}
async function share(tabId, origin, token, created = false) {
  if (!origins.includes(origin) || !/^[a-f0-9]{64}$/.test(token ?? '')) throw new Error('配對碼或環境不正確');
  if (pairing) throw new Error('正在啟動，請稍候。');
  pairing = true;
  try {
    const tab = await chrome.tabs.get(tabId);
    // activeTab is granted by the popup for existing tabs. A newly-created tab
    // has no such grant: validate its URL through our own debugger attachment.
    if (!created && !/^https?:\/\//.test(tab.url ?? '')) throw new Error('請先開啟要分享的網站');
    const revision = await stop(); await chrome.debugger.attach({ tabId }, '1.3');
    if (generation !== revision) { await chrome.debugger.detach({ tabId }).catch(() => {}); throw new Error('啟動已取消'); }
    try {
      let ready = false;
      for (let i = 0; i < 40; i++) {
        if (/^https?:\/\//.test((await page(tabId)).url)) { ready = true; break; }
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      if (!ready) throw new Error('工作分頁載入逾時，請重新啟動。');
    } catch (error) { await chrome.debugger.detach({ tabId }).catch(() => {}); throw error; }
    if (generation !== revision) { await chrome.debugger.detach({ tabId }).catch(() => {}); throw new Error('啟動已取消'); }
    const session = { tabId, origin, token };
    sharing = session; await chrome.action.setBadgeText({ text: '分享中' });
    void loop(session);
  } finally { pairing = false; }
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id) return;
  const popup = sender.url === `chrome-extension://${chrome.runtime.id}/popup.html`;
  let origin;
  try { origin = new URL(sender.url).origin; } catch { return; }
  const app = !popup && sender.frameId === 0 && origins.includes(origin)
    && sender.tab && new URL(sender.tab.url).origin === origin;
  if (!popup && !app) return;
  if (app) {
    const path = new URL(sender.url).pathname;
    if (/^\/[A-Za-z0-9_-]+\/browser\/?$/.test(path)) workspacePaths.set(origin, path.replace(/\/$/, ''));
  }
  void (async () => {
    if (popup && message.type === 'stop') { await stop(); return {}; }
    if (popup && message.type === 'select-tab') {
      const tab = await chrome.tabs.get(message.tabId);
      if (!/^https?:\/\//.test(tab.url ?? '') || !origins.includes(message.origin)) throw new Error('請選擇網站分頁');
      const workspacePath = workspacePaths.get(message.origin);
      if (!workspacePath) throw new Error('請先在 Chrome 開啟 mCrew 的瀏覽器頁，再交接分頁。');
      selectedTab = { id: tab.id, origin: message.origin };
      await chrome.tabs.create({ url: `${message.origin}${workspacePath}?share=1` });
      return {};
    }
    // Manual pairing remains a fallback for older clients.
    if (popup && message.type === 'share') { await share(message.tabId, message.origin, message.token); return {}; }
    if (app && message.type === 'app-status') {
      let target = null;
      if (selectedTab?.origin === origin) {
        try { const tab = await chrome.tabs.get(selectedTab.id); target = { title: tab.title ?? '', url: tab.url ?? '' }; }
        catch { selectedTab = null; }
      }
      return { version: 2, target };
    }
    if (app && message.type === 'app-start') {
      if (!/^[a-f0-9]{64}$/.test(message.token ?? '')) throw new Error('工作授權已失效，請重新啟動。');
      if (!['new', 'selected'].includes(message.target)) throw new Error('不支援的啟動方式');
      if (message.target === 'selected' && selectedTab?.origin !== origin) throw new Error('請先在擴充套件選擇分頁');
      const tabId = message.target === 'selected' ? selectedTab.id : (await chrome.tabs.create({ url: 'https://example.com', active: false })).id;
      try {
        await share(tabId, origin, message.token, message.target === 'new');
      } catch (error) {
        if (message.target === 'new') await chrome.tabs.remove(tabId).catch(() => {});
        throw error;
      }
      if (message.target === 'selected') selectedTab = null;
      return { started: true };
    }
    throw new Error('不支援的操作');
  })().then(respond).catch(error => respond({ error: error.message }));
  return true;
});
