// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import PdfAttachmentPreview from "./PdfAttachmentPreview";

const mock = vi.hoisted(() => ({ getDocument: vi.fn(), getPage: vi.fn(), destroy: vi.fn(async () => {}) }));
vi.mock("pdfjs-dist", () => ({ GlobalWorkerOptions: {}, getDocument: mock.getDocument }));
vi.mock("pdfjs-dist/build/pdf.worker.min.mjs?url", () => ({ default: "/pdf-worker.mjs" }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("renders pages inside the app, bounds navigation, and destroys the loading task on close", async () => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({} as CanvasRenderingContext2D);
  mock.getPage.mockResolvedValue({ getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale }), render: () => ({ promise: Promise.resolve(), cancel() {} }) });
  mock.getDocument.mockReturnValue({ promise: Promise.resolve({ numPages: 2, getPage: mock.getPage }), destroy: mock.destroy });
  const host = document.createElement("div"); const root = createRoot(host);
  await act(async () => root.render(<PdfAttachmentPreview url="/api/attachments/id/content?preview=pdf" title="簡報" />));
  expect(mock.getDocument).toHaveBeenCalledWith(expect.objectContaining({ withCredentials: true, isEvalSupported: false, enableXfa: false }));
  expect(host.textContent).toContain("1 / 2 頁");
  expect(host.querySelector("canvas")?.hidden).toBe(false);
  expect(host.querySelector<HTMLButtonElement>('[aria-label="上一頁"]')?.disabled).toBe(true);
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="下一頁"]')!.click());
  expect(mock.getPage).toHaveBeenLastCalledWith(2);
  expect(host.textContent).toContain("2 / 2 頁");
  expect(host.querySelector<HTMLButtonElement>('[aria-label="下一頁"]')?.disabled).toBe(true);
  await act(async () => root.unmount());
  expect(mock.destroy).toHaveBeenCalled();
});

it("shows a retry action after failure without triggering a download", async () => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  mock.getDocument.mockReturnValue({ promise: Promise.reject(new Error("conversion unavailable")), destroy: mock.destroy });
  const host = document.createElement("div"); const root = createRoot(host);
  await act(async () => root.render(<PdfAttachmentPreview url="/api/attachments/id/content?preview=pdf" title="簡報" />));
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("無法載入預覽");
  expect(host.textContent).toContain("重新載入");
  expect(host.querySelector("a")).toBeNull();
  await act(async () => root.unmount());
});
