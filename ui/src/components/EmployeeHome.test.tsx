// @vitest-environment jsdom

import type { ReactNode } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Agent, Issue } from "@paperclipai/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EmployeeHome } from "./EmployeeHome";

const mockNavigate = vi.hoisted(() => vi.fn());
const mockAgentsApi = vi.hoisted(() => ({ list: vi.fn() }));
const mockIssuesApi = vi.hoisted(() => ({ list: vi.fn(), create: vi.fn() }));

vi.mock("@/lib/router", () => ({
  Link: ({ children, to, ...props }: { children: ReactNode; to: string }) => (
    <a href={to} {...props}>{children}</a>
  ),
  useNavigate: () => mockNavigate,
}));
vi.mock("../api/agents", () => ({ agentsApi: mockAgentsApi }));
vi.mock("../api/issues", () => ({ issuesApi: mockIssuesApi }));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

async function settle() {
  for (let i = 0; i < 5; i++) {
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    flushSync(() => {});
  }
}

function agent(id: string, name: string, status: Agent["status"] = "active"): Agent {
  return { id, companyId: "company-1", name, urlKey: id, status } as unknown as Agent;
}

function issue(id: string, title: string, status: Issue["status"]): Issue {
  return {
    id,
    companyId: "company-1",
    identifier: id.toUpperCase(),
    title,
    status,
    updatedAt: "2026-10-29T00:00:00.000Z",
  } as unknown as Issue;
}

function setInput(element: HTMLTextAreaElement | HTMLSelectElement, value: string) {
  const proto = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLSelectElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(element, value);
  element.dispatchEvent(new Event(element instanceof HTMLTextAreaElement ? "input" : "change", { bubbles: true }));
}

describe("EmployeeHome", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    mockAgentsApi.list.mockResolvedValue([
      agent("agent-1", "Writer"),
      agent("agent-2", "Analyst", "paused"),
      agent("agent-3", "Retired", "terminated"),
    ]);
    mockIssuesApi.list.mockResolvedValue([
      issue("met-1", "Draft the newsletter", "in_progress"),
      issue("met-2", "Summarize the meeting", "done"),
      issue("met-3", "Dropped idea", "cancelled"),
    ]);
    mockIssuesApi.create.mockResolvedValue(issue("met-9", "Where is the Q3 report?", "todo"));
  });

  afterEach(() => {
    flushSync(() => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  async function render() {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    flushSync(() => root.render(
      <QueryClientProvider client={queryClient}>
        <EmployeeHome companyId="company-1" />
      </QueryClientProvider>,
    ));
    await settle();
  }

  it("leads with a question box and shows my AI partners, tasks and results", async () => {
    await render();
    const text = container.textContent ?? "";

    expect(container.querySelector("textarea[aria-label='Ask your AI partner']")).not.toBeNull();
    expect(text).toContain("My AI partners");
    expect(text).toContain("Writer");
    expect(text).toContain("Analyst");
    expect(text).not.toContain("Retired");

    expect(mockIssuesApi.list).toHaveBeenCalledWith("company-1", expect.objectContaining({ touchedByUserId: "me" }));
    const tasks = container.querySelector("[data-testid='employee-home-tasks']")!.textContent;
    const results = container.querySelector("[data-testid='employee-home-results']")!.textContent;
    expect(tasks).toContain("Draft the newsletter");
    expect(tasks).not.toContain("Summarize the meeting");
    expect(results).toContain("Summarize the meeting");
    expect(results).not.toContain("Draft the newsletter");
    expect(text).not.toContain("Dropped idea");
    expect(container.querySelector("a[href='/artifacts']")).not.toBeNull();
  });

  it("shows no spend, paused-agent or approval figures", async () => {
    await render();
    const text = container.textContent ?? "";
    for (const adminOnly of ["Month Spend", "Pending Approvals", "paused and will not run", "budget"]) {
      expect(text).not.toContain(adminOnly);
    }
    expect(container.querySelector("a[href='/costs']")).toBeNull();
    expect(container.querySelector("a[href='/approvals']")).toBeNull();
  });

  it("sends the question as a task for the chosen AI partner and opens it", async () => {
    await render();
    const box = container.querySelector<HTMLTextAreaElement>("textarea[aria-label='Ask your AI partner']")!;
    const partner = container.querySelector<HTMLSelectElement>("select[aria-label='AI partner']")!;
    const send = container.querySelector<HTMLButtonElement>("button[type='submit']")!;

    expect(send.disabled).toBe(true);
    flushSync(() => setInput(partner, "agent-2"));
    flushSync(() => setInput(box, "Where is the Q3 report?\nPlease link the final version."));
    expect(send.disabled).toBe(false);

    flushSync(() => send.click());
    await settle();

    expect(mockIssuesApi.create).toHaveBeenCalledWith("company-1", {
      title: "Where is the Q3 report?",
      description: "Where is the Q3 report?\nPlease link the final version.",
      status: "todo",
      assigneeAgentId: "agent-2",
    });
    expect(mockNavigate).toHaveBeenCalledWith("/issues/MET-9");
  });

  it("cannot send without an AI partner", async () => {
    mockAgentsApi.list.mockResolvedValue([agent("agent-3", "Retired", "terminated")]);
    await render();
    const box = container.querySelector<HTMLTextAreaElement>("textarea[aria-label='Ask your AI partner']")!;
    flushSync(() => setInput(box, "Anyone there?"));
    expect(container.querySelector<HTMLButtonElement>("button[type='submit']")!.disabled).toBe(true);
    expect(container.textContent).toContain("No AI partners yet");
  });
});
