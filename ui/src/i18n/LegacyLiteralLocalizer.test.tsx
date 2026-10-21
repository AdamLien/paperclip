// @vitest-environment jsdom

import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import { appCopyFor } from "../lib/app-gallery-copy";
import { setLocale } from ".";
import {
  translateLegacyLiteral,
  translateUiLiteral,
  useUiLiteralLocale,
} from "./LegacyLiteralLocalizer";

afterEach(async () => setLocale("en"));

describe("static UI literal localization", () => {
  it("translates exact literals and preserves dynamic template values", () => {
    expect(translateLegacyLiteral("Advanced Permissions")).toBe("進階權限");
    expect(translateLegacyLiteral("Acting on behalf of Alice")).toBe("代表 Alice 行事");
    expect(translateLegacyLiteral("收藏 Chief of staff")).toBeNull();
    expect(translateLegacyLiteral("2 of 10")).toBe("2／10");
  });

  it("only translates in the Chinese locale", async () => {
    await setLocale("zh-TW");
    expect(translateUiLiteral("Delete")).toBe("刪除");
    expect(translateUiLiteral("A user-authored name")).toBe("A user-authored name");

    await setLocale("en");
    expect(translateUiLiteral("Delete")).toBe("Delete");
  });

  it("uses product context for ambiguous UI terms", async () => {
    await setLocale("zh-TW");
    expect(translateUiLiteral("Disabled")).toBe("未啟用");
    expect(translateUiLiteral("New secret")).toBe("新增金鑰");
    expect(translateUiLiteral("Choose zip")).toBe("選擇 ZIP 壓縮檔");
    expect(translateUiLiteral("Alpha")).toBe("早期測試版");
  });

  it("updates literals without resetting component state", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);

    function Harness() {
      useUiLiteralLocale();
      const [value, setValue] = useState("unsaved");
      return (
        <button onClick={() => setValue("edited")}>
          {translateUiLiteral("Delete")}: {value}
        </button>
      );
    }

    await act(async () => root.render(<Harness />));
    await act(async () => container.querySelector("button")?.click());
    await act(async () => setLocale("zh-TW"));

    expect(container.textContent).toBe("刪除: edited");
    await act(async () => root.unmount());
  });
});


it("localizes dynamic workflow copy while preserving model IDs, names and custom catalog copy", async () => {
  await setLocale("zh-TW");
  expect(translateUiLiteral("Message Chief of staff — describe what you want done…")).toBe("傳訊息給 Chief of staff — 說明你想完成的事…");
  expect(translateUiLiteral("Ask Adam…")).toBe("詢問 Adam…");
  expect(translateUiLiteral("2 agents")).toBe("2 位 AI 代理");
  expect(translateUiLiteral("API key · Codex CLI")).toBe("API 金鑰 · Codex CLI");
  expect(translateUiLiteral("OCX API · Codex CLI")).toBe("OCX API · Codex CLI");
  expect(translateUiLiteral("gpt-6.1-sol")).toBe("gpt-6.1-sol");
  expect(appCopyFor("github").tagline).toBe("讀取程式碼與 PR，並在議題中留言。");
  expect(appCopyFor("private-app", "Working…").tagline).toBe("Working…");
  await setLocale("en");
  expect(appCopyFor("github").tagline).toBe("Read code and pull requests, comment on issues.");
  expect(translateUiLiteral("Message Chief of staff — describe what you want done…")).toBe("Message Chief of staff — describe what you want done…");
});
