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
      tabs: { onRemoved: { addListener: fn => { listeners.removed = fn; } }, get: async id => ({ id, url: 'https://example.com' }), update: async (id, value) => calls.push(['update', { tabId: id }, value]) },
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
