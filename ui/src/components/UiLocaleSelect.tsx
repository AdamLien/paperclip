import { i18n, setLocale, useTranslation } from "@/i18n";

export function UiLocaleSelect() {
  useTranslation();
  const chinese = i18n.resolvedLanguage === "zh-TW";
  return (
    <select
      aria-label={chinese ? "介面語言" : "Interface language"}
      value={chinese ? "zh-TW" : "en"}
      onChange={(event) => setLocale(event.target.value)}
      className="rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground"
    >
      <option value="zh-TW">繁體中文（台灣）</option>
      <option value="en">English</option>
    </select>
  );
}
