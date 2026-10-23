type CompanionStatus = { version: number; target: { title: string; url: string } | null };
export function crewChromeRequest<T = CompanionStatus>(type: "app-status" | "app-start", input: { token?: string; target?: "new" | "selected" } = {}): Promise<T> {
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID();
    const finish = () => { window.removeEventListener("message", receive); clearTimeout(timer); };
    const receive = (event: MessageEvent) => {
      if (event.source !== window || event.origin !== window.location.origin || event.data?.channel !== "mcrew-chrome-v2" || event.data.direction !== "response" || event.data.id !== id) return;
      finish();
      if (event.data.result?.error) reject(new Error(event.data.result.error));
      else resolve(event.data.result);
    };
    const timer = setTimeout(() => {
      finish();
      reject(new Error(type === "app-start"
        ? "Chrome 分頁啟動逾時，已取消本次連線。請確認 Chrome 仍在執行後再試一次。"
        : "請在已安裝新版 mCrew 擴充套件的 Chrome 開啟此頁，並重新整理。"));
    }, type === "app-status" ? 2000 : 60000);
    window.addEventListener("message", receive);
    window.postMessage({ channel: "mcrew-chrome-v2", direction: "request", id, type, ...input }, window.location.origin);
  });
}
