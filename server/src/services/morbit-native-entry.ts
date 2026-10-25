import { createRequire } from "node:module";
import type { IncomingMessage, Server as HttpServer } from "node:http";
import type { Duplex } from "node:stream";

const require = createRequire(import.meta.url);
const { WebSocket, WebSocketServer } = require("ws") as {
  WebSocket: { new (url: string, protocols?: string[], options?: { headers?: Record<string, string>; handshakeTimeout?: number }): any; OPEN: number };
  WebSocketServer: new (options: { noServer: boolean }) => {
    handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer, callback: (client: any) => void): void;
  };
};

export type MorbitNativeEntry = {
  url: string;
  localOnly: boolean;
};

export type MorbitConsoleProxyRequest = {
  method: string;
  path: string;
  headers: Headers;
  body?: BodyInit | AsyncIterable<Uint8Array>;
  bridge: boolean;
};

export type MorbitConsoleProxy = {
  forward(request: MorbitConsoleProxyRequest): Promise<Response>;
};

export type MorbitConsoleWebSocketOptions = {
  server: HttpServer;
  upstream?: string;
  adminTokenFile?: string;
  bridgeOrigin?: string;
  authorize: (request: IncomingMessage) => Promise<boolean>;
  readAdminToken?: () => Promise<string>;
};

function fixedUpstreamOrigin(raw: string | undefined): string | null {
  if (!raw?.trim()) return null;
  try {
    const url = new URL(raw.trim());
    if (!(["http:", "https:"].includes(url.protocol)) || url.username || url.password || url.search || url.hash) return null;
    if (url.protocol === "http:" && !["ocx", "localhost", "127.0.0.1"].includes(url.hostname.toLowerCase())) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function isMorbitConsoleWebSocketOriginAllowed(requestOrigin: string | undefined, bridgeOrigin: string | undefined): boolean {
  const expected = fixedBridgeOrigin(bridgeOrigin);
  return !!expected && requestOrigin === expected;
}

function fixedBridgeOrigin(raw: string | undefined): string | null {
  if (!raw?.trim()) return null;
  try {
    const url = new URL(raw.trim());
    const loopback = ["localhost", "127.0.0.1"].includes(url.hostname.toLowerCase());
    if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) return null;
    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function containsRawAdminCredential(value: string | undefined): boolean {
  return !!value && /ocx_admin_[A-Za-z0-9_-]{20,}/.test(value);
}

/** Server-only OCX bridge. The admin credential is read only for the bridge request. */
export function createMorbitConsoleProxy(options: {
  upstream?: string;
  adminTokenFile?: string;
  bridgeOrigin?: string;
  readAdminToken?: () => Promise<string>;
  fetcher?: typeof fetch;
  timeoutMs?: number;
}): MorbitConsoleProxy | null {
  const upstream = fixedUpstreamOrigin(options.upstream);
  const bridgeOrigin = fixedBridgeOrigin(options.bridgeOrigin);
  if (!upstream || !bridgeOrigin) return null;
  try {
    const origin = new URL(bridgeOrigin);
    if (!(["http:", "https:"].includes(origin.protocol)) || origin.username || origin.password
      || origin.pathname !== "/" || origin.search || origin.hash) return null;
  } catch {
    return null;
  }
  const readAdminToken = options.readAdminToken ?? (options.adminTokenFile
    ? async () => (await import("node:fs/promises")).readFile(options.adminTokenFile!, "utf8")
    : undefined);
  if (!readAdminToken) return null;
  const fetcher = options.fetcher ?? fetch;
  const timeoutMs = options.timeoutMs ?? 300_000;
  return {
    async forward(request) {
      if (!request.path.startsWith("/") || request.path.startsWith("//") || request.path.includes("\\")
        || /%(?:2f|5c|2e)/i.test(request.path) || request.path.includes("#")) {
        return Response.json({ error: "Invalid native console path" }, { status: 400 });
      }
      const headers = new Headers(request.headers);
      headers.delete("host");
      headers.delete("content-length");
      headers.delete("authorization");
      headers.delete("cookie");
      headers.delete("connection");
      headers.delete("upgrade");
      headers.delete("sec-websocket-key");
      headers.delete("sec-websocket-accept");
      headers.delete("sec-websocket-protocol");
      headers.delete("sec-websocket-version");
      headers.delete("x-opencodex-admin-bridge");
      headers.delete("x-opencodex-bridge-origin");
      headers.delete("x-opencodex-trusted-proxy");
      headers.delete("x-forwarded-host");
      headers.delete("x-forwarded-proto");
      headers.set("Host", new URL(bridgeOrigin).host);
      headers.set("Accept-Encoding", "identity");
      headers.set("Origin", originForBridge(bridgeOrigin));
      headers.set("X-OpenCodex-GUI-Origin", originForBridge(bridgeOrigin));
      if (request.bridge) {
        const token = (await readAdminToken()).trim();
        if (!/^ocx_admin_[A-Za-z0-9_-]{43}$/.test(token) || /[\r\n]/.test(token)) {
          return Response.json({ error: "OCX console bridge unavailable" }, { status: 503 });
        }
        headers.set("X-OpenCodex-API-Key", token);
        headers.set("X-OpenCodex-Trusted-Proxy", "mdeck");
        headers.delete("X-OpenCodex-CSRF-Token");
      }
      const target = new URL(request.path, `${upstream}/`);
      const body = request.body as BodyInit | undefined;
      return fetcher(target, {
        method: request.method,
        headers,
        body,
        redirect: "manual",
        signal: AbortSignal.timeout(timeoutMs),
        ...(body && typeof body !== "string" && !(body instanceof ArrayBuffer)
          ? { duplex: "half" as const } : {}),
      });
    },
  };
}

export function isMorbitConsoleWebSocketPath(pathname: string): boolean {
  if (!pathname.startsWith("/") || pathname.includes("\\") || /%(?:2f|5c|2e)/i.test(pathname)) return false;
  return pathname === "/v1/live" || pathname === "/v1/realtime"
    || pathname === "/v1/audio/transcriptions/stream"
    || /^\/v1\/(?:live|realtime\/calls)\/[^/]+\/?$/.test(pathname);
}

/** Register only the OCX audio/realtime upgrade paths; unknown upgrades remain owned elsewhere. */
export function setupMorbitConsoleWebSocketServer(options: MorbitConsoleWebSocketOptions): void {
  const upstreamOrigin = fixedUpstreamOrigin(options.upstream);
  const bridgeOrigin = fixedBridgeOrigin(options.bridgeOrigin);
  if (!upstreamOrigin || !bridgeOrigin) return;
  const origin = new URL(bridgeOrigin).origin;
  const wss = new WebSocketServer({ noServer: true });

  options.server.on("upgrade", (request, socket, head) => {
    const rawUrl = request.url;
    if (!rawUrl) return;
    const incoming = new URL(rawUrl, "http://mdeck.invalid");
    const prefix = "/api/morbit/base/console";
    if (!incoming.pathname.startsWith(`${prefix}/`)) return;
    const downstreamPath = incoming.pathname.slice(prefix.length) || "/";
    if (!isMorbitConsoleWebSocketPath(downstreamPath)
      || incoming.searchParams.has("token") || incoming.searchParams.has("key")) {
      socket.destroy();
      return;
    }
    if (!isMorbitConsoleWebSocketOriginAllowed(request.headers.origin, bridgeOrigin)) {
      socket.destroy();
      return;
    }
    (request as IncomingMessage & { paperclipWebSocketHandled?: boolean }).paperclipWebSocketHandled = true;

    void (async () => {
      const rawAdmin = [request.headers.authorization, request.headers["x-opencodex-api-key"], request.headers["x-api-key"]]
        .flatMap(value => Array.isArray(value) ? value : value ? [value] : [])
        .some(value => value.includes("ocx_admin_"));
      if (rawAdmin || request.headers["x-opencodex-trusted-proxy"]) {
        socket.destroy();
        return;
      }
      if (!(await options.authorize(request))) {
        socket.destroy();
        return;
      }
      const headers: Record<string, string> = {
        Host: new URL(origin).host,
        Origin: origin,
        "X-OpenCodex-Trusted-Proxy": "mdeck",
        "X-OpenCodex-GUI-Origin": origin,
      };
      const rawProtocols = request.headers["sec-websocket-protocol"];
      const protocols = typeof rawProtocols === "string"
        ? rawProtocols.split(",").map(value => value.trim()).filter(Boolean)
        : [];
      if (containsRawAdminCredential(request.headers.authorization)
        || containsRawAdminCredential(request.headers["x-opencodex-api-key"] as string | undefined)
        || protocols.some(containsRawAdminCredential)) {
        socket.destroy();
        return;
      }
      const target = new URL(`${downstreamPath}${incoming.search}`, upstreamOrigin);
      target.protocol = target.protocol === "https:" ? "wss:" : "ws:";
      const upstream = new WebSocket(target.href, protocols, { headers, handshakeTimeout: 300_000 });
      let handedOff = false;
      let settled = false;
      let client: any;
      const pendingMessages: Array<[unknown, boolean]> = [];
      const onUpstreamMessage = (data: unknown, isBinary: boolean) => {
        if (client?.readyState === WebSocket.OPEN) client.send(data, { binary: isBinary });
        else pendingMessages.push([data, isBinary]);
      };
      upstream.on("message", onUpstreamMessage);
      const rejectBeforeHandshake = () => {
        if (settled || handedOff) return;
        settled = true;
        upstream.removeAllListeners();
        try { upstream.close(); } catch { /* already closed */ }
        socket.destroy();
      };
      const abortIfClientCloses = () => rejectBeforeHandshake();
      const onUpstreamError = () => rejectBeforeHandshake();
      const onUnexpectedResponse = () => rejectBeforeHandshake();
      const onUpstreamClose = () => rejectBeforeHandshake();
      upstream.once("error", onUpstreamError);
      upstream.once("unexpected-response", onUnexpectedResponse);
      upstream.once("close", onUpstreamClose);
      socket.once("close", abortIfClientCloses);
      upstream.once("open", () => {
        if (settled) return;
        settled = true;
        handedOff = true;
        socket.removeListener("close", abortIfClientCloses);
        upstream.removeListener("error", onUpstreamError);
        upstream.removeListener("unexpected-response", onUnexpectedResponse);
        upstream.removeListener("close", onUpstreamClose);
        try {
          wss.handleUpgrade(request, socket, head, upgradedClient => {
            client = upgradedClient;
            let closed = false;
            const closeBoth = () => {
              if (closed) return;
              closed = true;
              try { client.close(); } catch { /* already closed */ }
              try { upstream.close(); } catch { /* already closed */ }
            };
            client.on("message", (data: unknown, isBinary: boolean) => {
              if (upstream.readyState === WebSocket.OPEN) upstream.send(data, { binary: isBinary });
            });
            client.on("close", closeBoth);
            client.on("error", closeBoth);
            for (const [data, isBinary] of pendingMessages.splice(0)) {
              if (client.readyState === WebSocket.OPEN) client.send(data, { binary: isBinary });
            }
            upstream.on("close", (code: number, reason: Buffer) => {
              if (!closed) { closed = true; client.close(code, reason); }
            });
            upstream.on("error", closeBoth);
          });
        } catch {
          try { upstream.close(); } catch { /* already closed */ }
          socket.destroy();
        }
      });
    })().catch(() => socket.destroy());
  });
}

function originForBridge(value: string): string {
  return new URL(value).origin;
}

/** Accept only an operator-configured native OCX origin and its providers hash. */
export function readMorbitNativeEntry(raw = process.env.MORBIT_UAT_OCX_MANAGEMENT_URL): MorbitNativeEntry | null {
  if (!raw?.trim()) return null;

  try {
    const url = new URL(raw.trim());
    const localOnly = url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname);
    if (url.username || url.password || url.search || !["https:", "http:"].includes(url.protocol)) return null;
    if (url.protocol === "http:" && !localOnly) return null;
    if (url.pathname !== "" && url.pathname !== "/") return null;
    if (url.hash !== "" && url.hash !== "#providers") return null;
    return { url: `${url.origin}/${url.hash}`, localOnly };
  } catch {
    return null;
  }
}
