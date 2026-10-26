import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { morbitManagementRoutes } from "../routes/morbit-management.js";
import type { ManagementDependencies } from "../routes/morbit-management.js";
import type { MorbitConsoleProxy } from "../services/morbit-native-entry.js";
import { nativePathFromRequest } from "../services/morbit-base-native.js";

const admin = { type: "board", source: "session", userId: "admin", isInstanceAdmin: true, companyIds: ["company-1"] } as never;
const member = { type: "board", source: "session", userId: "member", isInstanceAdmin: false, companyIds: ["company-1"] } as never;
const make = (
  actor = admin,
  response = Response.json({ ok: true }),
  companies = [{ id: "company-1", name: "Demo", issuePrefix: "DEMO" }],
) => {
  const forward = vi.fn(async () => response);
  const deps = {
    companies: vi.fn(async () => companies),
    consoleProxy: { forward },
    audit: vi.fn(async () => {}),
  } as unknown as ManagementDependencies;
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.actor = actor; next(); });
  app.use("/api", morbitManagementRoutes(deps));
  return { app, forward, audit: deps.audit };
};

describe("morbit base native BFF", () => {
  it("forwards the exact native provider wire shape through the server bridge and redacts provider secrets", async () => {
    const fixture = Response.json([{ name: "openai", adapter: "openai", baseUrl: "https://api.openai.com/v1", defaultModel: "gpt-4.1", hasApiKey: true, apiKey: "fixture-secret", settings: { clientSecret: "also-secret" } }]);
    const setup = make(admin, fixture);
    const response = await request(setup.app).get("/api/morbit/base/native/api/providers");
    expect(response.status).toBe(200);
    expect(response.body).toEqual([{ name: "openai", adapter: "openai", baseUrl: "https://api.openai.com/v1", defaultModel: "gpt-4.1", hasApiKey: true, apiKey: null, settings: { clientSecret: null } }]);
    expect(setup.forward).toHaveBeenCalledWith(expect.objectContaining({ method: "GET", path: "/api/providers", bridge: true, headers: expect.not.objectContaining({ authorization: expect.anything() }) }));
  });

  it("preserves native account and device-login wire fixtures", async () => {
    const setup = make(admin, Response.json({ provider: "chatgpt", activeAccountId: "chatgpt-1", accounts: [{ id: "chatgpt-1", email: "a@example.com", status: "ready" }] }));
    const accounts = await request(setup.app).get("/api/morbit/base/native/api/oauth/accounts?provider=chatgpt");
    expect(accounts.body).toEqual({ provider: "chatgpt", activeAccountId: "chatgpt-1", accounts: [{ id: "chatgpt-1", email: "a@example.com", status: "ready" }] });
    const loginSetup = make(admin, Response.json({ flowId: "flow-1", url: "https://auth.example/device", deviceCode: "ABCD-1234", browserLaunch: "skipped" }));
    const login = await request(loginSetup.app).post("/api/morbit/base/native/api/codex-auth/login").set("Origin", "http://127.0.0.1").set("Host", "127.0.0.1").set("Content-Type", "application/json").send({ device: true, id: "chatgpt-1" });
    expect(login.body).toEqual({ flowId: "flow-1", url: "https://auth.example/device", deviceCode: "ABCD-1234", browserLaunch: "skipped" });
  });

  it("requires instance admin and trusted JSON origin for mutations, then audits metadata only", async () => {
    const denied = make(member);
    expect((await request(denied.app).get("/api/morbit/base/native/api/providers")).status).toBe(403);
    const setup = make();
    expect((await request(setup.app).post("/api/morbit/base/native/api/oauth/login").send({ provider: "xai" })).status).toBe(403);
    const response = await request(setup.app).post("/api/morbit/base/native/api/oauth/login").set("Origin", "http://127.0.0.1").set("Host", "127.0.0.1").set("Content-Type", "application/json").send({ provider: "xai", secret: "do-not-audit" });
    expect(response.status).toBe(200);
    expect(setup.audit).toHaveBeenCalledWith(expect.anything(), "company-1", "morbit.base_native_mutation", { scope: "instance", method: "POST", path: "/api/oauth/login", status: 200 });
  });

  it("rejects illegal paths, queries, credentials and unsupported mutation media", async () => {
    const setup = make();
    expect((await request(setup.app).get("/api/morbit/base/native/api/keys/reveal")).status).toBe(400);
    expect((await request(setup.app).get("/api/morbit/base/native/api/providers?destination=evil")).status).toBe(400);
    expect((await request(setup.app).get("/api/morbit/base/native/api/providers?name=openai")).status).toBe(200);
    expect((await request(setup.app).get("/api/morbit/base/native/api/%2e%2e/providers")).status).toBe(404);
    expect((await request(setup.app).get("/api/morbit/base/native/api/%2fproviders")).status).toBe(400);
    expect((await request(setup.app).get("/api/morbit/base/native/api/providers").set("Authorization", "Bearer browser-token")).status).toBe(403);
    expect((await request(setup.app).post("/api/morbit/base/native/api/oauth/login").set("Origin", "https://evil.example").set("Host", "127.0.0.1").set("Content-Type", "application/json").send({ provider: "xai" })).status).toBe(403);
    expect((await request(setup.app).post("/api/morbit/base/native/api/providers").set("Origin", "http://127.0.0.1").set("Host", "127.0.0.1").set("Content-Type", "text/plain").send("{}"))).toHaveProperty("status", 400);
  });

  it("requires company scope before forwarding an auditable mutation", async () => {
    const setup = make({ ...admin, companyIds: [] } as never, undefined, []);
    const response = await request(setup.app)
      .post("/api/morbit/base/native/api/oauth/logout?provider=xai")
      .set("Origin", "http://127.0.0.1")
      .set("Host", "127.0.0.1")
      .set("Content-Type", "application/json")
      .send({});
    expect(response.status).toBe(403);
    expect(setup.forward).not.toHaveBeenCalled();
    expect(setup.audit).not.toHaveBeenCalled();
  });

  it("audits a global instance owner against every real company", async () => {
    const setup = make({ ...admin, companyIds: [] } as never, undefined, [
      { id: "company-1", name: "Demo", issuePrefix: "DEMO" },
      { id: "company-2", name: "Other", issuePrefix: "OTHER" },
    ]);
    const response = await request(setup.app)
      .post("/api/morbit/base/native/api/oauth/logout?provider=xai")
      .set("Origin", "http://127.0.0.1")
      .set("Host", "127.0.0.1")
      .set("Content-Type", "application/json")
      .send({});
    expect(response.status).toBe(200);
    expect(setup.audit).toHaveBeenCalledWith(expect.anything(), "company-1", "morbit.base_native_mutation", { scope: "instance", method: "POST", path: "/api/oauth/logout", status: 200 });
    expect(setup.audit).toHaveBeenCalledWith(expect.anything(), "company-2", "morbit.base_native_mutation", { scope: "instance", method: "POST", path: "/api/oauth/logout", status: 200 });
    expect(setup.audit).toHaveBeenCalledTimes(2);
  });

  it("allowlists native provider key controls, OAuth logout and Codex exhausted pause", async () => {
    for (const [method, path] of [
      ["get", "/api/morbit/base/native/api/providers/keys?name=openai"],
      ["put", "/api/morbit/base/native/api/providers/keys/pause"],
      ["put", "/api/morbit/base/native/api/providers/keys/active"],
      ["put", "/api/morbit/base/native/api/providers/keys/alias"],
      ["delete", "/api/morbit/base/native/api/providers/keys?name=openai&id=key-1"],
      ["post", "/api/morbit/base/native/api/oauth/logout?provider=xai"],
      ["put", "/api/morbit/base/native/api/codex-auth/accounts/pause-exhausted"],
    ] as const) {
      const setup = make(admin);
      const response = await request(setup.app)[method](path)
        .set("Origin", "http://127.0.0.1")
        .set("Host", "127.0.0.1")
        .set("Content-Type", "application/json")
        .send({});
      expect(response.status).toBe(200);
      expect(setup.forward).toHaveBeenCalledWith(expect.objectContaining({
        method: method.toUpperCase(),
        path: path.slice("/api/morbit/base/native".length),
        bridge: true,
      }));
    }
  });

  it("sets no-store before rejecting an anonymous HEAD request", async () => {
    const setup = make({ type: "none" } as never);
    const response = await request(setup.app).head("/api/morbit/base/native/api/providers");
    expect(response.status).toBe(401);
    expect(response.headers["cache-control"]).toContain("no-store");
  });

  it("forwards an allowlisted method and query exactly", async () => {
    const setup = make(admin, Response.json({ ok: true }));
    const response = await request(setup.app).post("/api/morbit/base/native/api/providers/test?name=openai").set("Origin", "http://127.0.0.1").set("Host", "127.0.0.1").set("Content-Type", "application/json").send({});
    expect(response.status).toBe(200);
    expect(setup.forward).toHaveBeenCalledWith(expect.objectContaining({ method: "POST", path: "/api/providers/test?name=openai", bridge: true }));
  });

  it("maps provider failures to safe status and code details without leaking messages or secrets", async () => {
    const setup = make(admin, Response.json({ error: "provider login failed with token=super-secret", code: "provider_unreachable", accessToken: "super-secret" }, { status: 409 }));
    const response = await request(setup.app).post("/api/morbit/base/native/api/oauth/login").set("Origin", "http://127.0.0.1").set("Host", "127.0.0.1").set("Content-Type", "application/json").send({ provider: "xai" });
    expect(response.status).toBe(409);
    expect(response.body).toEqual({ error: "native_management_upstream_failed", code: "provider_unreachable" });
    expect(JSON.stringify(response.body)).not.toContain("super-secret");
  });

  it("maps upstream server failures to BFF 502 without exposing upstream details", async () => {
    const setup = make(admin, Response.json({ error: "https://provider.example/oauth?access_token=secret" }, { status: 503 }));
    const response = await request(setup.app).get("/api/morbit/base/native/api/codex-auth/login-status?flowId=flow-1");
    expect(response.status).toBe(502);
    expect(response.body).toEqual({ error: "native_management_upstream_failed" });
    expect(JSON.stringify(response.body)).not.toContain("secret");
  });

  it("supports upstream provider key replacement without returning the submitted secret", async () => {
    const setup = make(admin, Response.json({ ok: true, id: "key-1", key: "submitted-secret" }, { status: 201 }));
    const response = await request(setup.app)
      .post("/api/morbit/base/native/api/providers/keys")
      .set("Origin", "http://127.0.0.1")
      .set("Host", "127.0.0.1")
      .set("Content-Type", "application/json")
      .send({ name: "openai", key: "submitted-secret", label: "primary" });
    expect(response.status).toBe(201);
    expect(response.body).toEqual({ ok: true, id: "key-1", key: null });
    expect(setup.forward).toHaveBeenCalledWith(expect.objectContaining({ method: "POST", path: "/api/providers/keys", bridge: true }));
    expect(setup.audit).toHaveBeenCalledWith(expect.anything(), "company-1", "morbit.base_native_mutation", { scope: "instance", method: "POST", path: "/api/providers/keys", status: 201 });
    expect(JSON.stringify(response.body)).not.toContain("submitted-secret");
  });
});

describe("native path validation", () => {
  it("rejects encoded separators and dot traversal before URL normalization", () => {
    expect(nativePathFromRequest({ originalUrl: "/api/morbit/base/native/api/%2e%2e/providers" } as never)).toBeNull();
    expect(nativePathFromRequest({ originalUrl: "/api/morbit/base/native/api/%2fproviders" } as never)).toBeNull();
    expect(nativePathFromRequest({ originalUrl: "/api/morbit/base/native/api/../providers" } as never)).toBeNull();
  });
});
