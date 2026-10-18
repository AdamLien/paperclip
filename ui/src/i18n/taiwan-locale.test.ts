// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { i18n, LOCALE_STORAGE_KEY, setLocale } from ".";
import { translateUiLiteral } from "./LegacyLiteralLocalizer";
import english from "./keyed-en.json";
import taiwan from "./keyed-zh-TW.json";
import literals from "./legacy-zh-TW.json";
import overrides from "./legacy-zh-TW.overrides.json";
import completion from "./completion-zh-TW.json";
import clarity from "./clarity-zh-TW.json";
import inventory from "./pending-zh-TW.json";
import { validateLocaleMessages } from "./locale-validation";

afterEach(() => {
  setLocale("en");
  localStorage.removeItem(LOCALE_STORAGE_KEY);
});

describe("Taiwan Traditional Chinese", () => {
  it("accounts for every original missing literal without hiding untranslated prose", () => {
    const preserved = new Map(inventory.preserved.map(({ text, reason }) => [text, reason]));
    const translations: Record<string, string> = completion;
    expect(inventory.resolved).toHaveLength(2885);
    expect(new Set(inventory.resolved.map(({ text }) => text)).size).toBe(2885);
    expect(inventory.missing).toEqual([]);
    for (const { text } of inventory.resolved) {
      if (preserved.has(text)) {
        expect(preserved.get(text)?.trim().length).toBeGreaterThan(0);
        expect(translations[text], text).toBeUndefined();
      } else {
        expect(translations[text]?.trim().length, text).toBeGreaterThan(0);
        expect(translations[text], text).not.toBe(text);
      }
    }
    expect(Object.keys(translations).length + preserved.size).toBe(2885);
  });

  it("renders the added copy while preserving dynamic commit identifiers and CLI examples", () => {
    setLocale("zh-TW");
    expect(translateUiLiteral("View commit abc123 on GitHub")).toBe("在 GitHub 查看提交 abc123");
    expect(translateUiLiteral("Which agents can use this connection?")).toBe("哪些代理可以使用此連線？");
    expect(translateUiLiteral("This instruction file is empty.")).toBe("此指示檔案是空的。");
    expect(translateUiLiteral("kimi login")).toBe("kimi login");
    expect(translateUiLiteral("KIMI_MODEL_NAME + KIMI_MODEL_API_KEY")).toBe("KIMI_MODEL_NAME + KIMI_MODEL_API_KEY");
    setLocale("en");
    expect(translateUiLiteral("View commit abc123 on GitHub")).toBe("View commit abc123 on GitHub");
  });

  it("resolves every added message and retains reviewed technical literals", () => {
    setLocale("zh-TW");
    const interpolate = (value: string) => value.replace(/{{value(\d+)}}/g, "__sample_value_$1__");
    for (const [source, translated] of Object.entries({ ...completion, ...clarity })) {
      expect(translateUiLiteral(interpolate(source)), source).toBe(interpolate(translated));
    }
    for (const { text } of inventory.preserved) {
      expect(translateUiLiteral(interpolate(text)), text).toBe(interpolate(text));
    }
  });

  it("preserves all keyed messages and interpolation contracts", () => {
    expect(validateLocaleMessages(taiwan, english)).toEqual([]);
    for (const [source, translation] of Object.entries({ ...literals, ...overrides, ...completion, ...clarity })) {
      const placeholders = (value: string) => [...value.matchAll(/{{.*?}}/g)].map(([value]) => value).sort();
      expect(placeholders(translation), source).toEqual(placeholders(source));
    }
  });

  it("uses Taiwan terminology for the login, navigation and settings journeys", () => {
    setLocale("zh-TW");
    for (const [source, translated] of Object.entries({
      "Sign in": "登入", "Password": "密碼", "Settings": "設定",
      "Projects": "專案", "Inbox": "收件匣", "Save": "儲存",
      "Organization name": "組織名稱", "Advanced Permissions": "進階權限",
    })) expect(translateUiLiteral(source)).toBe(translated);
    expect(document.documentElement.lang).toBe("zh-TW");
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("zh-TW");
    expect(i18n.language).toBe("zh-TW");
  });

  it("preserves identifiers and unknown user content", () => {
    setLocale("zh-TW");
    for (const value of ["Example Company", "EXAMPLE-123", "com.example.client.uat", "Alice's project"])
      expect(translateUiLiteral(value)).toBe(value);
    setLocale("en");
    expect(translateUiLiteral("Projects")).toBe("Projects");
  });
});
