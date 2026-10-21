// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MobileBottomNav } from "./MobileBottomNav";

const state = vi.hoisted(() => ({ company: "metabiz", user: "adam", enabled: true, newTask: vi.fn() }));
vi.mock("@/context/CompanyContext", () => ({ useCompany: () => ({ selectedCompanyId: state.company }) }));
vi.mock("@/context/DialogContext", () => ({ useDialogActions: () => ({ openNewIssue: state.newTask }) }));
vi.mock("@/hooks/useAgentChatEnabled", () => ({ useAgentChatEnabled: () => ({ enabled: state.enabled }) }));
vi.mock("@/hooks/useCombinedInboxTasksEnabled", () => ({ useCombinedInboxTasksEnabled: () => ({ enabled: false }) }));
vi.mock("@/hooks/useInboxBadge", () => ({ useInboxBadge: () => ({ inbox: 0 }) }));
vi.mock("@/i18n/LegacyLiteralLocalizer", () => ({ useUiLiteralLocale: () => {}, translateUiLiteral: (s: string) => s }));
vi.mock("@/api/auth", () => ({ authApi: { getSession: async () => ({ user: { id: state.user } }) } }));
vi.mock("@/api/agents", () => ({ agentsApi: { list: async () => [{
  id: "sammi", name: "sammi", urlKey: "sammi", companyId: "metabiz", status: "idle",
  metadata: { personalAssistantForUserIds: ["adam"] },
}] } }));
vi.mock("@/lib/router", () => ({
  useLocation: () => ({ pathname: "/dashboard" }),
  NavLink: ({ to, children }: { to: string; children: (s: {isActive: boolean}) => React.ReactNode }) =>
    <a href={`/${state.company}/${to.replace(/^\//, "")}`}>{children({ isActive: false })}</a>,
}));
let root: Root;
let container: HTMLDivElement;
let client: QueryClient;
async function render() {
  await act(async () => {
    root.render(<QueryClientProvider client={client}><MobileBottomNav visible /></QueryClientProvider>);
  });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.company = "metabiz"; state.user = "adam"; state.enabled = true; state.newTask.mockReset();
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); container.remove(); vi.unstubAllGlobals(); });
it("opens the secretary conversation directly without a task form and keeps five destinations", async () => {
  await render();
  const shortcut = Array.from(container.querySelectorAll("a")).find(a => a.textContent === "我的秘書");
  expect(shortcut?.getAttribute("href")).toBe("/metabiz/chats/sammi");
  expect(container.querySelectorAll("a")).toHaveLength(5);
  expect(state.newTask).not.toHaveBeenCalled();
});
it("removes the shortcut immediately after company changes, including stale roster responses", async () => {
  await render(); state.company = "sendheart"; await render();
  expect(container.textContent).not.toContain("我的秘書");
});
it("never displays Adam's secretary for a different signed-in user", async () => {
  state.user = "customer"; await render(); expect(container.textContent).not.toContain("我的秘書");
});
it("respects the existing server feature gate", async () => {
  state.enabled = false; await render(); expect(container.textContent).not.toContain("我的秘書");
  expect(container.textContent).toContain("New Task");
});
