import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCompany } from "@/context/CompanyContext";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { api } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Link } from "@/lib/router";
import { Globe, Cloud, Square } from "lucide-react";

type Session = { id: string; issueId: string; agentId: string; mode: "chrome" | "cloud"; label: string;
  status: "waiting" | "connected" | "disconnected"; expiresAt: string; url: string; title: string;
  frame: string | null; width: number; height: number; pairingToken?: string };
type Task = { id: string; identifier: string; title: string; assigneeAgentId: string | null };

export function BrowserWorkspace() {
  const { selectedCompanyId } = useCompany(); const { setBreadcrumbs } = useBreadcrumbs();
  const cache = useQueryClient(); const [taskId, setTaskId] = useState(""); const [label, setLabel] = useState("我的 Mac Chrome");
  const [selected, setSelected] = useState<string | null>(null); const [pairing, setPairing] = useState<{ companyId: string; token: string } | null>(null);
  const [url, setUrl] = useState(""); const [message, setMessage] = useState<string | null>(null);
  const root = `/companies/${selectedCompanyId}/browser-workspace`;
  const key = ["browser-workspace", selectedCompanyId];
  useEffect(() => { setBreadcrumbs([{ label: "瀏覽器" }]); }, [setBreadcrumbs]);
  useEffect(() => { setSelected(null); setPairing(null); setTaskId(""); setUrl(""); setMessage(null); }, [selectedCompanyId]);
  const tasks = useQuery({ queryKey: ["browser-tasks", selectedCompanyId], queryFn: () => api.get<Task[]>(`/companies/${selectedCompanyId}/issues`), enabled: !!selectedCompanyId });
  const sessions = useQuery({ queryKey: key, queryFn: () => api.get<Session[]>(root), enabled: !!selectedCompanyId, refetchInterval: 3000 });
  const detail = useQuery({ queryKey: [...key, selected], queryFn: () => api.get<Session>(`${root}/${selected}`), enabled: !!selectedCompanyId && !!selected, refetchInterval: 1500 });
  const task = tasks.data?.find(t => t.id === taskId);
  const create = useMutation({ mutationFn: (input: { companyId: string; issueId: string; agentId: string; label: string }) => api.post<Session>(`/companies/${input.companyId}/browser-workspace`, { issueId: input.issueId, agentId: input.agentId, mode: "chrome", label: input.label }),
    onSuccess: (result, input) => { if (input.companyId !== selectedCompanyId) return; setPairing({ companyId: input.companyId, token: result.pairingToken! }); setSelected(result.id); void cache.invalidateQueries({ queryKey: key }); } });
  const stop = useMutation({ mutationFn: (id: string) => api.delete(`${root}/${id}`),
    onSuccess: () => { setSelected(null); setPairing(null); void cache.invalidateQueries({ queryKey: key }); } });
  const command = useMutation({ mutationFn: (body: Record<string, unknown>) => api.post(`${root}/${selected}/commands`, body),
    onSuccess: () => setMessage("操作已送出，請查看分頁畫面；系統不會自動重試。") });
  const session = detail.isError ? undefined : detail.data;
  if (!selectedCompanyId) return <p className="p-6">請先選擇公司。</p>;
  return <div className="mx-auto w-full max-w-6xl space-y-5 p-4 sm:p-6">
    <header><h1 className="text-xl font-semibold">瀏覽器</h1><p className="mt-2 text-sm text-muted-foreground">選擇工作位置，與指定 Agent 共用分頁。停止分享後便無法繼續控制。</p></header>
    <div className="grid gap-4 md:grid-cols-2">
      <section className="space-y-3 rounded-xl border p-4"><h2 className="flex items-center gap-2 font-medium"><Globe className="size-5" />我的 Chrome</h2>
        <p className="text-sm text-muted-foreground">使用電腦 Chrome 原本的登入狀態。由你在 Chrome 選擇一個分頁分享；配對最長兩小時。</p>
        <label className="block text-sm">交給哪一項工作<select aria-label="選擇工作" className="mt-1 block w-full rounded-md border bg-background p-2" value={taskId} onChange={e => setTaskId(e.target.value)}>
          <option value="">請選擇已指派 Agent 的任務</option>{tasks.data?.filter(t => t.assigneeAgentId).map(t => <option key={t.id} value={t.id}>{t.identifier} · {t.title}</option>)}
        </select></label>
        <label className="block text-sm">裝置名稱<Input value={label} onChange={e => setLabel(e.target.value)} maxLength={80} /></label>
        <Button disabled={!task?.assigneeAgentId || !label.trim() || create.isPending} onClick={() => { setMessage(null); create.mutate({ companyId: selectedCompanyId, issueId: taskId, agentId: task!.assigneeAgentId!, label }); }}>建立分頁配對</Button>
        <details className="text-sm"><summary className="cursor-pointer">第一次連線</summary><ol className="mt-2 list-decimal space-y-2 pl-5">
          <li>在電腦 Chrome 安裝公司提供的 mCrew Chrome Companion。</li><li>建立配對後，將配對碼貼到擴充套件。</li><li>切到要分享的網站，按「分享這個分頁」。</li>
        </ol><p className="mt-2">配對碼等同本次分頁控制權，請只貼到公司擴充套件，不要傳到聊天。</p></details>
      </section>
      <section className="space-y-3 rounded-xl border p-4"><h2 className="flex items-center gap-2 font-medium"><Cloud className="size-5" />雲端瀏覽器</h2>
        <p className="text-sm text-muted-foreground">Agent 在伺服器的公司隔離環境執行，與你的電腦及個人 Chrome 分開。</p>
        <p className="text-sm">目前的隔離瀏覽器工具可由 Agent 使用；這個入口的即時畫面仍需部署互動式工作器，尚未連線。</p>
        <Button variant="outline" asChild><Link to="/company/settings/management">查看 Agent 能力與設定</Link></Button>
      </section>
    </div>
    {pairing?.companyId === selectedCompanyId && <section className="space-y-2 rounded-xl border p-4"><h2 className="font-medium">等待 Chrome 分享分頁</h2><p className="text-sm">配對碼五分鐘內有效。只授權所選任務的 Agent；關閉或重新啟動服務會撤銷配對。</p>
      <Input aria-label="分頁配對碼" type="password" readOnly value={pairing.token} autoComplete="off" />
      <Button variant="outline" onClick={() => void navigator.clipboard.writeText(pairing.token).then(() => setMessage("配對碼已複製，請貼到 Chrome 擴充套件。")).catch(() => setMessage("無法複製配對碼，請確認剪貼簿權限。"))}>複製配對碼</Button>
      <Button variant="ghost" onClick={() => setPairing(null)}>隱藏配對碼</Button></section>}
    {(create.error || stop.error || command.error || sessions.error || detail.error || tasks.error) && <p role="alert" className="text-destructive">{(create.error || stop.error || command.error || sessions.error || detail.error || tasks.error)?.message}</p>}
    {message && <p role="status" className="text-sm">{message}</p>}
    <div className="flex flex-wrap gap-2">{sessions.data?.map(s => <div key={s.id} className="flex gap-1"><Button variant={selected === s.id ? "default" : "outline"} onClick={() => { setSelected(s.id); setPairing(null); setMessage(null); }}>{s.label} · {s.status === "connected" ? "已連線" : s.status === "waiting" ? "等待分享" : "已中斷"}</Button><Button variant="ghost" aria-label={`停止 ${s.label}`} disabled={stop.isPending} onClick={() => stop.mutate(s.id)}><Square className="size-4" /></Button></div>)}</div>
    {session && <section className="overflow-hidden rounded-xl border">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b p-3"><div><h2 className="font-medium">{session.label}</h2><p className="text-xs text-muted-foreground">{session.mode === "chrome" ? "你的 Chrome 分頁" : "雲端隔離瀏覽器"} · {session.status === "connected" ? "已連線" : "尚未連線"} · <Link className="underline" to={`/agents/${session.agentId}`}>指定 Agent</Link> · <Link className="underline" to={`/issues/${session.issueId}`}>來源任務</Link></p></div>
        <Button variant="destructive" disabled={stop.isPending} onClick={() => stop.mutate(session.id)}><Square className="size-4" />停止控制</Button></header>
      <form className="flex gap-2 border-b p-3" onSubmit={e => { e.preventDefault(); command.mutate({ action: "navigate", url }); }}>
        <Input aria-label="網站網址" type="url" placeholder={session.url || "https://"} value={url} onChange={e => setUrl(e.target.value)} />
        <Button disabled={session.status !== "connected" || !url.startsWith("https://") || command.isPending}>前往</Button>
      </form>
      <p className="break-all px-3 py-2 text-xs text-muted-foreground">{session.title} {session.url}</p>
      {session.frame ? <img className="block h-auto w-full" src={session.frame} alt={`${session.label}：${session.title || "已分享分頁"}`} /> : <p className="p-8 text-center text-sm text-muted-foreground">尚未收到分頁畫面，請在電腦 Chrome 按「分享這個分頁」。</p>}
    </section>}
  </div>;
}
