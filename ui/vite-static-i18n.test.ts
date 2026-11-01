import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { staticUiLocalization } from "./vite-static-i18n";

describe("staticUiLocalization", () => {
  it("wraps static UI copy without touching dynamic user data", async () => {
    const plugin = staticUiLocalization();
    const source = `
      export function Card({ company }) {
        return <section title="Company settings"><h1>Welcome</h1><p>{company.name}</p></section>;
      }
    `;
    const transform = plugin.transform;
    if (!transform) throw new Error("transform hook missing");
    const handler = typeof transform === "function" ? transform : transform.handler;
    const result = await handler.call({} as never, source, "/repo/ui/src/Card.tsx", {} as never);
    const code = typeof result === "string" ? result : result?.code;

    expect(code).toContain('__paperclipTranslateUiLiteral("Company settings")');
    expect(code).toContain('__paperclipTranslateUiLiteral("Welcome")');
    expect(code).toContain("__paperclipUseUiLiteralLocale();");
    expect(code).toContain("{company.name}");
    expect(code).not.toContain("__paperclipTranslateUiLiteral(company.name)");
  });

  it("does not translate state or adapter identifiers used by rendered conditions", async () => {
    const plugin = staticUiLocalization();
    const source = `
      export function Wizard({ missionPath, adapterType }) {
        return <section>
          {missionPath === "questionnaire" && <p>Answer a few questions</p>}
          {missionPath === "direct" ? <p>Type it directly</p> : null}
          {adapterType === "codex_local" ? "Codex is ready" : "Choose an adapter"}
        </section>;
      }
    `;
    const transform = plugin.transform;
    if (!transform) throw new Error("transform hook missing");
    const handler = typeof transform === "function" ? transform : transform.handler;
    const result = await handler.call({} as never, source, "/repo/ui/src/Wizard.tsx", {} as never);
    const code = typeof result === "string" ? result : result?.code;

    expect(code).toContain('missionPath === "questionnaire"');
    expect(code).toContain('missionPath === "direct"');
    expect(code).toContain('adapterType === "codex_local"');
    expect(code).not.toContain('__paperclipTranslateUiLiteral("questionnaire")');
    expect(code).not.toContain('__paperclipTranslateUiLiteral("direct")');
    expect(code).not.toContain('__paperclipTranslateUiLiteral("codex_local")');
    expect(code).toContain('__paperclipTranslateUiLiteral("Answer a few questions")');
    expect(code).toContain('__paperclipTranslateUiLiteral("Type it directly")');
    expect(code).toContain('__paperclipTranslateUiLiteral("Codex is ready")');
    expect(code).toContain('__paperclipTranslateUiLiteral("Choose an adapter")');
  });

  it("translates every empty-state message on the employee home", async () => {
    const file = path.join(__dirname, "src/components/EmployeeHome.tsx");
    const transform = staticUiLocalization().transform;
    if (!transform) throw new Error("transform hook missing");
    const handler = typeof transform === "function" ? transform : transform.handler;
    const result = await handler.call({} as never, readFileSync(file, "utf8"), file, {} as never);
    const code = typeof result === "string" ? result : result?.code;

    for (const message of ["No open tasks.", "No finished tasks yet.", "No AI partners yet."]) {
      expect(code).toContain(`__paperclipTranslateUiLiteral("${message}")`);
    }
  });

  it("translates the AI partner team guidance and has zh-TW text for it", async () => {
    const file = path.join(__dirname, "src/pages/Agents.tsx");
    const transform = staticUiLocalization().transform;
    if (!transform) throw new Error("transform hook missing");
    const handler = typeof transform === "function" ? transform : transform.handler;
    const result = await handler.call({} as never, readFileSync(file, "utf8"), file, {} as never);
    // Multi-line JSX text keeps a trailing space; the runtime lookup normalizes it away.
    const code = (typeof result === "string" ? result : result?.code ?? "").replace(/ "\)/g, '")');
    const zhTW = JSON.parse(readFileSync(path.join(__dirname, "src/i18n/clarity-zh-TW.json"), "utf8")) as Record<string, string>;

    for (const message of [
      "No purpose yet. Describe what this partner can do in its settings.",
      "Create your first AI partner",
      "AI partners take questions and tasks from everyone in this workspace. Give each one a clear purpose so people know who to ask.",
      "No partner can take work right now. Resume or approve one so people can ask it questions.",
      "No AI partners are available yet. Ask a workspace admin to add one.",
    ]) {
      expect(code).toContain(`__paperclipTranslateUiLiteral(${JSON.stringify(message)})`);
      expect(zhTW[message]).toBeTruthy();
    }
    expect(zhTW["Create AI partner"]).toBeTruthy();
  });

  it("translates the partner access settings and has zh-TW text for them", async () => {
    const file = path.join(__dirname, "src/components/AgentPartnerAccess.tsx");
    const transform = staticUiLocalization().transform;
    if (!transform) throw new Error("transform hook missing");
    const handler = typeof transform === "function" ? transform : transform.handler;
    const result = await handler.call({} as never, readFileSync(file, "utf8"), file, {} as never);
    const code = typeof result === "string" ? result : result?.code ?? "";
    const zhTW = JSON.parse(readFileSync(path.join(__dirname, "src/i18n/clarity-zh-TW.json"), "utf8")) as Record<string, string>;

    for (const message of [
      "Who can use this partner",
      "Everyone in this workspace",
      "Only selected members",
      "Owners and admins can always see this partner. Other members cannot find it, open it, or give it work.",
      "No other members in this workspace yet.",
      "Save access",
      "Could not load who can use this partner. Refresh the page to try again.",
    ]) {
      expect(code).toContain(`__paperclipTranslateUiLiteral(${JSON.stringify(message)})`);
      expect(zhTW[message]).toBeTruthy();
    }
    expect(zhTW["Partner access saved"]).toBeTruthy();
    expect(zhTW["Could not save partner access"]).toBeTruthy();
  });

  it("translates the unavailable partner page and has zh-TW text for it", async () => {
    const file = path.join(__dirname, "src/components/AgentNotFound.tsx");
    const transform = staticUiLocalization().transform;
    if (!transform) throw new Error("transform hook missing");
    const handler = typeof transform === "function" ? transform : transform.handler;
    const result = await handler.call({} as never, readFileSync(file, "utf8"), file, {} as never);
    const code = typeof result === "string" ? result : result?.code ?? "";
    const zhTW = JSON.parse(readFileSync(path.join(__dirname, "src/i18n/clarity-zh-TW.json"), "utf8")) as Record<string, string>;

    for (const message of [
      "This AI partner is not available",
      "It may have been removed, or it has not been shared with you.",
    ]) {
      expect(code).toContain(`__paperclipTranslateUiLiteral(${JSON.stringify(message)})`);
      expect(zhTW[message]).toBeTruthy();
    }
  });
});
