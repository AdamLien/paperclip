// @vitest-environment jsdom

import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MonthSpendMetric } from "./Dashboard";

vi.mock("@/lib/router", () => ({
  Link: ({ to, children, ...props }: { to: string; children?: React.ReactNode }) => (
    <a href={to} {...props}>{children}</a>
  ),
  useLocation: () => ({ pathname: "/", search: "", hash: "", state: null }),
}));

describe("MonthSpendMetric", () => {
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

  it("shows month spend and budget utilization when costs are visible", () => {
    flushSync(() => root.render(
      <MonthSpendMetric costs={{ monthSpendCents: 12_345, monthBudgetCents: 50_000, monthUtilizationPercent: 24.69 }} />,
    ));
    expect(container.textContent).toContain("Month Spend");
    expect(container.textContent).toContain("24.69% of");
  });

  it("renders nothing, not a zero amount, when costs are withheld", () => {
    flushSync(() => root.render(<MonthSpendMetric costs={null} />));
    expect(container.textContent).toBe("");
    expect(container.querySelector('a[href="/costs"]')).toBeNull();
  });
});
