import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { test } from 'node:test';
import assert from 'node:assert/strict';
test('bridge accepts only same-window same-origin allowlisted actions and correlates responses', async () => {
  const calls = [], replies = []; let listener;
  const window = { addEventListener: (_, fn) => { listener = fn; }, postMessage: (...args) => replies.push(args) };
  const context = vm.createContext({ window, location: { origin: 'https://crew.metabiz.work' }, chrome: { runtime: { sendMessage: async value => { calls.push(value); return { version: 2, target: null }; } } } });
  vm.runInContext(await readFile(new URL('./bridge.js', import.meta.url), 'utf8'), context);
  const event = { source: window, origin: 'https://crew.metabiz.work', data: { channel: 'mcrew-chrome-v2', direction: 'request', id: 'req-1', type: 'app-status' } };
  for (const invalid of [{ ...event, source: {} }, { ...event, origin: 'https://evil.example' }, { ...event, data: { ...event.data, type: 'share' } }, { ...event, data: { ...event.data, direction: 'response' } }]) await listener(invalid);
  assert.equal(calls.length,0);
  await listener(event);
  assert.equal(calls.length,1); assert.equal(replies[0][0].id,'req-1'); assert.equal(replies[0][1],event.origin);
});
