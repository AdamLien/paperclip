// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { setLocale } from ".";
import { StatusIcon } from "../components/StatusIcon";
import { timeAgo } from "../lib/timeAgo";
import { formatDateTime } from "../lib/utils";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

afterEach(() => { setLocale("en"); vi.useRealTimers(); });

it("updates a mounted status label when the locale changes without changing its status", async () => {
  setLocale("en");
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<StatusIcon status="done" showLabel />));
    expect(host.querySelector("span.text-sm")?.textContent).toBe("Done");
    await act(async () => { setLocale("zh-TW"); });
    expect(host.querySelector("span.text-sm")?.textContent).toBe("已完成");
    await act(async () => { setLocale("en"); });
    expect(host.querySelector("span.text-sm")?.textContent).toBe("Done");
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it("formats task dates and elapsed time in Taiwan Chinese while retaining English defaults", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-19T12:00:00Z"));
  const updated = "2026-10-19T11:33:00Z";
  expect(timeAgo(updated, "zh-TW")).toBe("27 分鐘前");
  expect(timeAgo(updated)).toBe("27m ago");
  expect(timeAgo(new Date(), "zh-TW")).toBe("剛剛");
  expect(timeAgo("2026-10-17T12:00:00Z", "zh-TW")).toBe("2 天前");
  expect(formatDateTime(updated, { locale: "zh-TW" })).toBe(new Date(updated).toLocaleString("zh-TW", {
    month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
  }));
  expect(formatDateTime(updated)).toContain("Oct");
});
