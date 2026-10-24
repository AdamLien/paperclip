// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MorbitWelcome } from "./MorbitWelcome";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root;
let host: HTMLDivElement;
afterEach(() => { act(() => root?.unmount()); host?.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });
function mount(reduced = false) {
  vi.useFakeTimers();
  vi.stubGlobal("matchMedia", () => ({ matches: reduced, addEventListener() {}, removeEventListener() {} }));
  host = document.createElement("div"); document.body.append(host);
  root = createRoot(host); act(() => root.render(<MorbitWelcome />));
}
function click(label: string) {
  const button = [...host.querySelectorAll("button")].find(button => button.textContent === label)!;
  act(() => button.click());
}
describe("welcome carousel", () => {
  it("advances, pauses and allows direct navigation", () => {
    mount();
    expect(host.textContent).toContain("一個人，");
    act(() => vi.advanceTimersByTime(7000));
    expect(host.textContent).toContain("行程排好了");
    click("暫停輪播");
    act(() => vi.advanceTimersByTime(21000));
    expect(host.textContent).toContain("行程排好了");
    click("4"); expect(host.textContent).toContain("你說想法");
    click("播放輪播");
    act(() => vi.advanceTimersByTime(7000));
    expect(host.textContent).toContain("工作有人接");
  });
  it("keeps reduced-motion users in control without autoplay", () => {
    mount(true);
    act(() => vi.advanceTimersByTime(21000));
    expect(host.textContent).toContain("一個人，");
    click("3"); expect(host.textContent).toContain("資料有頭緒");
    expect(host.textContent).toContain("播放輪播");
  });
});
