import { useTranslation } from "react-i18next";
import { i18n } from ".";

import legacyZhTW from "./legacy-zh-TW.json";
import legacyZhTWOverrides from "./legacy-zh-TW.overrides.json";
import completionZhTW from "./completion-zh-TW.json";
import preservedZhTW from "./preserved-zh-TW.json";
import clarityZhTW from "./clarity-zh-TW.json";
import en from "./keyed-en.json";
import zhTW from "./keyed-zh-TW.json";

type LegacyTranslations = Record<string, string>;
type TemplateTranslation = {
  expression: RegExp;
  translation: string;
};

function collectKeyedTranslations(
  english: unknown,
  chinese: unknown,
  output: Record<string, string> = {},
) {
  if (typeof english === "string" && typeof chinese === "string") {
    output[english] = chinese;
    return output;
  }
  if (english && chinese && typeof english === "object" && typeof chinese === "object") {
    for (const key of Object.keys(english)) {
      collectKeyedTranslations(
        (english as Record<string, unknown>)[key],
        (chinese as Record<string, unknown>)[key],
        output,
      );
    }
  }
  return output;
}

const translations = {
  ...collectKeyedTranslations(en, zhTW),
  ...(legacyZhTW as LegacyTranslations),
  ...(legacyZhTWOverrides as LegacyTranslations),
  ...(completionZhTW as LegacyTranslations),
  ...(clarityZhTW as LegacyTranslations),
};

// This source has no literal boundary and therefore matches arbitrary prose or
// user names containing "of" (for example "Chief of staff"). Count labels that
// use it should migrate to regular i18next keys instead of a DOM-level pattern.
const UNSAFE_TEMPLATE_SOURCES = new Set(["{{value1}} of {{value2}}"]);

function decodeJsxEntities(value: string) {
  return value
    .replaceAll("&apos;", "'")
    .replaceAll("&#39;", "'")
    .replaceAll("&quot;", '"')
    .replaceAll("&ldquo;", "“")
    .replaceAll("&rdquo;", "”")
    .replaceAll("&lsquo;", "‘")
    .replaceAll("&rsquo;", "’")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

function normalize(value: string) {
  return decodeJsxEntities(value).replace(/\s+/g, " ").trim();
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const exactTranslations = new Map<string, string>();
const templateTranslations: TemplateTranslation[] = [];
const preservedLiterals = new Set(Object.keys(preservedZhTW).map(normalize));

for (const [source, translation] of Object.entries(translations)) {
  const normalizedSource = normalize(source);
  if (!normalizedSource) continue;
  if (UNSAFE_TEMPLATE_SOURCES.has(normalizedSource)) continue;
  // Static templates must resolve by their full source before regex fallback;
  // a generic switcher template must not consume another template's wording.
  exactTranslations.set(normalizedSource, translation);
  const placeholderMatches = [...normalizedSource.matchAll(/{{value(\d+)}}/g)];
  if (placeholderMatches.length === 0) continue;

  let cursor = 0;
  let pattern = "^";
  for (const match of placeholderMatches) {
    pattern += escapeRegExp(normalizedSource.slice(cursor, match.index));
    pattern += "(.+?)";
    cursor = (match.index ?? 0) + match[0].length;
  }
  pattern += `${escapeRegExp(normalizedSource.slice(cursor))}$`;
  templateTranslations.push({ expression: new RegExp(pattern), translation });
}

templateTranslations.sort((left, right) => right.expression.source.length - left.expression.source.length);

export function translateLegacyLiteral(value: string) {
  const normalizedValue = normalize(value);
  if (!normalizedValue) return null;
  if (preservedLiterals.has(normalizedValue)) return value;

  // Count-only matching cannot consume names or prose such as "Chief of staff".
  const count = normalizedValue.match(/^(\d[\d,.]*) of (\d[\d,.]*)$/);
  if (count) return `${count[1]}／${count[2]}`;

  const exact = exactTranslations.get(normalizedValue);
  if (exact) return exact;

  for (const template of templateTranslations) {
    const match = normalizedValue.match(template.expression);
    if (!match) continue;
    return template.translation.replace(/{{value(\d+)}}/g, (_, index: string) => match[Number(index)] ?? "");
  }

  return null;
}

export function translateUiLiteral(value: string, values?: readonly unknown[]) {
  const chinese = i18n.resolvedLanguage === "zh-TW" || i18n.language === "zh-TW";
  // The generic "of" template is unsafe for names; keep its numeric-only case.
  if (chinese && value === "{{value1}} of {{value2}}" && values?.length === 2
      && values.every((item) => /^\d[\d,.]*$/.test(String(item)))) {
    return `${values[0]}／${values[1]}`;
  }
  const translated = chinese ? translateLegacyLiteral(value) ?? value : value;
  // Resolve the static template before inserting caller-owned text. Never
  // normalize, decode entities, or perform dictionary lookup on these values.
  return values
    ? translated.replace(/{{value(\d+)}}/g, (placeholder, index: string) =>
        Number(index) <= values.length ? String(values[Number(index) - 1]) : placeholder)
    : translated;
}

export function useUiLiteralLocale() {
  useTranslation();
}
