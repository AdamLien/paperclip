import fs from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { translateLegacyLiteral } from "./LegacyLiteralLocalizer";

it("translates every shipped first-party connector description", () => {
  const definitions = path.resolve(import.meta.dirname, "../../../packages/shared/src/app-definitions");
  const missing: string[] = [];
  for (const file of fs.readdirSync(definitions).filter(file => file.endsWith(".json"))) {
    const definition = JSON.parse(fs.readFileSync(path.join(definitions, file), "utf8"));
    if (definition.description && !/[\u3400-\u9fff]/.test(translateLegacyLiteral(definition.description) ?? "")) missing.push(file);
  }
  expect(missing).toEqual([]);
});
