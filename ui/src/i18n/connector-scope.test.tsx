// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { ConnectionGrant } from "@paperclipai/shared";
import { setLocale } from ".";
import { translateUiLiteral } from "./LegacyLiteralLocalizer";
import mcrm from "./mcrm-zh-TW.json";
import { ConnectionCompanyScope } from "../pages/apps/ConnectionCompanyScope";
import { UnverifiedServerBadge } from "../pages/apps/UnverifiedServerBadge";
import { CatalogSourceFilters } from "../pages/apps/CatalogSourceFilters";
import { AudienceDialog } from "../pages/apps/app-detail/IdentitiesSection";

const companies = vi.hoisted(() => ({ companies: [{ id: "customer", name: "申皇" }, { id: "internal", name: "metabiz" }], selectedCompany: { id: "internal", name: "metabiz" } }));
vi.mock("../context/CompanyContext", () => ({ useCompany: () => companies }));
vi.mock("../lib/router", () => ({ Link: ({ children }: { children: React.ReactNode }) => <span>{children}</span> }));
vi.mock("../components/MemberMultiSelect", () => ({ MemberMultiSelect: () => <div /> }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let root: Root;
async function render(children: React.ReactNode) {
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(children));
}
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  host?.remove(); setLocale("en");
});

it("identifies the saved connection company even when a different company is selected", async () => {
  setLocale("en");
  await render(<ConnectionCompanyScope connection={{ companyId: "customer" }} />);
  expect(host.textContent).toContain("Crew workspace: 申皇");
  await act(async () => { setLocale("zh-TW"); });
  expect(host.textContent).toContain("Crew 工作區: 申皇");
  expect(host.textContent).not.toContain("metabiz");
  await act(async () => root.render(<ConnectionCompanyScope connection={{ companyId: "missing" }} />));
  expect(host.textContent).toContain("無法確認工作區");
  expect(host.textContent).not.toContain("metabiz");
});

it("explains custom catalog trust independently of connection or merchant status", async () => {
  setLocale("zh-TW");
  await render(<UnverifiedServerBadge host="mcrm-mcp.metabiz.tw" />);
  expect(host.textContent).toContain("自訂伺服器（未經目錄驗證）");
  expect(host.querySelector("[title]")?.getAttribute("title")).toContain("商家授權是否成功是不同");
  expect(host.textContent).toContain("mcrm-mcp.metabiz.tw");
});

it("localizes audience choices without changing selection, provider names or permissions", async () => {
  const onSave = vi.fn();
  const grant = { kind: "organization", providerTenant: { name: "Customer account" }, members: [] } as unknown as ConnectionGrant;
  setLocale("en");
  await render(<AudienceDialog appName="My custom connector" grant={grant} members={[]} pending={false} error={null} onCancel={vi.fn()} onSave={onSave} />);
  await act(async () => { setLocale("zh-TW"); });
  expect(document.body.textContent).toContain("此工作區的所有成員");
  expect(document.body.textContent).toContain("Customer account · My custom connector");
  expect(document.body.querySelector('[role="radio"][aria-checked="true"]')?.getAttribute("data-state")).toBe("checked");
  expect(onSave).not.toHaveBeenCalled();
  const save = [...document.body.querySelectorAll("button")].find(b => /Save audience|儲存使用對象/.test(b.textContent ?? ""))!;
  await act(async () => save.click());
  expect(onSave).toHaveBeenCalledWith([]);
});

it("localizes catalog filters while preserving source identifiers", async () => {
  const onChange = vi.fn(); setLocale("zh-TW");
  await render(<CatalogSourceFilters source="installed" onChange={onChange} />);
  const all = [...host.querySelectorAll("button")].find(b => b.textContent === "全部")!;
  expect(host.textContent).toContain("已安裝");
  await act(async () => all.click()); expect(onChange).toHaveBeenCalledWith("all");
});

it("covers all 82 shipped mCRM descriptions and preserves protocol values", () => {
  setLocale("zh-TW");
  expect(Object.keys(mcrm)).toHaveLength(82);
  for (const [english, chinese] of Object.entries(mcrm)) expect(translateUiLiteral(english)).toBe(chinese);
  expect(translateUiLiteral("metabiz_mcrm_auth_status")).toBe("metabiz_mcrm_auth_status");
  expect(translateUiLiteral("read")).toBe("read");
  setLocale("en");
  const english = Object.keys(mcrm)[0]; expect(translateUiLiteral(english)).toBe(english);
});
