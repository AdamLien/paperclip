// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { BrowserWorkspace } from "./BrowserWorkspace";
import { applyCompanyPrefix, toCompanyRelativePath } from "@/lib/company-routes";
const mock = vi.hoisted(() => ({ company: "company-a", get: vi.fn(), post: vi.fn(), delete: vi.fn(), breadcrumbs: vi.fn() }));
vi.mock("@/context/CompanyContext", () => ({ useCompany: () => ({ selectedCompanyId: mock.company }) }));
vi.mock("@/context/BreadcrumbContext", () => ({ useBreadcrumbs: () => ({ setBreadcrumbs: mock.breadcrumbs }) }));
vi.mock("@/api/client", () => ({ api: { get: mock.get, post: mock.post, delete: mock.delete } }));
vi.mock("@/lib/router", () => ({ Link: ({ to, children, ...props }: any) => <a href={to} {...props}>{children}</a> }));
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => { mock.company = "company-a"; vi.clearAllMocks(); document.body.innerHTML = ""; });

it("keeps the browser sidebar entry and company switching in the selected company", () => {
  expect(applyCompanyPrefix("/browser", "META")).toBe("/META/browser");
  expect(toCompanyRelativePath("/META/browser")).toBe("/browser");
});

it("shows waiting until relay evidence, clears the pairing when company changes, and supports stopping", async () => {
  const session = { id: "session", issueId: "task", agentId: "agent", mode: "chrome", label: "我的 Mac Chrome", status: "waiting", frame: null, url: "", title: "" };
  mock.get.mockImplementation(async (path: string) => path.endsWith("/issues") ? [{ id: "task", identifier: "META-1", title: "工作", assigneeAgentId: "agent" }] : path.endsWith("/session") ? session : [session]);
  mock.post.mockResolvedValue({ ...session, pairingToken: "test-pairing" }); mock.delete.mockResolvedValue({ stopped: true });
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  const render = () => root.render(<QueryClientProvider client={cache}><BrowserWorkspace /></QueryClientProvider>);
  await act(async () => { render(); });
  await vi.waitFor(() => expect(host.querySelectorAll("option").length).toBe(2));
  await act(async () => { const select = host.querySelector("select")!; select.value = "task"; select.dispatchEvent(new Event("change", { bubbles: true })); });
  const button = (text: string) => [...host.querySelectorAll<HTMLButtonElement>("button")].find(b => b.textContent?.includes(text))!;
  await act(async () => button("建立分頁配對").click());
  await vi.waitFor(() => expect(host.querySelector<HTMLInputElement>('[aria-label="分頁配對碼"]')?.value).toBe("test-pairing"));
  expect(host.textContent).toContain("等待 Chrome 分享分頁");
  expect(host.querySelector("img")).toBeNull();
  expect(host.textContent).toContain("尚未連線");
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
  await vi.waitFor(() => expect(button("停止控制")).toBeDefined());
  await act(async () => button("停止控制").click());
  await vi.waitFor(() => expect(mock.delete).toHaveBeenCalledWith("/companies/company-a/browser-workspace/session"));
  await act(async () => button("建立分頁配對").click());
  mock.company = "company-b";
  await act(async () => render());
  expect(host.querySelector('[aria-label="分頁配對碼"]')).toBeNull();
  expect(host.querySelector("img")).toBeNull();
  await act(async () => root.unmount()); cache.clear();
});
