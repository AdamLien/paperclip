import fs from "node:fs";
import path from "node:path";
import ts from "typescript-compiler";
import { expect, it } from "vitest";
import { staticUiLocalization } from "../../vite-static-i18n";
import preserved from "./preserved-zh-TW.json";
import { translateLegacyLiteral } from "./LegacyLiteralLocalizer";

it("accounts for every English literal reached by the production UI transform", async () => {
  const root = path.resolve(import.meta.dirname, "..");
  const plugin = staticUiLocalization();
  const transform = typeof plugin.transform === "function" ? plugin.transform : plugin.transform!.handler;
  const missing = new Set<string>();
  let positions = 0;
  function files(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
      const file = path.join(dir, entry.name);
      return entry.isDirectory() ? (entry.name === "i18n" ? [] : files(file))
        : /\.tsx?$/.test(file) && !/\.(test|stories)\.tsx?$/.test(file) ? [file] : [];
    });
  }
  for (const file of files(root)) {
    const result = await transform.call({} as never, fs.readFileSync(file, "utf8"), file);
    const code = typeof result === "string" ? result : result?.code;
    if (!code) continue;
    const source = ts.createSourceFile(file, String(code), ts.ScriptTarget.Latest, true, file.endsWith("tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    function visit(node: ts.Node) {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "__paperclipTranslateUiLiteral") {
        const arg = node.arguments[0];
        let value: string | undefined;
        if (arg && ts.isStringLiteralLike(arg)) value = arg.text;
        if (arg && ts.isTemplateExpression(arg)) value = arg.head.text + arg.templateSpans.map((span, index) => `{{value${index + 1}}}${span.literal.text}`).join("");
        if (value) {
          positions++;
          const normalized = value.replace(/\s+/g, " ").trim();
          if (/[A-Za-z]{2,}/.test(normalized.replace(/{{value\d+}}/g, ""))
            && !/[\u3400-\u9fff]/.test(normalized)
            && !(normalized in preserved)
            && translateLegacyLiteral(normalized.replace(/{{value\d+}}/g, "12")) === null) missing.add(normalized);
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  expect(positions).toBeGreaterThan(10000);
  expect([...missing].sort()).toEqual([]);
}, 30000);


it("translates every shipped first-party connector description", () => {
  const definitions = path.resolve(import.meta.dirname, "../../../packages/shared/src/app-definitions");
  const missing: string[] = [];
  for (const file of fs.readdirSync(definitions).filter(file => file.endsWith(".json"))) {
    const definition = JSON.parse(fs.readFileSync(path.join(definitions, file), "utf8"));
    if (definition.description && !/[\u3400-\u9fff]/.test(translateLegacyLiteral(definition.description) ?? "")) missing.push(file);
  }
  expect(missing).toEqual([]);
});
