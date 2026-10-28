// @vitest-environment jsdom

import type { ReactNode } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Dashboard } from "./Dashboard";

const mockIsManager = vi.hoisted(() => vi.fn<() => boolean | undefined>());

vi.mock("@/lib/router", () => ({
  Link: ({ children, to, ...props }: { children: ReactNode; to: string }) => (
    <a href={to} {...props}>{children}</a>
  ),
  useLocation: () => ({ pathname: "/MET/dashboard", search: "", hash: "", state: null }),
}));
vi.mock("../context/CompanyContext", () => ({
  useCompany: () => ({ selectedCompanyId: "company-1", companies: [{ id: "company-1" }] }),
}));
vi.mock("../context/DialogContext", () => ({ useDialogActions: () => ({ openOnboarding: vi.fn() }) }));
vi.mock("../context/BreadcrumbContext", () => ({ useBreadcrumbs: () => ({ setBreadcrumbs: vi.fn() }) }));
vi.mock("../hooks/useSharedPolling", () => ({
  useSharedPollingQuery: () => ({}),
  usePublishSharedQueryData: () => {},
}));
vi.mock("../hooks/useCompanyManagerAccess", () => ({ useIsCompanyManager: () => mockIsManager() }));
vi.mock("../components/EmployeeHome", () => ({ EmployeeHome: () => <div data-testid="employee-home" /> }));
vi.mock("../components/ActiveAgentsPanel", () => ({ ActiveAgentsPanel: () => null }));
vi.mock("../components/SmokeLabDashboardCard", () => ({ SmokeLabDashboardCard: () => null }));
vi.mock("../components/ActivityCharts", () => ({
  ChartCard: () => null,
  RunActivityChart: () => null,
  PriorityChart: () => null,
  IssueStatusChart: () => null,
  SuccessRateChart: () => null,
}));
vi.mock("@/plugins/slots", () => ({ PluginSlotOutlet: () => null }));
vi.mock("../api/dashboard", () => ({
  dashboardApi: {
    summary: vi.fn().mockResolvedValue({
      agents: { active: 0, running: 0, paused: 2, error: 0 },
      tasks: { open: 1, inProgress: 0, blocked: 0, done: 0 },
      costs: { monthSpendCents: 1200, monthBudgetCents: 0, monthUtilizationPercent: 0 },
      pendingApprovals: 2,
      budgets: { activeIncidents: 0, pendingApprovals: 0, pausedAgents: 0, pausedProjects: 0 },
      runActivity: [],
    }),
  },
}));
vi.mock("../api/agents", () => ({
  agentsApi: {
    list: vi.fn().mockResolvedValue([
      { id: "agent-1", name: "Writer", status: "paused", pauseReason: "manual" },
      { id: "agent-2", name: "Analyst", status: "paused", pauseReason: "manual" },
    ]),
  },
}));
vi.mock("../api/activity", () => ({ activityApi: { list: vi.fn().mockResolvedValue([]) } }));
vi.mock("../api/issues", () => ({ issuesApi: { list: vi.fn().mockResolvedValue([]) } }));
vi.mock("../api/projects", () => ({ projectsApi: { list: vi.fn().mockResolvedValue([]) } }));
vi.mock("../api/access", () => ({ accessApi: { listUserDirectory: vi.fn().mockResolvedValue({ users: [] }) } }));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

async function settle() {
  for (let i = 0; i < 5; i++) {
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    flushSync(() => {});
  }
}

describe("Dashboard home by role", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    flushSync(() => root.unmount());
    container.remove();
  });

  async function render() {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    flushSync(() => root.render(
      <QueryClientProvider client={queryClient}>
        <Dashboard />
      </QueryClientProvider>,
    ));
    await settle();
  }

  it("gives an employee the personal home without management figures", async () => {
    mockIsManager.mockReturnValue(false);
    await render();
    expect(container.querySelector("[data-testid='employee-home']")).not.toBeNull();
    const text = container.textContent ?? "";
    expect(text).not.toContain("All agents in this organization are paused");
    expect(text).not.toContain("Pending Approvals");
    expect(text).not.toContain("Month Spend");
  });

  it("keeps the management dashboard for owners and admins", async () => {
    mockIsManager.mockReturnValue(true);
    await render();
    expect(container.querySelector("[data-testid='employee-home']")).toBeNull();
    const text = container.textContent ?? "";
    expect(text).toContain("All agents in this organization are paused");
    expect(text).toContain("Pending Approvals");
  });

  it("shows neither home until the role is known", async () => {
    mockIsManager.mockReturnValue(undefined);
    await render();
    expect(container.querySelector("[data-testid='employee-home']")).toBeNull();
    expect(container.textContent).not.toContain("Pending Approvals");
  });
});
