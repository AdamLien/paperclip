export type MorbitNativeEntry = {
  url: string;
  localOnly: boolean;
};

/** Accept only an operator-configured native OCX origin and its providers hash. */
export function readMorbitNativeEntry(raw = process.env.MORBIT_UAT_OCX_MANAGEMENT_URL): MorbitNativeEntry | null {
  if (!raw?.trim()) return null;

  try {
    const url = new URL(raw.trim());
    const localOnly = url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname);
    if (url.username || url.password || url.search || !["https:", "http:"].includes(url.protocol)) return null;
    if (url.protocol === "http:" && !localOnly) return null;
    if (url.pathname !== "" && url.pathname !== "/") return null;
    if (url.hash !== "" && url.hash !== "#providers") return null;
    return { url: `${url.origin}/${url.hash}`, localOnly };
  } catch {
    return null;
  }
}
