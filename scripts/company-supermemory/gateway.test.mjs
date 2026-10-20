import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createGateway } from './gateway.mjs';

const tenants = [
  { companyId: '0802115b-f3cd-4363-a629-9f857a315f20', token: 'a'.repeat(48), containerTag: 'crew_company_0802115b-f3cd-4363-a629-9f857a315f20' },
  { companyId: '13f3f257-5f52-4fe3-a674-cc728f71ff5d', token: 'b'.repeat(48), containerTag: 'crew_company_13f3f257-5f52-4fe3-a674-cc728f71ff5d' },
];
test('company memory integration: independent persistence and bidirectional denial', async t => {
  const stored = new Map(), calls = [];
  const server = createGateway({ upstreamUrl: 'http://127.0.0.1:6767', upstreamKey: 'upstream-secret', tenants }, async (url, options) => {
    const body = JSON.parse(options.body); calls.push(body);
    assert.equal(options.headers.Authorization, 'Bearer upstream-secret');
    if (url.pathname === '/v4/memories') stored.set(body.containerTag, body.memories);
    return new Response(JSON.stringify({ results: stored.get(body.containerTag) ?? [] }));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const request = (tenant, path, body) => fetch(`http://127.0.0.1:${server.address().port}${path}`, {
    method: 'POST', headers: { Authorization: `Bearer ${tenant.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  for (const [i, tenant] of tenants.entries()) {
    const r = await request(tenant, '/v4/memories', { containerTag: tenant.containerTag, memories: [{ content: `fixture-${i}` }] });
    assert.equal(r.status, 200);
  }
  for (const [i, tenant] of tenants.entries()) {
    for (const path of ['/v4/search', '/v4/profile']) {
      const own = await request(tenant, path, { containerTag: tenant.containerTag, q: 'fixture' });
      assert.deepEqual((await own.json()).results, [{ content: `fixture-${i}`, isStatic: false }]);
      const before = calls.length;
      const cross = await request(tenant, path, { containerTag: tenants[1-i].containerTag, q: 'fixture' });
      assert.equal(cross.status, 403); assert.equal(calls.length, before);
    }
    const crossWrite = await request(tenant, '/v4/memories', { containerTag: tenants[1-i].containerTag, memories: [{ content: 'no' }] });
    assert.equal(crossWrite.status, 403);
    const injected = await request(tenant, '/v4/search', { containerTag: tenant.containerTag, q: 'fixture', containerTags: tenants.map(t => t.containerTag) });
    assert.equal(injected.status, 400);
    assert.equal((await request(tenant, '/v3/documents', {})).status, 404);
    assert.equal((await request(tenant, '/v4/profile?containerTag=other', {})).status, 404);
    assert.equal((await request(tenant, '/v4/search', { q: 'all' })).status, 403);
  }
  const r = await request({ token: 'unknown' }, '/v4/search', {}); assert.equal(r.status, 401);
});

test('administrator front preserves authenticated APIs and rejects unauthenticated legacy access', async t => {
  let calls = 0;
  const server = createGateway({ upstreamUrl: 'http://127.0.0.1:6770', upstreamKey: 'master-secret', tenants, allowAdminProxy: true }, async (url, options) => {
    calls++;
    assert.equal(url.origin, 'http://127.0.0.1:6770');
    assert.equal(options.headers.Authorization, 'Bearer master-secret');
    return new Response(JSON.stringify({ ok: true }), { status: 201 });
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const token of ['', 'wrong', tenants[0].token]) {
    const r = await fetch(base + '/v3/documents', { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(r.status, token === tenants[0].token ? 404 : 401);
  }
  assert.equal(calls, 0);
  assert.equal((await fetch(base + '/v3/documents', { headers: { Authorization: 'Bearer master-secret' } })).status, 201);
  assert.equal(calls, 1);
});
