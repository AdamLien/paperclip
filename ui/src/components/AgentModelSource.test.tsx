// @vitest-environment jsdom

import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { createElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockAgentsApi = vi.hoisted(() => ({
  modelSource: vi.fn(),
  updateModelSource: vi.fn(),
}));
const pushToast = vi.hoisted(() => vi.fn());

vi.mock("../api/agents", () => ({ agentsApi: mockAgentsApi }));
vi.mock("../context/ToastContext", () => ({ useToastActions: () => ({ pushToast }) }));

import { AgentModelSource } from "./AgentModelSource";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function settle() {
  for (let i = 0; i < 4; i += 1) {
    flushSync(() => undefined);
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  }
}

const SONNET = "anthropic/claude-sonnet-5-5";
const HAIKU = "anthropic/claude-haiku-4-5";

describe("AgentModelSource", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    mockAgentsApi.updateModelSource.mockImplementation(async (_id, data) => data);
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
        createElement(QueryClientProvider, { client }, createElement(AgentModelSource, { agentId: "agent-1", companyId: "company-1" })),
      );
    });
    await settle();
  }

  const saveButton = () => Array.from(container.querySelectorAll("button")).find((b) => b.textContent === "Save model source")!;

  it("switches a partner to the selected mBase model", async () => {
    mockAgentsApi.modelSource.mockResolvedValue({
      source: "default", model: null, supported: true,
      mbase: { configured: true, models: [HAIKU, SONNET], unavailableReason: null },
    });
    await render();

    const [, mbase] = Array.from(container.querySelectorAll<HTMLInputElement>("input[type=radio]"));
    flushSync(() => mbase!.click());
    await settle();
    const select = container.querySelector("select")!;
    select.value = SONNET;
    flushSync(() => select.dispatchEvent(new Event("change", { bubbles: true })));
    await settle();
    flushSync(() => saveButton().click());
    await settle();

    expect(mockAgentsApi.updateModelSource).toHaveBeenCalledWith("agent-1", { source: "mbase", model: SONNET }, "company-1");
  });

  it("explains when mBase is not ready and does not offer it", async () => {
    mockAgentsApi.modelSource.mockResolvedValue({
      source: "default", model: null, supported: true,
      mbase: { configured: false, models: [], unavailableReason: "mBase is not configured on this instance" },
    });
    await render();

    const [, mbase] = Array.from(container.querySelectorAll<HTMLInputElement>("input[type=radio]"));
    expect(mbase!.disabled).toBe(true);
    expect(container.textContent).toContain("mBase is not available on this instance yet.");
    expect(saveButton().disabled).toBe(true);
  });

  it("hides the choice for partner types that cannot use mBase", async () => {
    mockAgentsApi.modelSource.mockResolvedValue({
      source: "default", model: null, supported: false,
      mbase: { configured: true, models: [SONNET], unavailableReason: null },
    });
    await render();
    expect(container.querySelector("[data-testid=agent-model-source]")).toBeNull();
  });
});
