import { spawn } from "node:child_process";
import { access, mkdtemp, open, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, extname } from "node:path";
import { Transform, type Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

export const OFFICE_PREVIEW_MAX_BYTES = 20 * 1024 * 1024;
const MAX_PDF_BYTES = 40 * 1024 * 1024;
const MAX_CONVERSIONS = 2;
let active = 0;
const extensions = new Set([".pptx", ".ppt", ".docx", ".doc", ".xlsx", ".xls", ".odt", ".odp", ".ods", ".rtf"]);

export class OfficePreviewError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}

export function officePreviewExtension(filename: string | null | undefined) {
  const extension = extname(filename ?? "").toLowerCase();
  return extensions.has(extension) ? extension : null;
}

/** Only system libraries/fonts and this request's private work directory are visible. */
export function officeSandboxArgs(directory: string, extension: string) {
  if (!extensions.has(extension)) throw new OfficePreviewError(415, "此格式尚未支援預覽。");
  return [
    "--unshare-all", "--die-with-parent", "--new-session", "--cap-drop", "ALL", "--clearenv",
    "--ro-bind", "/usr", "/usr", "--ro-bind", "/bin", "/bin",
    "--ro-bind", "/lib", "/lib", "--ro-bind", "/lib64", "/lib64",
    "--ro-bind-try", "/etc/fonts", "/etc/fonts",
    "--ro-bind-try", "/etc/libreoffice", "/etc/libreoffice",
    "--ro-bind-try", "/etc/ld.so.cache", "/etc/ld.so.cache",
    "--proc", "/proc", "--dev", "/dev", "--tmpfs", "/tmp", "--dir", "/run",
    "--bind", directory, "/work", "--chdir", "/work",
    "--setenv", "HOME", "/tmp", "--setenv", "PATH", "/usr/bin:/bin",
    "--setenv", "LANG", "C.UTF-8",
    "/usr/bin/prlimit", "--cpu=40", "--as=2147483648", "--fsize=41943040", "--nofile=256",
    "/usr/bin/libreoffice", "-env:UserInstallation=file:///tmp/lo-profile",
    "--headless", "--nologo", "--nodefault", "--norestore", "--convert-to", "pdf", "--outdir", "/work",
    `/work/input${extension}`,
  ];
}

async function convert(directory: string, extension: string, signal: AbortSignal) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn("/usr/bin/bwrap", officeSandboxArgs(directory, extension), {
      stdio: "ignore", detached: true, env: {},
    });
    const stop = () => {
      if (child.pid) { try { process.kill(-child.pid, "SIGKILL"); } catch { /* already exited */ } }
      reject(new OfficePreviewError(504, "預覽轉換逾時或已取消，請重試。"));
    };
    signal.addEventListener("abort", stop, { once: true });
    if (signal.aborted) stop();
    child.once("error", () => { signal.removeEventListener("abort", stop); reject(new OfficePreviewError(503, "預覽轉換服務尚未就緒。")); });
    child.once("close", (code) => {
      signal.removeEventListener("abort", stop);
      code === 0 ? resolve() : reject(new OfficePreviewError(422, "無法預覽此文件，可能已加密、損毀或格式不支援。"));
    });
  });
}

export async function createOfficePreview(input: { filename: string | null; byteSize: number; stream: Readable; signal?: AbortSignal }) {
  const extension = officePreviewExtension(input.filename);
  const rejectInput = (status: number, message: string): never => {
    input.stream.destroy();
    throw new OfficePreviewError(status, message);
  };
  if (!extension) return rejectInput(415, "此格式尚未支援預覽。");
  if (input.byteSize > OFFICE_PREVIEW_MAX_BYTES) return rejectInput(413, "文件超過 20 MB 預覽上限，請下載原檔。");
  if (active >= MAX_CONVERSIONS) return rejectInput(503, "預覽服務忙碌中，請稍後重試。");
  if (process.platform !== "linux") return rejectInput(503, "Office 預覽需要 Linux 隔離轉換服務。");
  active += 1;
  let directory: string | undefined;
  const controller = new AbortController();
  const abort = () => controller.abort();
  input.signal?.addEventListener("abort", abort, { once: true });
  if (input.signal?.aborted) abort();
  const timer = setTimeout(abort, 60_000);
  try {
    await Promise.all(["/usr/bin/bwrap", "/usr/bin/prlimit", "/usr/bin/libreoffice"].map((path) => access(path)));
    directory = await mkdtemp(join(tmpdir(), "crew-office-preview-"));
    const file = await open(join(directory, `input${extension}`), "wx", 0o600);
    let bytes = 0;
    const bound = new Transform({ transform(chunk, _encoding, callback) {
      bytes += chunk.length;
      callback(bytes > OFFICE_PREVIEW_MAX_BYTES ? new OfficePreviewError(413, "文件超過 20 MB 預覽上限。") : null, chunk);
    } });
    await pipeline(input.stream, bound, file.createWriteStream(), { signal: controller.signal });
    await convert(directory, extension, controller.signal);
    const pdfPath = join(directory, "input.pdf");
    const info = await stat(pdfPath);
    if (info.size > MAX_PDF_BYTES) throw new OfficePreviewError(413, "預覽文件過大，請下載原檔。");
    const pdf = await readFile(pdfPath);
    if (!pdf.subarray(0, 5).equals(Buffer.from("%PDF-"))) throw new OfficePreviewError(422, "無法產生有效的文件預覽。");
    return pdf;
  } catch (error) {
    if (error instanceof OfficePreviewError) throw error;
    throw new OfficePreviewError(controller.signal.aborted ? 504 : 503, controller.signal.aborted ? "預覽逾時或已取消，請重試。" : "預覽服務暫時無法使用，請重試。");
  } finally {
    clearTimeout(timer);
    input.signal?.removeEventListener("abort", abort);
    input.stream.destroy();
    try { if (directory) await rm(directory, { recursive: true, force: true }); }
    finally { active -= 1; }
  }
}
