// @vitest-environment jsdom
import { expect, it } from "vitest";
import { htmlReportPreviewDocument } from "./html-report-preview";

it("keeps embedded raster pictures while blocking active content and external image requests", () => {
  const html = htmlReportPreviewDocument('<img src="data:image/png;base64,aGVsbG8=" onerror="alert(1)"><img src="https://example.com/track"><img src="data:image/svg+xml;base64,aGVsbG8="><script>alert(1)</script><img srcset="https://example.com/track 2x">');
  const doc = new DOMParser().parseFromString(html, "text/html");
  const images = [...doc.querySelectorAll("img")];
  expect(images[0].getAttribute("src")).toBe("data:image/png;base64,aGVsbG8=");
  expect(images[0].hasAttribute("onerror")).toBe(false);
  expect(images.slice(1).every(image => !image.hasAttribute("src") && !image.hasAttribute("srcset"))).toBe(true);
  expect(doc.querySelector("script")).toBeNull();
  expect(doc.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute("content")).toContain("connect-src 'none'");
});
