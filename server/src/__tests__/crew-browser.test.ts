import { describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import express from "express";
import http from "supertest";
import type { Db } from "@paperclipai/db";
import { crewBrowserService } from "../services/crew-browser.js";
import { crewBrowserRoutes } from "../routes/crew-browser.js";
import { errorHandler } from "../middleware/error-handler.js";
import { boardMutationGuard } from "../middleware/board-mutation-guard.js";
import { Writable } from "node:stream";
import pino from "pino";
import { createHttpLogger } from "../middleware/logger.js";
import { HTTP_LOG_REDACT_PATHS } from "../middleware/http-log-redaction.js";
vi.mock("../services/activity-log.js", () => ({ logActivity: vi.fn().mockResolvedValue(undefined) }));

const scope = { companyId: randomUUID(), ownerId: "owner", agentId: randomUUID() };
const input = { ...scope, issueId: randomUUID(), mode: "chrome" as const, label: "Chrome" };
const state = { url: "https://example.com", title: "Example", width: 800, height: 600 };
describe("shared browser lifecycle", () => {
  it("binds authority to company, owner and agent without returning the credential again", () => {
    const service = crewBrowserService(); const s = service.create(input);
    expect(s.pairingToken).toMatch(/^[a-f0-9]{64}$/);
    expect(service.read(s.id, scope)).not.toHaveProperty("pairingToken");
    for (const wrong of [{ ...scope, companyId: randomUUID() }, { ...scope, ownerId: "other" }, { ...scope, agentId: randomUUID() }]) {
      expect(() => service.read(s.id, wrong)).toThrow("not found");
      expect(service.list(wrong)).toEqual([]);
    }
  });
  it("requires a recent connection, dispatches once and revokes on stop", () => {
    let time = 0; const service = crewBrowserService(() => time); const s = service.create(input);
    expect(() => service.command(s.id, scope, { action: "snapshot" })).toThrow("not connected");
    service.exchange(s.pairingToken, state);
    expect(service.read(s.id, scope).status).toBe("connected");
    const c = service.command(s.id, scope, { action: "click", x: 10, y: 20 });
    expect(() => service.command(s.id, scope, { action: "snapshot" })).toThrow("in progress");
    expect(service.exchange(s.pairingToken, state).command?.id).toBe(c.id);
    expect(service.exchange(s.pairingToken, state).command).toBeNull();
    service.exchange(s.pairingToken, { ...state, result: { id: c.id, text: "done" } });
    expect(service.result(s.id, scope, c.id)).toMatchObject({ status: "done", result: { text: "done" } });
    time = 10_000;
    expect(service.read(s.id, scope).status).toBe("disconnected");
    expect(() => service.command(s.id, scope, { action: "snapshot" })).toThrow("not connected");
    service.stop(s.id, scope);
    expect(() => service.exchange(s.pairingToken, state)).toThrow("revoked");
  });
  it("expires an unused pairing after five minutes and a connected session after two hours", () => {
    let time = 0; const service = crewBrowserService(() => time); const a = service.create(input); const b = service.create(input);
    service.exchange(b.pairingToken, state); time = 5 * 60_000;
    expect(() => service.exchange(a.pairingToken, state)).toThrow("expired");
    expect(() => service.exchange(b.pairingToken, state)).not.toThrow();
    time = 120 * 60_000;
    expect(() => service.exchange(b.pairingToken, state)).toThrow("expired");
    expect(service.list(scope)).toEqual([]);
  });
  it("does not replay a timed-out command after reconnecting", () => {
    let time = 0; const service = crewBrowserService(() => time); const s = service.create(input);
    service.exchange(s.pairingToken, state); const c = service.command(s.id, scope, { action: "key", key: "Enter" });
    time = 30_000;
    expect(service.exchange(s.pairingToken, state).command).toBeNull();
    expect(service.result(s.id, scope, c.id).status).toBe("expired");
  });
  it("bounds concurrent sessions", () => {
    const service = crewBrowserService(); for (let i = 0; i < 5; i++) service.create(input);
    expect(() => service.create(input)).toThrow("Stop an existing");
  });
});

describe("browser HTTP boundary", () => {
  it("does not log pairing credentials, screenshots, page text or typed input on failures", async () => {
    const chunks: string[] = [];
    const sink = new Writable({ write(chunk, _encoding, callback) { chunks.push(String(chunk)); callback(); } });
    const app = express(); app.use(express.json()); app.use(createHttpLogger(pino({ redact: [...HTTP_LOG_REDACT_PATHS] }, sink)));
    app.post("/api/browser-workspace/relay", (_req, res) => res.status(403).json({ error: "expired" }));
    app.post("/api/companies/company/browser-workspace/id/commands", (_req, res) => res.status(400).json({ error: "invalid" }));
    await http(app).post("/api/browser-workspace/relay").set("X-Crew-Browser-Pairing", "pair-canary").send({ frame: "frame-canary", result: { text: "page-canary" } });
    await http(app).post("/api/companies/company/browser-workspace/id/commands").send({ action: "type", text: "typed-canary" });
    expect(chunks.join("")).not.toMatch(/pair-canary|frame-canary|page-canary|typed-canary/);
  });
  function fixture() {
    let actor: Express.Request["actor"] = { type: "board", userId: scope.ownerId, companyIds: [scope.companyId], source: "session" };
    let assignment = scope.agentId;
    let runIssue = input.issueId;
    const limit = vi.fn().mockImplementation(() => Promise.resolve([{ id: input.issueId, companyId: scope.companyId, assigneeAgentId: assignment,
      status: "running", responsibleUserId: scope.ownerId, nativeIssueId: runIssue }]));
    const db = { select: () => ({ from: () => ({ where: () => ({ limit }) }) }) } as unknown as Db;
    const service = crewBrowserService(); const s = service.create(input);
    const app = express(); app.use(express.json({ limit: "2mb" }));
    app.use((req, _res, next) => { req.actor = actor; next(); });
    app.use(boardMutationGuard()); app.use(crewBrowserRoutes(db, service)); app.use(errorHandler);
    return { app, s, service, actor: (value: typeof actor) => { actor = value; }, reassign: () => { assignment = randomUUID(); }, otherTask: () => { runIssue = randomUUID(); } };
  }
  const root = `/companies/${scope.companyId}/browser-workspace`;
  it("accepts only the pairing header on relay, with no browser session cookie", async () => {
    const f = fixture(); f.actor({ type: "none" });
    expect((await http(f.app).post("/browser-workspace/relay").send(state)).status).toBe(403);
    expect((await http(f.app).post("/browser-workspace/relay").set("X-Crew-Browser-Pairing", f.s.pairingToken).send(state)).status).toBe(200);
    expect((await http(f.app).get(`${root}/${f.s.id}`)).status).toBe(401);
  });
  it("denies another user or company", async () => {
    const f = fixture(); f.actor({ type: "board", userId: "other", companyIds: [scope.companyId] });
    expect((await http(f.app).get(`${root}/${f.s.id}`)).status).toBe(404);
    f.actor({ type: "board", userId: scope.ownerId, companyIds: [] });
    expect((await http(f.app).get(`${root}/${f.s.id}`)).status).toBe(403);
  });
  it("permits only the assigned agent's active responsible-user task", async () => {
    const f = fixture();
    const agent = { type: "agent" as const, companyId: scope.companyId, agentId: scope.agentId, onBehalfOfUserId: scope.ownerId, onBehalfOfMemberships: [{ companyId: scope.companyId, status: "active", membershipRole: "member" }], runId: randomUUID() };
    f.actor(agent);
    expect((await http(f.app).get(`${root}/${f.s.id}`)).status).toBe(200);
    f.otherTask(); expect((await http(f.app).get(`${root}/${f.s.id}`)).status).toBe(403);
    expect((await http(f.app).get(root)).body).toEqual([]);
    f.actor({ ...agent, onBehalfOfUserId: undefined });
    expect((await http(f.app).get(`${root}/${f.s.id}`)).status).toBe(403);
  });
  it("lets the owner revoke after task reassignment and immediately rejects relay", async () => {
    const f = fixture(); f.reassign();
    expect((await http(f.app).get(`${root}/${f.s.id}`)).status).toBe(403);
    expect((await http(f.app).get(root)).body).toHaveLength(1);
    expect((await http(f.app).delete(`${root}/${f.s.id}`).set("Origin", "http://localhost:3100")).status).toBe(200);
    f.actor({ type: "none" });
    expect((await http(f.app).post("/browser-workspace/relay").set("X-Crew-Browser-Pairing", f.s.pairingToken).send(state)).status).toBe(403);
  });
  it.each([{ action: "navigate", url: "javascript:alert(1)" }, { action: "navigate", url: "https://user:password@example.com" }, { action: "evaluate", script: "anything" }])("rejects unsupported navigation or arbitrary code: %j", async body => {
    const f = fixture(); f.service.exchange(f.s.pairingToken, state);
    expect((await http(f.app).post(`${root}/${f.s.id}/commands`).set("Origin", "http://localhost:3100").send(body)).status).toBe(400);
  });
});
