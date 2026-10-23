// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { crewChromeRequest } from "./crew-chrome";
it("ignores spoofed companion replies and accepts only the correlated same-origin response", async () => {
  const spy = vi.spyOn(window, "postMessage").mockImplementation(() => {});
  const promise = crewChromeRequest("app-status");
  const request = spy.mock.calls[0][0] as { id: string };
  const data = { channel: "mcrew-chrome-v2", direction: "response", id: request.id, result: { version: 2, target: null } };
  let resolved = false; void promise.then(() => { resolved = true; });
  window.dispatchEvent(new MessageEvent("message", { source: window, origin: "https://evil.example", data }));
  window.dispatchEvent(new MessageEvent("message", { source: window, origin: location.origin, data: { ...data, id: "wrong" } }));
  await Promise.resolve(); expect(resolved).toBe(false);
  window.dispatchEvent(new MessageEvent("message", { source: window, origin: location.origin, data }));
  await expect(promise).resolves.toEqual({ version: 2, target: null }); spy.mockRestore();
});
