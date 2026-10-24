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
    expect(await a.status()).toEqual({state:"unverified"});
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
});
