import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { morbitManagementRoutes, morbitManagementAssets, morbitWikiWriteGuard, type ManagementDependencies } from "../routes/morbit-management.js";
import { errorHandler } from "../middleware/error-handler.js";
import { readMorbitNativeEntry } from "../services/morbit-native-entry.js";

const company = "22222222-2222-4222-8222-222222222222";
const other = "33333333-3333-4333-8333-333333333333";
const member = { type: "board", source: "session", userId: "employee", companyIds: [company],
  memberships: [{ companyId: company, membershipRole: "member", status: "active" }] };
const manager = { ...member, userId: "manager", memberships: [{ companyId: company, membershipRole: "admin", status: "active" }] };

function setup(actor: Record<string, unknown> = manager, directory?: string) {
  const deps: ManagementDependencies = {
    companies: vi.fn(async () => [{ id: company, name: "Demo", issuePrefix: "DEMO" }]),
    company: vi.fn(async () => ({ id: company, name: "Demo", issuePrefix: "DEMO" })),
    canManage: vi.fn(async () => false),
    wiki: vi.fn(async () => null),
    modelStatus: vi.fn(async () => ({ state: "unconfigured" as const })),
    modelTest: vi.fn(async () => ({ model: "test-model", text: "OK", checkedAt: "2026-10-25T00:00:00Z" })),
    wikiCall: vi.fn(async (_key, params) => ({ companyId: params.companyId, pages: [] })),
    audit: vi.fn(async () => {}),
    nativeEntry: vi.fn(() => null),
  };
  const state = { actor };
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.actor = state.actor as typeof req.actor; next(); });
  app.use("/api", morbitManagementRoutes(deps));
  app.use("/management", morbitManagementAssets(deps, directory));
  app.use("/api", morbitWikiWriteGuard(deps));
  app.all("/api/plugins/:pluginId/{*rest}", (_req,res) => res.json({forwarded:true}));
  app.use(errorHandler);
  return { app, deps, state };
}
const path = (id = company) => `/api/companies/${id}/morbit`;

describe("mDeck management authority and truthful status", () => {
  it.each([
    ["", null],
    ["http://example.com", null],
    ["https://example.com/admin", null],
    ["https://user:pass@example.com", null],
    ["https://example.com/?next=evil", null],
    ["https://example.com/#other", null],
  ])("rejects unsafe native OCX management URL %s", (raw, expected) => {
    expect(readMorbitNativeEntry(raw)).toEqual(expected);
  });

  it("normalizes configured native OCX management URLs and marks loopback", () => {
    expect(readMorbitNativeEntry("https://ocx.example/#providers")).toEqual({
      url: "https://ocx.example/#providers", localOnly: false,
    });
    expect(readMorbitNativeEntry("http://127.0.0.1:8080")).toEqual({
      url: "http://127.0.0.1:8080/", localOnly: true,
    });
  });

  it("exposes and redirects only the configured native settings entry", async () => {
    const admin = setup({ ...manager, isInstanceAdmin: true });
    vi.mocked(admin.deps.nativeEntry!).mockReturnValue({ url: "https://ocx.example/#providers", localOnly: false });
    const management = await request(admin.app).get(`${path()}/management`);
    expect(management.body.data.base).toMatchObject({ settings_url: "/api/morbit/base/settings" });
    const workspaces = await request(admin.app).get("/api/morbit/workspaces");
    expect(workspaces.body.data.instance.base).toMatchObject({ settings_url: "/api/morbit/base/settings" });
    expect((await request(admin.app).get("/api/morbit/base/settings")).status).toBe(302);
    expect((await request(admin.app).get("/api/morbit/base/settings")).headers.location).toBe("https://ocx.example/#providers");
    expect((await request(admin.app).get("/api/morbit/base/settings?destination=https://evil.example")).status).toBe(400);
    vi.mocked(admin.deps.nativeEntry!).mockReturnValue({ url: "http://127.0.0.1:8080/", localOnly: true });
    expect((await request(admin.app).get(`${path()}/management`)).body.data.base.settings_local_only).toBe(true);
    expect((await request(admin.app).get("/api/morbit/workspaces")).body.data.instance.base.settings_local_only).toBe(true);
  });

  it("omits native settings for missing config and rejects non-instance admins", async () => {
    const missing = setup({ ...manager, isInstanceAdmin: true });
    expect((await request(missing.app).get(`${path()}/management`)).body.data.base).not.toHaveProperty("settings_url");
    expect((await request(missing.app).get("/api/morbit/base/settings")).status).toBe(404);
    for (const actor of [{ type: "none" }, member, manager]) {
      const status = actor.type === "none" ? 401 : 403;
      expect((await request(setup(actor).app).get("/api/morbit/base/settings")).status).toBe(status);
    }
  });

  it("instance owner without memberships can inspect global state without reading company data", async () => {
    const {app,deps} = setup({type:"board",source:"session",userId:"owner",isInstanceAdmin:true,companyIds:[],memberships:[]});
    const result=await request(app).get("/api/morbit/workspaces");
    expect(result.status).toBe(200);
    expect(result.body.data.workspaces).toEqual([]);
    expect(result.body.data.instance).toMatchObject({can_manage_instance:true,base:{state:"unconfigured"}});
    expect(deps.company).not.toHaveBeenCalled();
    expect((await request(app).get(`${path()}/management`)).status).toBe(403);
    const dir=await mkdtemp(join(tmpdir(),"morbit-instance-"));
    try {
      await writeFile(join(dir,"index.html"),"instance setup");
      const owner=setup({type:"board",source:"session",userId:"owner",isInstanceAdmin:true,companyIds:[],memberships:[]},dir);
      expect((await request(owner.app).get("/management/")).status).toBe(200);
    } finally {await rm(dir,{recursive:true,force:true});}
  });
  it("denies anonymous API access", async () => {
    const { app, deps } = setup({ type: "none" });
    expect((await request(app).get(`${path()}/management`)).status).toBe(401);
    expect(deps.company).not.toHaveBeenCalled();
  });
  it("denies an agent even with company scope", async () => {
    const { app } = setup({ type: "agent", companyId: company, agentId: "agent" });
    expect((await request(app).get(`${path()}/management`)).status).toBe(403);
  });
  it("employee sees capabilities without management details", async () => {
    const { app, deps } = setup(member);
    const res = await request(app).get(`${path()}/access`);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ can_manage_workspace: false, can_manage_instance: false });
    expect(res.body.data).not.toHaveProperty("services");
    expect(deps.modelStatus).not.toHaveBeenCalled();
    expect((await request(app).get(`${path()}/management`)).status).toBe(403);
  });
  it("does not trust caller-selected company scope, including instance admins", async () => {
    const { app, deps } = setup({ ...manager, isInstanceAdmin: true });
    expect((await request(app).get(`${path(other)}/management`)).status).toBe(403);
    expect(deps.company).not.toHaveBeenCalled();
  });
  it("inactive administrator membership is not management authority", async () => {
    const { app } = setup({ ...manager, memberships: [{ companyId: company, membershipRole: "admin", status: "suspended" }] });
    expect((await request(app).get(`${path()}/management`)).status).toBe(403);
  });
  it("workspace admin gets native links, missing service state, no instance settings", async () => {
    const { app } = setup();
    const res = await request(app).get(`${path()}/management`);
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.body.data.links.agents).toBe("/DEMO/agents/all");
    expect(res.body.data.links).not.toHaveProperty("instance");
    expect(res.body.data.brain.state).toBe("dependency_missing");
    expect(res.body.data.base.state).toBe("restricted");
  });
  it("active delegated manager uses existing permission without becoming instance admin", async () => {
    const { app, deps } = setup(member);
    vi.mocked(deps.canManage).mockResolvedValue(true);
    const res = await request(app).get(`${path()}/management`);
    expect(res.status).toBe(200);
    expect(res.body.data.can_manage_instance).toBe(false);
  });
  it("logout or role revocation affects the next request", async () => {
    const { app, state } = setup();
    expect((await request(app).get(`${path()}/management`)).status).toBe(200);
    state.actor = member;
    expect((await request(app).get(`${path()}/management`)).status).toBe(403);
    state.actor = { type: "none" };
    expect((await request(app).get(`${path()}/management`)).status).toBe(401);
  });
  it("instance admin receives allowlisted status instead of provider secrets", async () => {
    const { app, deps } = setup({ ...manager, isInstanceAdmin: true });
    vi.mocked(deps.modelStatus).mockResolvedValue({ state: "ready", model: "test-model", checkedAt: "2026-10-25T00:00:00Z" });
    const res = await request(app).get(`${path()}/management`);
    expect(res.body.data.base).toMatchObject({ state: "ready", model: "test-model" });
    expect(res.body.data.links.instance).toBe("/DEMO/company/settings/instance/access");
  });
  it("model test is instance-only and ignores browser-provided upstream URLs", async () => {
    const { app, deps } = setup();
    expect((await request(app).post(`${path()}/base/test`).send({})).status).toBe(403);
    expect(deps.modelTest).not.toHaveBeenCalled();
    const admin = setup({ ...manager, isInstanceAdmin: true });
    expect((await request(admin.app).post(`${path()}/base/test`).send({ url: "http://other" })).status).toBe(400);
    expect(admin.deps.modelTest).not.toHaveBeenCalled();
  });
  it("model test records only a bounded result in audit", async () => {
    const { app, deps } = setup({ ...manager, isInstanceAdmin: true });
    const res = await request(app).post(`${path()}/base/test`).send({});
    expect(res.status).toBe(200);
    expect(res.body.data.text).toBe("OK");
    expect(deps.audit).toHaveBeenCalledWith(expect.anything(), company, "morbit.model_tested", { model: "test-model" });
  });
  it("employee wiki read is scoped; manager actions cannot inject another company", async () => {
    const { app, deps } = setup(member);
    vi.mocked(deps.wiki).mockResolvedValue({ id: "wiki-plugin", status: "ready", version: "0.1.0" });
    const res = await request(app).post(`${path()}/brain/read`).send({ key: "pages", params: { companyId: other } });
    expect(res.status).toBe(400);
    expect(deps.wikiCall).not.toHaveBeenCalled();
    expect((await request(app).post(`${path()}/brain/action`).send({ key: "write-page", params: {} })).status).toBe(403);
  });
  it("rejects arbitrary plugin operations and reports missing plugin", async () => {
    const { app, deps } = setup();
    expect((await request(app).post(`${path()}/brain/read`).send({ key: "admin-secrets" })).status).toBe(400);
    expect((await request(app).post(`${path()}/brain/read`).send({ key: "overview" })).status).toBe(503);
    expect(deps.wikiCall).not.toHaveBeenCalled();
  });
  it("lists only currently authorized management workspaces", async () => {
    const { app, state } = setup();
    const res = await request(app).get("/api/morbit/workspaces");
    expect(res.body.data.workspaces).toEqual([expect.objectContaining({company_id: company})]);
    state.actor = member;
    expect((await request(app).get("/api/morbit/workspaces")).body.data.workspaces).toEqual([]);
  });
  it("management document denies anonymous and employees before serving assets", async () => {
    for (const [actor, status] of [[{type:"none"},401], [member,403]] as const) {
      expect((await request(setup(actor).app).get("/management/")).status).toBe(status);
    }
    expect((await request(setup().app).get("/management/")).status).toBe(503);
  });
  it("serves HTML and hashed assets only to an authorized manager", async () => {
    const directory = await mkdtemp(join(tmpdir(), "morbit-management-"));
    try {
      await writeFile(join(directory, "index.html"), "<!doctype html><title>mDeck</title>");
      await mkdir(join(directory, "_next/static/chunks"), { recursive: true });
      await writeFile(join(directory, "_next/static/chunks/app-abc123.js"), "window.__MDECK__=true;");
      const managerApp = setup(manager, directory).app;
      const html = await request(managerApp).get("/management/");
      const asset = await request(managerApp).get("/management/_next/static/chunks/app-abc123.js");
      expect(html.status).toBe(200);
      expect(html.text).toContain("<title>mDeck</title>");
      expect(asset.status).toBe(200);
      expect(asset.text).toContain("window.__MDECK__=true");
      expect((await request(setup({ type: "none" }, directory).app).get("/management/")).status).toBe(401);
      expect((await request(setup(member, directory).app).get("/management/_next/static/chunks/app-abc123.js")).status).toBe(403);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  it("propagates authenticated actor to Wiki operations", async () => {
    const { app, deps } = setup();
    vi.mocked(deps.wiki).mockResolvedValue({id:"wiki-plugin",status:"ready",version:"0.1.0"});
    const res = await request(app).post(`${path()}/brain/read`).send({key:"pages",params:{}});
    expect(res.status).toBe(200);
    expect(deps.wikiCall).toHaveBeenCalledWith("pages", {companyId:company}, false, "wiki-plugin", expect.objectContaining({actor:expect.objectContaining({userId:"manager"})}));
  });

  it("employee cannot bypass management restrictions through native Wiki bridges", async () => {
    const { app, deps } = setup(member);
    vi.mocked(deps.wiki).mockResolvedValue({id:"wiki-uuid",status:"ready",version:"1"});
    for (const [url, body] of [
      ["actions/write-page", {companyId:company,params:{}}],
      ["bridge/action", {companyId:company,key:"capture-source",params:{}}],
      ["bridge/action/", {companyId:company,key:"capture-source",params:{}}],
      ["Bridge/Action", {companyId:company,key:"capture-source",params:{}}],
      ["Actions/write-page", {companyId:company,params:{}}],
      ["api/sources", {companyId:company,title:"No"}],
      ["API/sources", {companyId:company,title:"No"}],
    ] as const) {
      expect((await request(app).post(`/api/plugins/wiki-uuid/${url}`).send(body)).status).toBe(403);
    }
    expect((await request(app).post("/api/plugins/paperclipai.plugin-llm-wiki/actions/write-page").send({companyId:company})).status).toBe(403);
  });
  it("native Wiki guard preserves manager operations and unrelated plugin routes", async () => {
    const { app, deps } = setup();
    vi.mocked(deps.wiki).mockResolvedValue({id:"wiki-uuid",status:"ready",version:"1"});
    expect((await request(app).post("/api/plugins/wiki-uuid/actions/write-page").send({companyId:company})).status).toBe(200);
    expect((await request(setup(member).app).post("/api/plugins/unrelated/actions/write-page").send({})).status).toBe(200);
  });

  it("links the bundled Wiki to its existing workspace route", async () => {
    const {app,deps} = setup();
    vi.mocked(deps.wiki).mockResolvedValue({id:"wiki-uuid",status:"ready",version:"1"});
    const result=await request(app).get(path()+"/management");
    expect(result.body.data.links.wiki).toBe("/DEMO/wiki");
  });

  it("protects native Wiki folder configuration using the workspace in the URL", async () => {
    for (const actor of [member, manager]) {
      const {app, deps} = setup(actor);
      vi.mocked(deps.wiki).mockResolvedValue({id:"wiki-uuid",status:"ready",version:"1"});
      const folder = `/api/plugins/wiki-uuid/companies/${company}/local-folders/wikiRoot`;
      expect((await request(app).put(folder).send({path:"/paperclip/wiki"})).status).toBe(actor === member ? 403 : 200);
      expect((await request(app).post(folder + "/validate").send({path:"/paperclip/wiki"})).status).toBe(actor === member ? 403 : 200);
      expect((await request(app).put(`/api/plugins/wiki-uuid/companies/${other}/local-folders/wikiRoot`)
        .send({companyId:company,path:"/paperclip/wiki"})).status).toBe(403);
    }
  });

  it("employee cannot use the board tool dispatcher to write Wiki content", async () => {
    const { app } = setup(member);
    const body = {tool:"paperclipai.plugin-llm-wiki:wiki_write_page",runContext:{companyId:company},parameters:{}};
    expect((await request(app).post("/api/plugins/tools/execute").send(body)).status).toBe(403);
    expect((await request(app).post("/api/plugins/tools/execute").send({...body,tool:"paperclipai.plugin-llm-wiki:wiki_search"})).status).toBe(200);
    expect((await request(setup().app).post("/api/plugins/tools/execute").send(body)).status).toBe(200);
  });

});
