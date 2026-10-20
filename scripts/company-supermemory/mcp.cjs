#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const readline = require('node:readline');

const DEFAULT_CONFIG_PATH = path.join(os.homedir(), '.codex', 'supermemory.json');
const SERVER_INFO = { name: 'local-supermemory', version: '1.0.0' };

const TOOLS = [
  {
    name: 'memory',
    description: 'Store one memory in an explicitly selected Supermemory container.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        content: { type: 'string', description: 'Memory text to store.' },
        containerTag: { type: 'string', description: 'Required Supermemory container tag.' },
        isStatic: { type: 'boolean', description: 'Whether this is a durable profile fact.' },
      },
      required: ['content', 'containerTag'],
    },
  },
  {
    name: 'recall',
    description: 'Search memories in an explicitly selected Supermemory container.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        query: { type: 'string', description: 'Search query.' },
        containerTag: { type: 'string', description: 'Required Supermemory container tag.' },
        limit: { type: 'integer', minimum: 1, maximum: 10, description: 'Maximum matches, default 5.' },
      },
      required: ['query', 'containerTag'],
    },
  },
  {
    name: 'context',
    description: 'Fetch profile context for an explicitly selected Supermemory container.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        query: { type: 'string', description: 'Question or working context.' },
        containerTag: { type: 'string', description: 'Required Supermemory container tag.' },
      },
      required: ['query', 'containerTag'],
    },
  },
];

function configError(message) {
  return new Error(`Supermemory MCP configuration ${message}`);
}

function normalizeBaseUrl(value) {
  if (typeof value !== 'string' || !value.trim()) throw configError('is missing an API URL.');
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    throw configError('has an invalid API URL.');
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw configError('has an invalid API URL.');
  }
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/+$/, '');
}

function resolveConfig({ env = process.env, readFile = fs.readFileSync, configPath } = {}) {
  const selectedPath = env.SUPERMEMORY_CONFIG_PATH || configPath || DEFAULT_CONFIG_PATH;
  let fileConfig = {};
  if (!env.SUPERMEMORY_API_URL || !env.SUPERMEMORY_CODEX_API_KEY) {
    try {
      fileConfig = JSON.parse(String(readFile(selectedPath, 'utf8')));
    } catch {
      throw configError('could not be read.');
    }
  }
  const apiKey = env.SUPERMEMORY_CODEX_API_KEY || fileConfig.apiKey;
  if (typeof apiKey !== 'string' || !apiKey.trim()) throw configError('is missing an API key.');
  return {
    baseUrl: normalizeBaseUrl(env.SUPERMEMORY_API_URL || fileConfig.baseUrl),
    apiKey: apiKey.trim(),
  };
}

function rpcError(id, code, message) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } };
}

function toolResult(text, isError = false) {
  const result = { content: [{ type: 'text', text }] };
  if (isError) result.isError = true;
  return result;
}

function requiredText(args, key) {
  if (typeof args[key] !== 'string' || !args[key].trim()) {
    throw new Error(`${key} must be a non-empty string.`);
  }
  return args[key].trim();
}

async function requestApi(config, fetchImpl, endpoint, payload) {
  let response;
  try {
    response = await fetchImpl(`${config.baseUrl}${endpoint}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30000),
    });
  } catch (error) {
    if (error?.name === 'AbortError' || error?.name === 'TimeoutError') {
      throw new Error('Supermemory request timed out.');
    }
    throw new Error('Supermemory request could not be completed.');
  }
  if (!response.ok) throw new Error(`Supermemory request failed (HTTP ${response.status}).`);
  try {
    return await response.json();
  } catch {
    throw new Error('Supermemory returned an invalid JSON response.');
  }
}

function summarizeRecall(data, containerTag) {
  const items = Array.isArray(data?.results) ? data.results : Array.isArray(data?.memories) ? data.memories : [];
  const matches = items.map((item) => {
    const memory = item?.memory && typeof item.memory === 'object' ? item.memory : item;
    const match = { content: typeof memory?.content === 'string' ? memory.content : String(memory ?? '') };
    if (typeof item?.score === 'number') match.score = item.score;
    return match;
  });
  return { containerTag, count: matches.length, matches };
}

function createRequestHandler({ config, fetchImpl = fetch }) {
  if (!config?.baseUrl || !config?.apiKey) throw configError('is incomplete.');
  return async function handle(request) {
    const id = request?.id ?? null;
    if (!request || request.jsonrpc !== '2.0' || typeof request.method !== 'string') {
      return rpcError(id, -32600, 'Invalid JSON-RPC request.');
    }
    if (request.method === 'initialize') {
      return {
        jsonrpc: '2.0', id,
        result: {
          protocolVersion: request.params?.protocolVersion || '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: SERVER_INFO,
        },
      };
    }
    if (request.method === 'notifications/initialized') return null;
    if (request.method === 'tools/list') return { jsonrpc: '2.0', id, result: { tools: TOOLS } };
    if (request.method !== 'tools/call') return rpcError(id, -32601, 'Method not found.');

    const name = request.params?.name;
    const args = request.params?.arguments && typeof request.params.arguments === 'object'
      ? request.params.arguments
      : {};
    try {
      let result;
      if (name === 'memory') {
        const content = requiredText(args, 'content');
        const containerTag = requiredText(args, 'containerTag');
        if (args.isStatic !== undefined && typeof args.isStatic !== 'boolean') {
          throw new Error('isStatic must be a boolean when supplied.');
        }
        await requestApi(config, fetchImpl, '/v4/memories', {
          containerTag,
          memories: [{ content, isStatic: args.isStatic ?? false }],
        });
        result = toolResult(`Stored one memory in container "${containerTag}".`);
      } else if (name === 'recall') {
        const query = requiredText(args, 'query');
        const containerTag = requiredText(args, 'containerTag');
        const limit = args.limit ?? 5;
        if (!Number.isInteger(limit) || limit < 1 || limit > 10) {
          throw new Error('limit must be an integer from 1 to 10.');
        }
        const data = await requestApi(config, fetchImpl, '/v4/search', {
          q: query, containerTag, limit, searchMode: 'hybrid',
        });
        result = toolResult(JSON.stringify(summarizeRecall(data, containerTag), null, 2));
      } else if (name === 'context') {
        const query = requiredText(args, 'query');
        const containerTag = requiredText(args, 'containerTag');
        const data = await requestApi(config, fetchImpl, '/v4/profile', { containerTag, q: query });
        result = toolResult(JSON.stringify({ containerTag, context: data }, null, 2));
      } else {
        result = toolResult('Unknown Supermemory tool.', true);
      }
      return { jsonrpc: '2.0', id, result };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Supermemory request failed.';
      return { jsonrpc: '2.0', id, result: toolResult(message, true) };
    }
  };
}

function runStdio() {
  let handler;
  let startupError;
  try {
    handler = createRequestHandler({ config: resolveConfig() });
  } catch (error) {
    startupError = error instanceof Error ? error.message : 'Supermemory MCP configuration is invalid.';
  }
  const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  input.on('line', async (line) => {
    if (!line.trim()) return;
    let request;
    try {
      request = JSON.parse(line);
    } catch {
      process.stdout.write(`${JSON.stringify(rpcError(null, -32700, 'Parse error.'))}\n`);
      return;
    }
    const response = startupError ? rpcError(request?.id, -32001, startupError) : await handler(request);
    if (response) process.stdout.write(`${JSON.stringify(response)}\n`);
  });
}

if (require.main === module) runStdio();

module.exports = { createRequestHandler, resolveConfig };
