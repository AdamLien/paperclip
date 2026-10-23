import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { PDFDocumentProxy } from "pdfjs-dist";

/** Canvas pages work in WKWebView too; no external viewer or document JavaScript. */
export default function PdfAttachmentPreview({ url, title }: { url: string; title: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(1);
  const [attempt, setAttempt] = useState(0);
  const [width, setWidth] = useState(640);
  const [error, setError] = useState("");
  const [rendered, setRendered] = useState(false);

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(160, entry.contentRect.width - 24)));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    let task: { destroy(): Promise<void> } | undefined;
    setDocument(null); setPage(1); setError(""); setRendered(false);
    void (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        const { default: workerUrl } = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
        if (cancelled) return;
        pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
        const loading = pdfjs.getDocument({ url, withCredentials: true, isEvalSupported: false, enableXfa: false });
        task = loading;
        const pdf = await loading.promise;
        if (!cancelled) setDocument(pdf);
      } catch {
        if (!cancelled) setError("無法載入預覽。文件可能已加密、損毀、超過上限，或轉換服務尚未就緒。");
      }
    })();
    return () => { cancelled = true; void task?.destroy(); };
  }, [url, attempt]);

  useEffect(() => {
    if (!document || !canvas.current) return;
    let cancelled = false;
    let render: { cancel(): void; promise: Promise<void> } | undefined;
    setRendered(false);
    void (async () => {
      try {
        const pdfPage = await document.getPage(page);
        if (cancelled || !canvas.current) return;
        const base = pdfPage.getViewport({ scale: 1 });
        const scale = Math.min(width / base.width, 2, 4096 / Math.max(base.width, base.height));
        const viewport = pdfPage.getViewport({ scale });
        const element = canvas.current;
        element.width = Math.max(1, Math.floor(viewport.width));
        element.height = Math.max(1, Math.floor(viewport.height));
        const context = element.getContext("2d");
        if (!context) throw new Error("Canvas unavailable");
        render = pdfPage.render({ canvasContext: context, canvas: element, viewport });
        await render.promise;
        if (!cancelled) setRendered(true);
      } catch { if (!cancelled) setError("此頁無法顯示，請重試或下載原檔。"); }
    })();
    return () => { cancelled = true; render?.cancel(); };
  }, [document, page, width]);

  return <div ref={container} className="flex h-full min-h-0 flex-col">
    <div className="flex shrink-0 items-center justify-center gap-3 border-b p-2" aria-label="文件翻頁">
      <Button variant="ghost" size="icon-sm" aria-label="上一頁" disabled={!document || page <= 1} onClick={() => setPage(page - 1)}><ChevronLeft /></Button>
      <span className="text-sm" aria-live="polite">{document ? `${page} / ${document.numPages} 頁` : "準備預覽中…"}</span>
      <Button variant="ghost" size="icon-sm" aria-label="下一頁" disabled={!document || page >= document.numPages} onClick={() => setPage(page + 1)}><ChevronRight /></Button>
    </div>
    <div className="min-h-0 flex-1 overflow-auto bg-muted/30 p-3">
      {error ? <div role="alert" className="space-y-3 p-3 text-sm"><p>{error}</p><Button variant="outline" onClick={() => setAttempt(attempt + 1)}><RotateCw />重新載入</Button></div>
        : <><canvas ref={canvas} aria-label={`${title}，第 ${page} 頁`} className="mx-auto max-w-full bg-white shadow-sm" hidden={!rendered} />
          {!rendered ? <p role="status" className="p-3 text-center text-sm">正在產生預覽，請稍候…</p> : null}</>}
    </div>
  </div>;
}
