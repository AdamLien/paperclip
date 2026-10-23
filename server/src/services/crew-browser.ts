import { createHash, randomBytes, randomUUID } from "node:crypto";
import { conflict, forbidden, notFound } from "../errors.js";

export type BrowserCommand = { action: "snapshot" | "navigate" | "click" | "type" | "key" | "scroll"; url?: string; text?: string; x?: number; y?: number; key?: string; deltaY?: number };
type Pending = { id: string; command: BrowserCommand; createdAt: number; claimed: boolean; result?: { text?: string; error?: string } };
type Session = {
  id: string; companyId: string; ownerId: string; agentId: string; issueId: string;
  mode: "chrome" | "cloud"; label: string; tokenHash: string; expiresAt: number;
  connectedAt: number | null; lastSeen: number | null; url: string; title: string;
  frame: string | null; width: number; height: number; pending?: Pending;
};
export type BrowserScope = { companyId: string; ownerId: string; agentId?: string };
const hash = (token: string) => createHash("sha256").update(token).digest("hex");

/** Ephemeral by design: restart/expiry revokes all shared-tab authority. */
export function crewBrowserService(now = () => Date.now()) {
  const sessions = new Map<string, Session>();
  const sweep = () => { for (const [id, s] of sessions) if (s.expiresAt <= now()) sessions.delete(id); };
  const get = (id: string, scope: BrowserScope) => {
    sweep(); const s = sessions.get(id);
    if (!s || s.companyId !== scope.companyId || s.ownerId !== scope.ownerId || (scope.agentId && s.agentId !== scope.agentId)) throw notFound("Browser session not found");
    return s;
  };
  const relay = (token: string) => {
    sweep(); const digest = hash(token);
    const s = [...sessions.values()].find(s => s.tokenHash === digest);
    if (!s || (s.connectedAt === null && s.expiresAt - 115 * 60_000 <= now())) throw forbidden("Pairing expired or revoked");
    return s;
  };
  const view = (s: Session) => ({ id: s.id, issueId: s.issueId, agentId: s.agentId, mode: s.mode, label: s.label,
    status: s.lastSeen !== null && now() - s.lastSeen < 10_000 ? "connected" : s.connectedAt !== null ? "disconnected" : "waiting",
    expiresAt: new Date(s.expiresAt).toISOString(), url: s.url, title: s.title, frame: s.frame, width: s.width, height: s.height });
  return {
    create(input: { companyId: string; ownerId: string; agentId: string; issueId: string; mode: "chrome" | "cloud"; label: string }) {
      sweep(); if (sessions.size >= 100 || [...sessions.values()].filter(s => s.ownerId === input.ownerId).length >= 5) throw conflict("Stop an existing browser session first");
      const token = randomBytes(32).toString("hex");
      const s: Session = { ...input, id: randomUUID(), tokenHash: hash(token), expiresAt: now() + 120 * 60_000,
        connectedAt: null, lastSeen: null, url: "", title: "", frame: null, width: 0, height: 0 };
      sessions.set(s.id, s); return { ...view(s), pairingToken: token };
    },
    revoke(token: string) { const s = relay(token); sessions.delete(s.id); },
    list(scope: BrowserScope) { sweep(); return [...sessions.values()].filter(s => s.companyId === scope.companyId && s.ownerId === scope.ownerId && (!scope.agentId || s.agentId === scope.agentId)).map(view); },
    read(id: string, scope: BrowserScope) { return view(get(id, scope)); },
    stop(id: string, scope: BrowserScope) { get(id, scope); sessions.delete(id); },
    command(id: string, scope: BrowserScope, command: BrowserCommand) {
      const s = get(id, scope);
      if (s.lastSeen === null || now() - s.lastSeen >= 10_000) throw conflict("Browser is not connected");
      if (s.pending && !s.pending.result && now() - s.pending.createdAt < 30_000) throw conflict("Browser command in progress");
      const p: Pending = { id: randomUUID(), command, createdAt: now(), claimed: false }; s.pending = p;
      return { id: p.id };
    },
    result(id: string, scope: BrowserScope, commandId: string) {
      const p = get(id, scope).pending;
      if (!p || p.id !== commandId) throw notFound("Browser command not found");
      return { id: p.id, status: p.result ? "done" : now() - p.createdAt >= 30_000 ? "expired" : "pending", result: p.result };
    },
    exchange(token: string, input: { url: string; title: string; frame?: string; width: number; height: number; result?: { id: string; text?: string; error?: string } }) {
      const s = relay(token); s.connectedAt ??= now(); s.lastSeen = now();
      s.url = input.url; s.title = input.title; s.width = input.width; s.height = input.height;
      if (input.frame) s.frame = input.frame;
      if (input.result && s.pending?.id === input.result.id && s.pending.claimed && !s.pending.result) s.pending.result = { text: input.result.text, error: input.result.error };
      const p = s.pending;
      if (!p || p.result || p.claimed || now() - p.createdAt >= 30_000) return { command: null };
      p.claimed = true;
      return { command: { id: p.id, ...p.command } };
    },
  };
}
