// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setLocale } from ".";
import { MembershipAction } from "../components/MembershipAction";
import { StarToggle } from "../components/StarToggle";
import { MobileBottomNav } from "../components/MobileBottomNav";
import { CompanySettingsNav } from "../components/access/CompanySettingsNav";
import { ModeBadge } from "../components/access/ModeBadge";
import { InteractionGovernancePanel } from "../components/InteractionGovernancePanel";
import { TooltipProvider } from "../components/ui/tooltip";

const state = vi.hoisted(() => ({ mobile: true, navigate: vi.fn(), newTask: vi.fn() }));
vi.mock("@/lib/router", () => ({
  useLocation: () => ({ pathname: "/company/settings" }),
  useNavigate: () => state.navigate,
  NavLink: ({ to, children }: { to: string; children: unknown }) => (
    <a href={to}>{typeof children === "function" ? children({ isActive: false }) : children as never}</a>
  ),
}));
vi.mock("../context/CompanyContext", () => ({ useCompany: () => ({ selectedCompanyId: "company" }) }));
vi.mock("../context/DialogContext", () => ({ useDialogActions: () => ({ openNewIssue: state.newTask }) }));
vi.mock("../context/SidebarContext", () => ({ useSidebar: () => ({ isMobile: state.mobile }) }));
vi.mock("../hooks/useInboxBadge", () => ({ useInboxBadge: () => ({ inbox: 3 }) }));
vi.mock("../hooks/useAgentChatEnabled", () => ({ useAgentChatEnabled: () => ({ enabled: false }) }));
vi.mock("../hooks/useCombinedInboxTasksEnabled", () => ({ useCombinedInboxTasksEnabled: () => ({ enabled: false }) }));
vi.mock("../hooks/useFastResponsesEnabled", () => ({ useFastResponsesEnabled: () => ({ enabled: false }) }));
vi.mock("../hooks/useCloudInstance", () => ({ useCloudInstance: () => null }));
vi.mock("../hooks/useHiddenSettings", () => ({ useHiddenSettings: () => ({ hidden: new Set() }) }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let root: Root;
async function render(children: React.ReactNode) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => { root.render(<TooltipProvider>{children}</TooltipProvider>); });
}
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  host?.remove();
  setLocale("en");
  vi.clearAllMocks();
});

describe("Taiwan settings and navigation integration", () => {
  it("switches mobile navigation without changing routes, badge or create action", async () => {
    setLocale("en");
    await render(<MobileBottomNav visible />);
    expect(host.textContent).toContain("Home");
    await act(async () => { setLocale("zh-TW"); });
    expect([...host.querySelectorAll("a")].map(a => a.textContent)).toEqual(["首頁", "任務", "AI 代理", "3收件匣"]);
    expect([...host.querySelectorAll("a")].map(a => a.getAttribute("href"))).toEqual(["/dashboard", "/issues", "/agents/all", "/inbox"]);
    await act(async () => host.querySelector("button")?.click());
    expect(state.newTask).toHaveBeenCalledOnce();
    await act(async () => { setLocale("en"); });
    expect(host.textContent).toContain("New Task");
  });

  it("shows translated settings tabs and preserves their internal navigation values", async () => {
    setLocale("zh-TW");
    await render(<CompanySettingsNav />);
    const select = host.querySelector("select")!;
    expect(select.selectedOptions[0].textContent).toBe("一般設定");
    expect([...select.options].map(o => o.textContent)).toContain("執行環境");
    await act(async () => { select.value = "members"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(state.navigate).toHaveBeenCalledWith("/company/settings/members");
    await act(async () => { setLocale("en"); });
    expect(select.options[0].textContent).toBe("General");
  });

  it("localizes policy values while keeping governance data and callbacks unchanged", async () => {
    const onChange = vi.fn();
    const governance = { request_confirmation: { defaultPolicy: "human_only" as const, cap: "not_creator" as const } };
    setLocale("en");
    await render(<InteractionGovernancePanel governance={governance} onChange={onChange} />);
    await act(async () => { setLocale("zh-TW"); });
    expect(host.textContent).toContain("建議任務");
    expect(host.querySelector('[data-testid="governance-request_confirmation-default"]')?.textContent).toBe("僅限真人");
    expect(host.querySelector('[data-testid="governance-request_confirmation-cap"]')?.textContent).toBe("提出請求的代理以外皆可");
    expect(host.querySelector('[data-testid="governance-suggest_tasks-default"]')?.getAttribute("aria-label")).toBe("建議任務：預設回覆對象");
    expect(governance.request_confirmation).toEqual({ defaultPolicy: "human_only", cap: "not_creator" });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("shows a readable deployment mode and restores English on locale switch", async () => {
    setLocale("zh-TW");
    await render(<ModeBadge deploymentMode="authenticated" deploymentExposure="public" />);
    expect(host.textContent).toBe("公開存取（需登入）");
    await act(async () => { setLocale("en"); });
    expect(host.textContent).toBe("Authenticated public");
  });
});


it("localizes membership controls while preserving the resource name and callbacks", async () => {
  const leave = vi.fn(); const star = vi.fn();
  setLocale("en");
  await render(<><MembershipAction state="joined" resourceName="Chief of staff" onJoin={vi.fn()} onLeave={leave} /><StarToggle starred={false} resourceName="Chief of staff" onToggle={star} /></>);
  await act(async () => { setLocale("zh-TW"); });
  const leaveButton = host.querySelector<HTMLButtonElement>('button[aria-label="退出 Chief of staff"]');
  const starButton = host.querySelector<HTMLButtonElement>('button[aria-label="收藏 Chief of staff"]');
  expect(leaveButton?.textContent).toContain("退出"); expect(starButton).not.toBeNull();
  await act(async () => { leaveButton!.click(); starButton!.click(); });
  expect(leave).toHaveBeenCalledOnce(); expect(star).toHaveBeenCalledWith(true);
});
