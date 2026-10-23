import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { test } from 'node:test';
import assert from 'node:assert/strict';

async function fixture(response = { command: null }) {
  const calls = []; const listeners = {}; const requests = [];
  const context = vm.createContext({ URL, JSON, AbortSignal, setTimeout: () => {},
    fetch: async (url, options) => { requests.push({ url, options }); return { ok: true, json: async () => response }; },
    chrome: {
      runtime: { id: 'companion', onMessage: { addListener: fn => { listeners.message = fn; } } },
      debugger: { onDetach: { addListener: fn => { listeners.detach = fn; } },
        attach: async target => calls.push(['attach', target]), detach: async target => calls.push(['detach', target]),
        sendCommand: async (target, method, params) => {
          calls.push([method, target, params]);
          if (method === 'Runtime.evaluate') return { result: { value: JSON.stringify({ url: 'https://example.com', title: 'Example', width: 800, height: 600, text: 'Example' }) } };
          if (method === 'Page.captureScreenshot') return { data: 'YWJj' };
          return {};
        } },
      tabs: { create: async value => { calls.push(['create', value]); return { id: 9, ...value }; }, onRemoved: { addListener: fn => { listeners.removed = fn; } }, get: async id => ({ id, url: 'https://example.com' }), update: async (id, value) => calls.push(['update', { tabId: id }, value]) },
      action: { setBadgeText: async () => {} },
    },
  });
  vm.runInContext(await readFile(new URL('./worker.js', import.meta.url), 'utf8'), context);
  const sender = { id: 'companion', url: 'chrome-extension://companion/popup.html' };
  async function message(body, source = sender) {
    let result; listeners.message(body, source, value => { result = value; });
    for (let i = 0; i < 30; i++) await new Promise(resolve => setImmediate(resolve));
    return result;
  }
  const share = () => message({ type: 'share', tabId: 7, token: 'a'.repeat(64), origin: 'https://crew.metabiz.work' });
  return { calls, listeners, requests, message, share, context };
}
test('shares only the explicitly chosen tab; sends no browser cookies and detaches on stop', async () => {
  const f = await fixture(); assert.equal(JSON.stringify(await f.share()), '{}');
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].url, 'https://crew.metabiz.work/api/browser-workspace/relay');
  assert.equal(f.requests[0].options.credentials, 'omit');
  assert.equal(f.requests[0].options.redirect, 'error');
  assert.equal(f.requests[0].options.headers['X-Crew-Browser-Pairing'], 'a'.repeat(64));
  assert.ok(f.calls.every(([, target]) => target.tabId === 7));
  await f.message({ type: 'stop' });
  assert.equal(f.calls.at(-1)[0], 'detach');
  assert.equal(vm.runInContext('sharing', f.context), null);
});
test('ignores messages from websites and refuses unapproved relay origins', async () => {
  const f = await fixture();
  await f.message({ type: 'share', tabId: 8 }, { id: 'other', url: 'https://example.com/popup.html' });
  assert.equal(f.calls.length, 0);
  const result = await f.message({ type: 'share', tabId: 7, token: 'a'.repeat(64), origin: 'https://attacker.example' });
  assert.ok(result.error); assert.equal(f.requests.length, 0);
});
test('executes a command on the shared tab exactly once', async () => {
  const f = await fixture({ command: { id: 'command', action: 'click', x: 12, y: 34 } });
  await f.share();
  assert.equal(f.calls.filter(([method]) => method === 'Input.dispatchMouseEvent').length, 2);
  assert.equal(f.requests.length, 1);
});
test('stops and detaches on relay failure without retry', async () => {
  const f = await fixture(); vm.runInContext('fetch = async () => { throw new Error("offline") }', f.context);
  await f.share();
  assert.equal(vm.runInContext('sharing', f.context), null);
  assert.equal(f.calls.at(-1)[0], 'detach');
});
test('manual Chrome detach revokes the local session', async () => {
  const f = await fixture(); await f.share(); f.listeners.detach({ tabId: 7 });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(vm.runInContext('sharing', f.context), null);
});

const appSender = { id: 'companion', frameId: 0, url: 'https://crew.metabiz.work/META/browser', tab: { id: 3, url: 'https://crew.metabiz.work/META/browser' } };
test('logged-in app starts a fresh Agent tab without copying a pairing code', async () => {
  const f = await fixture();
  const result = await f.message({ type: 'app-start', token: 'a'.repeat(64), target: 'new' }, appSender);
  assert.equal(result.started, true);
  assert.equal(f.calls.find(([name]) => name === 'create')[1].url, 'https://example.com');
  assert.equal(f.calls.find(([name]) => name === 'attach')[1].tabId, 9);
  assert.equal(f.requests.length, 1);
});
test('app cannot select arbitrary existing tabs or use another environment selection', async () => {
  const f = await fixture();
  assert.ok((await f.message({ type: 'app-start', token: 'a'.repeat(64), target: 'selected', tabId: 99 }, appSender)).error);
  await f.message({ type: 'select-tab', tabId: 7, origin: 'https://crew-uat.metabiz.work' });
  assert.ok((await f.message({ type: 'app-start', token: 'a'.repeat(64), target: 'selected' }, appSender)).error);
  assert.equal(f.calls.filter(([name])=>name==='attach').length,0);
});
test('popup-selected tab can be handed to the app once without a code', async () => {
  const f = await fixture();
  await f.message({ type: 'select-tab', tabId: 7, origin: 'https://crew.metabiz.work' });
  assert.ok((await f.message({ type: 'app-status' }, appSender)).target);
  assert.equal((await f.message({ type: 'app-start', token: 'a'.repeat(64), target: 'selected' }, appSender)).started, true);
  assert.equal((await f.message({ type: 'app-status' }, appSender)).target, null);
  assert.ok((await f.message({ type: 'app-start', token: 'a'.repeat(64), target: 'selected' }, appSender)).error);
});
test('untrusted sites, nested frames and spoofed extension pages cannot launch', async () => {
  const f = await fixture();
  for (const sender of [ { ...appSender, url: 'https://evil.example/META/browser' }, { ...appSender, frameId: 1 }, { ...appSender, id: 'other' }, { ...appSender, url: 'https://evil.example/popup.html' } ]) {
    assert.equal(await f.message({ type: 'app-start', token: 'a'.repeat(64), target: 'new' }, sender), undefined);
  }
  assert.equal(f.calls.length,0);
});
test('snapshot reads form values and checkbox state without returning password or OTP values', async () => {
  const f = await fixture();
  const element = (type, value, extra = {}) => ({ type, value, tagName: 'INPUT', autocomplete: '', labels: [{ innerText: 'Test field' }], getAttribute: () => null, getBoundingClientRect: () => ({ x: 0, y: 0, width: 20, height: 20, right: 20, bottom: 20 }), ...extra });
  const elements = [element('text', 'MCREW-CHROME-TEST'), element('checkbox', 'on', { checked: true }), element('password', 'secret-password'), element('text', '123456', { autocomplete: 'one-time-code' })];
  const dom = vm.createContext({ document: { querySelectorAll: () => elements, title: 'Test', body: { innerText: 'Test form' } }, location: { href: 'https://example.com' }, innerWidth: 800, innerHeight: 600 });
  f.context.chrome.debugger.sendCommand = async (_target, _method, params) => ({ result: { value: vm.runInContext(params.expression, dom) } });
  const result = JSON.parse(await vm.runInContext('execute(7, {action:"snapshot"})', f.context));
  assert.equal(result.controls[0].value, 'MCREW-CHROME-TEST');
  assert.equal(result.controls[1].checked, true);
  assert.equal('value' in result.controls[2], false);
  assert.equal('value' in result.controls[3], false);
  assert.ok(!JSON.stringify(result).includes('secret-password'));
});
