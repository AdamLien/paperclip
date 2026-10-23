let sharing = null;
let pairing = false;
let generation = 0;
const origins = ['https://crew.metabiz.work', 'https://crew-uat.metabiz.work'];
const send = (tabId, method, params = {}) => chrome.debugger.sendCommand({ tabId }, method, params);
async function stop() {
  const revision = ++generation;
  const previous = sharing; sharing = null;
  if (previous) await chrome.debugger.detach({ tabId: previous.tabId }).catch(() => {});
  await chrome.action.setBadgeText({ text: '' });
  return revision;
}
chrome.debugger.onDetach.addListener(source => { if (source.tabId === sharing?.tabId) void stop(); });
chrome.tabs.onRemoved.addListener(tabId => { if (tabId === sharing?.tabId) void stop(); });
async function page(tabId) {
  const result = await send(tabId, 'Runtime.evaluate', { expression: 'JSON.stringify({url:location.href,title:document.title.slice(0,200),width:innerWidth,height:innerHeight,text:document.body.innerText.slice(0,45000)})', returnByValue: true });
  return JSON.parse(result.result.value);
}
async function execute(tabId, command) {
  const tab = await chrome.tabs.get(tabId);
  if (!/^https?:\/\//.test(tab.url ?? '')) throw new Error('只能操作已分享的網站分頁');
  switch (command.action) {
    case 'snapshot': {
      const state = await page(tabId);
      const controls = await send(tabId, 'Runtime.evaluate', { expression: 'JSON.stringify(Array.from(document.querySelectorAll("a,button,input,textarea,select,[role=button]")).map(el=>{const r=el.getBoundingClientRect();return {label:(el.getAttribute("aria-label")||el.innerText||el.getAttribute("placeholder")||el.tagName).slice(0,150),x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2),visible:r.width>0&&r.height>0&&r.x>=0&&r.y>=0&&r.right<=innerWidth&&r.bottom<=innerHeight}}).filter(x=>x.visible).slice(0,100))', returnByValue: true });
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
  while (sharing === session) {
    try {
      const state = await page(session.tabId);
      if (!/^https?:\/\//.test(state.url)) throw new Error('分頁已離開網站');
      const capture = await send(session.tabId, 'Page.captureScreenshot', { format: 'jpeg', quality: 45, captureBeyondViewport: false });
      if (sharing !== session) break;
      const frame = `data:image/jpeg;base64,${capture.data}`;
      const response = await fetch(`${session.origin}/api/browser-workspace/relay`, {
        method: 'POST', credentials: 'omit', redirect: 'error',
        headers: { 'Content-Type': 'application/json', 'X-Crew-Browser-Pairing': session.token },
        body: JSON.stringify({ url: state.url.slice(0,2048), title: state.title, width: state.width, height: state.height,
          ...(frame.length <= 1500000 ? { frame } : {}), ...(result ? { result } : {}) }),
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
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || !sender.url?.endsWith('/popup.html')) return;
  if (message.type === 'stop') { void stop().then(() => respond({})); return true; }
  if (message.type !== 'share') return;
  if (pairing) { respond({ error: '正在配對，請稍候。' }); return; }
  pairing = true;
  void (async () => {
    if (!origins.includes(message.origin) || !/^[a-f0-9]{64}$/.test(message.token)) throw new Error('配對碼或環境不正確');
    const tab = await chrome.tabs.get(message.tabId);
    if (!/^https?:\/\//.test(tab.url ?? '')) throw new Error('請先開啟要分享的網站');
    const revision = await stop(); await chrome.debugger.attach({ tabId: message.tabId }, '1.3');
    if (generation !== revision) { await chrome.debugger.detach({ tabId: message.tabId }).catch(() => {}); throw new Error('配對已取消'); }
    const session = { tabId: message.tabId, origin: message.origin, token: message.token };
    sharing = session; await chrome.action.setBadgeText({ text: '分享中' });
    void loop(session); respond({});
  })().catch(error => respond({ error: error.message })).finally(() => { pairing = false; });
  return true;
});
