import { describe, expect, it, vi } from "vitest";
import { createMorbitModelAdapter } from "../services/morbit-base.js";

describe("mBase server-owned OCX connection", () => {
  it("rejects a generic model endpoint without authenticated OCX identity", async () => {
    const fetcher = vi.fn(async () => Response.json({choices:[{message:{content:"OK"}}]}));
    const a = createMorbitModelAdapter({endpoint:"http://127.0.0.1:9999/v1/",model:"demo",readToken:async()=>"secret",readAdminToken:async()=>"admin-secret",fetcher});
    await expect(a.test()).rejects.toThrow("Model test failed");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]).toEqual(["http://127.0.0.1:9999/api/system/health",expect.objectContaining({headers:expect.objectContaining({Authorization:"Bearer admin-secret"})})]);
    expect(await a.status()).toEqual({state:"degraded"});
  });
  it("never infers readiness from configuration alone", async () => {
    const a = createMorbitModelAdapter({ endpoint:"http://127.0.0.1:9999/v1/", model:"demo", readToken:async()=>"secret",readAdminToken:async()=>"admin-secret" });
    expect(await a.status()).toEqual({state:"unverified"});
    expect(await createMorbitModelAdapter({}).status()).toEqual({state:"unconfigured"});
  });
  it("tests a fixed model through OCX and expires successful evidence", async () => {
    let now = 0;
    const fetcher = vi.fn(async (url:string|URL|Request) => Response.json(String(url).endsWith("/api/system/health") ? {status:"ok",service:"opencodex",version:"2.9.1"} : {choices:[{message:{content:"OK"}}]}));
    const a = createMorbitModelAdapter({endpoint:"http://127.0.0.1:9999/v1/",model:"demo",readToken:async()=>"secret",readAdminToken:async()=>"admin-secret",fetcher,now:()=>now});
    expect(await a.test()).toMatchObject({model:"demo",text:"Model returned a non-empty response"});
    expect(fetcher.mock.calls[1]).toEqual(["http://127.0.0.1:9999/v1/chat/completions", expect.objectContaining({redirect:"error",headers:expect.objectContaining({Authorization:"Bearer secret"})})]);
    expect(await a.status()).toMatchObject({state:"ready",model:"demo",version:"2.9.1"});
    now = 301000;
    expect(await a.status()).toMatchObject({state:"unverified",model:"demo",checkedAt:"1970-01-01T00:00:00.000Z"});
  });
  it("does not expose provider responses or token on failure", async () => {
    const a = createMorbitModelAdapter({endpoint:"http://127.0.0.1:9999/v1/",model:"demo",readToken:async()=>"secret",readAdminToken:async()=>"admin-secret",fetcher:async()=>new Response("secret",{status:401})});
    await expect(a.test()).rejects.toThrow("Model authorization required");
    expect(await a.status()).toEqual({state:"authorization_required"});
  });
  it("handles missing token, malformed output and upstream outage truthfully", async () => {
    for (const fetcher of [async()=>Response.json({choices:[]}), async()=>{throw Error("secret network details");}]) {
      const a = createMorbitModelAdapter({endpoint:"http://127.0.0.1:9999/v1/",model:"demo",readToken:async()=>"secret",readAdminToken:async()=>"admin-secret",fetcher});
      await expect(a.test()).rejects.toThrow("Model test failed");
      expect(await a.status()).toEqual({state:"degraded"});
    }
    const a = createMorbitModelAdapter({endpoint:"http://127.0.0.1:9999/v1/",model:"demo",readToken:async()=>{throw Error("secret path");},readAdminToken:async()=>"admin-secret"});
    await expect(a.test()).rejects.toThrow("Model authorization required");
  });
  describe("with Anthropic models routed by OCX", () => {
    const health = {status:"ok",service:"opencodex",version:"2.9.1"};
    function ocx(overrides: {chat?: () => Response; messages?: () => Response} = {}) {
      return vi.fn(async (url:string|URL|Request, _init?: RequestInit) => {
        const path = String(url);
        if (path.endsWith("/api/system/health")) return Response.json(health);
        if (path.endsWith("/chat/completions")) return overrides.chat?.() ?? Response.json({choices:[{message:{content:"OK"}}]});
        return overrides.messages?.() ?? Response.json({content:[{type:"text",text:"OK"}]});
      });
    }
    const base = {endpoint:"http://127.0.0.1:9999/v1",model:"gpt-6.1-sol",readToken:async()=>"secret",readAdminToken:async()=>"admin-secret"};

    it("tests a Claude model through the Messages API alongside the default model", async () => {
      const fetcher = ocx();
      const a = createMorbitModelAdapter({...base,fetcher,listAnthropicModels:async()=>["anthropic/claude-sonnet-5-5"]});
      const result = await a.test();
      expect(result).toMatchObject({model:"gpt-6.1-sol, anthropic/claude-sonnet-5-5",text:"Model returned a non-empty response",
        results:[{model:"gpt-6.1-sol",ok:true},{model:"anthropic/claude-sonnet-5-5",ok:true}]});
      const call = fetcher.mock.calls.find(([url]) => String(url).endsWith("/v1/messages"))!;
      expect(call[1]).toMatchObject({redirect:"error",headers:{Authorization:"Bearer secret","anthropic-version":"2023-06-01"}});
      expect(JSON.parse(String(call[1]!.body))).toMatchObject({model:"anthropic/claude-sonnet-5-5"});
      expect(await a.status()).toMatchObject({state:"ready",model:"gpt-6.1-sol, anthropic/claude-sonnet-5-5"});
    });
    it("reports a responding Claude model even when the default model fails", async () => {
      const a = createMorbitModelAdapter({...base,fetcher:ocx({chat:()=>new Response("upstream secret",{status:500})}),
        listAnthropicModels:async()=>["anthropic/claude-sonnet-5-5"]});
      const result = await a.test();
      expect(result).toMatchObject({model:"anthropic/claude-sonnet-5-5",results:[{model:"gpt-6.1-sol",ok:false},{model:"anthropic/claude-sonnet-5-5",ok:true}]});
      expect(result.text).toBe("Model returned a non-empty response; no response from gpt-6.1-sol");
      expect(JSON.stringify(result)).not.toContain("secret");
    });
    it("tests Anthropic without a configured default model", async () => {
      const a = createMorbitModelAdapter({...base,model:undefined,fetcher:ocx(),listAnthropicModels:async()=>["anthropic/claude-sonnet-5-5"]});
      expect(await a.status()).toEqual({state:"unverified"});
      expect(await a.test()).toMatchObject({model:"anthropic/claude-sonnet-5-5",results:[{model:"anthropic/claude-sonnet-5-5",ok:true}]});
    });
    it("marks an unreadable Anthropic model list as a failed check and skips an empty one", async () => {
      const failing = createMorbitModelAdapter({...base,fetcher:ocx(),listAnthropicModels:async()=>{throw Error("secret");}});
      expect((await failing.test()).results).toEqual([{model:"gpt-6.1-sol",ok:true},{model:"anthropic",ok:false}]);
      const empty = createMorbitModelAdapter({...base,fetcher:ocx(),listAnthropicModels:async()=>[]});
      expect((await empty.test()).results).toEqual([{model:"gpt-6.1-sol",ok:true}]);
    });
    it("requires authorization only when no tested model responds", async () => {
      const denied = () => new Response("secret",{status:401});
      const a = createMorbitModelAdapter({...base,fetcher:ocx({chat:denied,messages:denied}),listAnthropicModels:async()=>["anthropic/claude-sonnet-5-5"]});
      await expect(a.test()).rejects.toThrow("Model authorization required");
      expect(await a.status()).toEqual({state:"authorization_required"});
      const b = createMorbitModelAdapter({...base,fetcher:ocx({messages:()=>Response.json({content:[]})}),listAnthropicModels:async()=>["anthropic/claude-sonnet-5-5"]});
      expect((await b.test()).results).toEqual([{model:"gpt-6.1-sol",ok:true},{model:"anthropic/claude-sonnet-5-5",ok:false}]);
    });
  });
});
