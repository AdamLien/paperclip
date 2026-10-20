import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const routes = new Set(['/v4/profile', '/v4/search', '/v4/memories']);
const equal = (a, b) => {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};
const invalid = (status, message) => Object.assign(new Error(message), { status });
function text(value, name, max = 16000) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw invalid(400, `Invalid ${name}`);
  return value.trim();
}

// Build the upstream payload ourselves: never forward arbitrary filters, tags,
// IDs, URLs or headers supplied by an agent.
export function scopedPayload(route, body, tenant) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw invalid(400, 'Object required');
  if (body.containerTag !== tenant.containerTag) throw invalid(403, 'Company memory scope denied');
  const allowed = route === '/v4/memories'
    ? ['containerTag', 'memories']
    : route === '/v4/search' ? ['containerTag', 'q', 'limit', 'searchMode'] : ['containerTag', 'q'];
  if (Object.keys(body).some(k => !allowed.includes(k))) throw invalid(400, 'Unsupported memory parameter');
  if (route === '/v4/memories') {
    if (!Array.isArray(body.memories) || body.memories.length !== 1) throw invalid(400, 'One memory required');
    const item = body.memories[0];
    if (!item || typeof item !== 'object' || Object.keys(item).some(k => !['content', 'isStatic'].includes(k))) throw invalid(400, 'Invalid memory');
    if (item.isStatic !== undefined && typeof item.isStatic !== 'boolean') throw invalid(400, 'Invalid isStatic');
    return { containerTag: tenant.containerTag, memories: [{ content: text(item.content, 'content'), isStatic: item.isStatic ?? false }] };
  }
  const result = { containerTag: tenant.containerTag, q: text(body.q, 'query', 4000) };
  if (route === '/v4/search') {
    const limit = body.limit ?? 5;
    if (!Number.isInteger(limit) || limit < 1 || limit > 10) throw invalid(400, 'Invalid limit');
    result.limit = limit;
    result.searchMode = 'hybrid';
  }
  return result;
}

export function createGateway(config, fetchImpl = fetch) {
  const upstream = new URL(config.upstreamUrl);
  if (!['http:', 'https:'].includes(upstream.protocol) || upstream.username || upstream.password || upstream.search || upstream.hash) throw Error('Invalid upstream');
  if (!config.upstreamKey || !config.tenants?.length) throw Error('Missing credentials');
  if (new Set(config.tenants.map(t => t.token)).size !== config.tenants.length || new Set(config.tenants.map(t => t.containerTag)).size !== config.tenants.length) throw Error('Tenant scopes and credentials must be unique');
  for (const t of config.tenants) if (!t.companyId || t.token.length < 32 || !/^crew_company_[a-f0-9-]{36}$/.test(t.containerTag)) throw Error('Invalid tenant configuration');
  return http.createServer(async (req, res) => {
    const reply = (status, value) => {
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(value));
    };
    try {
      if (req.method === 'GET' && req.url === '/healthz') return reply(200, { status: 'ok' });
      const token = (req.headers.authorization ?? '').replace(/^Bearer /, '');
      // Preserve the existing administrator API address while putting the
      // legacy backend (which trusts localhost) behind an authenticated front.
      if (config.allowAdminProxy && equal(token, config.upstreamKey)) {
        const target = new URL(req.url, upstream);
        if (!req.url.startsWith('/') || req.url.startsWith('//') || target.origin !== upstream.origin) throw invalid(400, 'Invalid API path');
        let bytes = 0, chunks = [];
        for await (const chunk of req) {
          bytes += chunk.length;
          if (bytes > 8 * 1024 * 1024) throw invalid(413, 'API request too large');
          chunks.push(chunk);
        }
        const response = await fetchImpl(target, {
          method: req.method,
          headers: { Authorization: `Bearer ${config.upstreamKey}`, 'Content-Type': req.headers['content-type'] ?? 'application/json' },
          ...(!['GET', 'HEAD'].includes(req.method) ? { body: Buffer.concat(chunks) } : {}),
          redirect: 'error', signal: AbortSignal.timeout(30000),
        });
        res.writeHead(response.status, { 'Content-Type': response.headers.get('content-type') ?? 'application/json', 'Cache-Control': 'no-store' });
        return res.end(Buffer.from(await response.arrayBuffer()));
      }
      const tenant = config.tenants.find(t => equal(token, t.token));
      if (!tenant) throw invalid(401, 'Unauthorized');
      if (req.method !== 'POST' || !routes.has(req.url)) throw invalid(404, 'Memory route unavailable');
      let bytes = 0, chunks = [];
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > 24000) throw invalid(413, 'Memory request too large');
        chunks.push(chunk);
      }
      let body;
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch { throw invalid(400, 'Invalid JSON'); }
      const payload = scopedPayload(req.url, body, tenant);
      const response = await fetchImpl(new URL(req.url, upstream), {
        method: 'POST',
        headers: { Authorization: `Bearer ${config.upstreamKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload), redirect: 'error', signal: AbortSignal.timeout(30000),
      });
      // Do not leak upstream error bodies, credentials or configuration.
      if (!response.ok) throw invalid(502, 'Memory storage request failed');
      reply(200, await response.json());
    } catch (error) {
      reply(error.status ?? 502, { error: error.status ? error.message : 'Memory service unavailable' });
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const config = JSON.parse(readFileSync(process.argv[2], 'utf8'));
  createGateway(config).listen(config.port ?? 6768, '127.0.0.1', () => console.log('Crew company memory gateway ready'));
  if (config.adminPort) createGateway(config).listen(config.adminPort, '0.0.0.0', () => console.log('Supermemory authenticated administrator front ready'));
}
