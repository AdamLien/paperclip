// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { crewChromeRequest } from "./crew-chrome";
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
it("keeps a cold Chrome startup pending until its correlated response arrives", async () => {
  vi.useFakeTimers();
  const spy = vi.spyOn(window, "postMessage").mockImplementation(() => {});
  const promise = crewChromeRequest("app-start", { target: "new" });
  const result = expect(promise).resolves.toEqual({ version: 2, target: null });
  const request = spy.mock.calls[0][0] as { id: string };
  await vi.advanceTimersByTimeAsync(43000);
  window.dispatchEvent(new MessageEvent("message", { source: window, origin: location.origin, data: {
    channel: "mcrew-chrome-v2", direction: "response", id: request.id, result: { version: 2, target: null },
  } }));
  await result;
});
it("bounds startup waiting and explains the startup failure separately from installation", async () => {
  vi.useFakeTimers();
  vi.spyOn(window, "postMessage").mockImplementation(() => {});
  const result = expect(crewChromeRequest("app-start")).rejects.toThrow("Chrome 分頁啟動逾時");
  await vi.advanceTimersByTimeAsync(60000);
  await result;
});
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
