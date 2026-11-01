// @vitest-environment jsdom

import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { createElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockAgentsApi = vi.hoisted(() => ({
  visibility: vi.fn(),
  updateVisibility: vi.fn(),
}));
const mockAccessApi = vi.hoisted(() => ({ listMembers: vi.fn() }));
const pushToast = vi.hoisted(() => vi.fn());

vi.mock("../api/agents", () => ({ agentsApi: mockAgentsApi }));
vi.mock("../api/access", () => ({ accessApi: mockAccessApi }));
vi.mock("../context/ToastContext", () => ({ useToastActions: () => ({ pushToast }) }));

import { AgentPartnerAccess } from "./AgentPartnerAccess";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function settle() {
  for (let i = 0; i < 4; i += 1) {
    flushSync(() => undefined);
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  }
}

function member(principalId: string, membershipRole: string, name: string) {
  return {
    principalId,
    membershipRole,
    status: "active",
    user: { id: principalId, name, email: `${principalId}@example.com`, image: null },
  };
}

describe("AgentPartnerAccess", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    mockAccessApi.listMembers.mockResolvedValue({
      members: [member("boss", "owner", "Boss"), member("staff", "operator", "Staff"), member("cashier", "operator", "Cashier")],
    });
    mockAgentsApi.updateVisibility.mockImplementation(async (_id, data) => data);
  });

  afterEach(() => {
    root.unmount();
    container.remove();
    vi.clearAllMocks();
  });

  async function render() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    flushSync(() => {
      root.render(
        createElement(QueryClientProvider, { client }, createElement(AgentPartnerAccess, { agentId: "agent-1", companyId: "company-1" })),
      );
    });
    await settle();
  }

  it("restricts a partner to the members the manager selects", async () => {
    mockAgentsApi.visibility.mockResolvedValue({ mode: "discoverable", allowedUserIds: [] });
    await render();

    expect(container.textContent).toContain("Everyone in this workspace");
    const [, onlySelected] = Array.from(container.querySelectorAll<HTMLInputElement>("input[type=radio]"));
    flushSync(() => onlySelected!.click());
    await settle();

    // Owners and admins always see the partner, so only other members are offered.
    expect(container.textContent).not.toContain("Boss");
    const boxes = Array.from(container.querySelectorAll<HTMLButtonElement>("[data-slot=checkbox]"));
    expect(boxes).toHaveLength(2);
    flushSync(() => boxes[1]!.click());
    await settle();

    const saveButton = Array.from(container.querySelectorAll("button")).find((b) => b.textContent === "Save access")!;
    flushSync(() => saveButton.click());
    await settle();

    expect(mockAgentsApi.updateVisibility).toHaveBeenCalledWith(
      "agent-1",
      { mode: "private", allowedUserIds: ["cashier"] },
      "company-1",
    );
  });

  it("opens a private partner back up to everyone", async () => {
    mockAgentsApi.visibility.mockResolvedValue({ mode: "private", allowedUserIds: ["staff"] });
    await render();

    const [everyone] = Array.from(container.querySelectorAll<HTMLInputElement>("input[type=radio]"));
    flushSync(() => everyone!.click());
    await settle();
    const saveButton = Array.from(container.querySelectorAll("button")).find((b) => b.textContent === "Save access")!;
    flushSync(() => saveButton.click());
    await settle();

    expect(mockAgentsApi.updateVisibility).toHaveBeenCalledWith(
      "agent-1",
      { mode: "discoverable", allowedUserIds: [] },
      "company-1",
    );
  });
});
