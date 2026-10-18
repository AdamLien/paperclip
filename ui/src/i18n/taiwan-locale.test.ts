// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { i18n, LOCALE_STORAGE_KEY, setLocale } from ".";
import { translateUiLiteral } from "./LegacyLiteralLocalizer";
import english from "./keyed-en.json";
import taiwan from "./keyed-zh-TW.json";
import literals from "./legacy-zh-TW.json";
import overrides from "./legacy-zh-TW.overrides.json";
import { validateLocaleMessages } from "./locale-validation";

afterEach(() => {
  setLocale("en");
  localStorage.removeItem(LOCALE_STORAGE_KEY);
});

describe("Taiwan Traditional Chinese", () => {
  it("preserves all keyed messages and interpolation contracts", () => {
    expect(validateLocaleMessages(taiwan, english)).toEqual([]);
    for (const [source, translation] of Object.entries({ ...literals, ...overrides })) {
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
