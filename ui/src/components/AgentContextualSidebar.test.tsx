// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { setLocale } from "@/i18n";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { AgentContextualSidebar } from "./AgentContextualSidebar";
import { queryKeys } from "@/lib/queryKeys";

vi.mock("@/context/CompanyContext", () => ({
  useCompany: () => ({ selectedCompanyId: "company-1" }),
}));

vi.mock("./ContextualSidebarFrame", () => ({
  ContextualSidebarFrame: ({
    title,
    showHeader,
    className,
    children,
  }: {
    title: string;
    showHeader?: boolean;
    className?: string;
    children: React.ReactNode;
  }) => (
    <aside data-title={title} data-show-header={String(showHeader)} className={className}>
      {children}
    </aside>
  ),
}));

vi.mock("./SidebarNavItem", () => ({
  SidebarNavItem: ({ to, label }: { to: string; label: string }) => <a href={to}>{label}</a>,
}));

describe("AgentContextualSidebar", () => {
  it.each([false, true])("keeps Channels available for default email regardless of the chat setting (%s)", (enabled) => {
    const client = new QueryClient();
    client.setQueryData(queryKeys.instance.experimentalSettings, { enableChatConnectors: enabled });
    const markup = renderToStaticMarkup(<QueryClientProvider client={client}><MemoryRouter>
      <AgentContextualSidebar agentRef="agent" agentId="agent-1" agentName="Agent" />
    </MemoryRouter></QueryClientProvider>);
    expect(markup.includes('href="/agents/agent/channels"')).toBe(true);
    expect(markup).toContain('href="/agents/agent/tools"');
    client.clear();
  });
  it("renders local definition/runtime/governance links and scoped Audit links", () => {
    const queryClient = new QueryClient();
    const markup = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/agents/codexcoder/runtime"]}>
          <AgentContextualSidebar agentRef="codexcoder" agentId="agent-1" agentName="Codex Coder" />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(markup).toContain("Codex Coder");
    expect(markup).toContain('data-show-header="false"');
    expect(markup).toContain("border-r border-border bg-background");
    expect(markup).toContain('data-slot="contextual-sidebar-nav"');
    expect(markup).toContain('href="/agents/codexcoder/overview"');
    expect(markup).toContain('href="/agents/codexcoder/permissions"');
    expect(markup).toContain('href="/agents/codexcoder/api-keys"');
    expect(markup).toContain('href="/activity?mode=agents&amp;agentId=agent-1"');
    expect(markup).toContain('href="/activity/runs?agentId=agent-1"');
    expect(markup).toContain("Harness / Runtime");
    expect(markup).toContain("Permissions / Trust");
  });
});


it("switches agent navigation labels live while preserving agent names and route targets", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  setLocale("en");
  const client = new QueryClient();
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<QueryClientProvider client={client}><MemoryRouter>
      <AgentContextualSidebar agentRef="steve" agentId="agent-1" agentName="Steve Rogers" />
    </MemoryRouter></QueryClientProvider>));
    const routes = [...host.querySelectorAll("a")].map(a => a.getAttribute("href"));
    expect(host.textContent).toContain("Overview");
    await act(async () => { setLocale("zh-TW"); });
    for (const label of ["概覽", "指示", "技能", "執行程式／執行環境", "金鑰與環境變數", "通訊管道", "權限與信任設定", "版本紀錄", "執行記錄"])
      expect(host.textContent).toContain(label);
    expect([...host.querySelectorAll("a")].map(a => a.getAttribute("href"))).toEqual(routes);
    expect(host.querySelector("aside")?.getAttribute("data-title")).toBe("Steve Rogers");
    await act(async () => { setLocale("en"); });
    expect(host.textContent).toContain("Overview");
  } finally {
    await act(async () => root.unmount());
    setLocale("en");
    host.remove();
    client.clear();
  }
});
