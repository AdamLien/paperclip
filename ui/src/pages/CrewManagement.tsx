import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/api/client";
import { useCompany } from "@/context/CompanyContext";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { Link } from "@/lib/router";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Agent = { id: string; name: string; title: string | null; status: string; model: string | null;
  desiredSkills: Array<string | { key: string; versionId?: string }> };
type Connection = { id: string; name: string; status: string; enabled: boolean;
  healthStatus: string | null; identities: Array<{ id: string; kind: string; userId?: string; agentId?: string;
    userName: string | null; audience: "company" | "owner" | Array<{ id: string; name: string | null }>;
    tenantName: string | null; tenantId: string | null }>;
  installs: Array<{ targetType: string; targetId: string }>;
  lastSuccessfulCall: { toolName: string; at: string } | null };
type Overview = { companyId: string; checkedAt: string; agents: Agent[];
  skills: Array<{ id: string; key: string; name: string; currentVersionId: string | null }>;
  connections: Connection[]; history: Array<{ id: string; action: string; createdAt: string }>;
  runtime: { installCommand: string; inspectCommand: string; note: string } };
const statuses: Record<string, string> = { idle: "待命", running: "執行中", paused: "已暫停",
  error: "需要處理", active: "啟用中", pending_approval: "等待核准", connected: "已連線",
  draft: "待設定", ready: "就緒" };
const date = (value: string) => new Date(value).toLocaleString("zh-TW");

export function CrewManagement() {
  const { selectedCompanyId, selectedCompany } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  useEffect(() => { setBreadcrumbs([{ label: "公司設定", href: "/company/settings" }, { label: "能力與設定" }]); }, [setBreadcrumbs]);
  const query = useQuery({ queryKey: ["crew-management", selectedCompanyId],
    queryFn: () => api.get<Overview>(`/companies/${selectedCompanyId}/management`),
    enabled: Boolean(selectedCompanyId) });
  const data = query.data;
  if (!selectedCompanyId) return <p className="p-6">請先選擇公司。</p>;
  const secretary = data?.agents.find(agent => agent.name.toLowerCase() === "sammi");
  return <div className="mx-auto w-full max-w-5xl space-y-6 p-4 sm:p-6">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h1 className="text-xl font-semibold">能力與設定</h1>
        <p className="mt-2 text-sm text-muted-foreground">目前公司：{selectedCompany?.name}。本頁只列出這家公司的資料。</p></div>
      <div className="flex flex-wrap gap-2">
        {secretary && <Button asChild><Link to={`/chats/${secretary.id}`}>交給 sammi 設定</Link></Button>}
        <Button variant="outline" disabled={query.isFetching} onClick={() => void query.refetch()}>重新檢查</Button>
      </div>
    </div>
    {query.isPending && <p role="status">正在讀取公司能力…</p>}
    {query.isError && <p role="alert" className="text-destructive">無法讀取設定：{query.error.message}</p>}
    {data && <>
      <p className="text-xs text-muted-foreground">檢查時間：{date(data.checkedAt)}。技能指派、帳號授權與實際執行成果會分別標示。</p>
      <Card><CardHeader><CardTitle>AI 代理</CardTitle></CardHeader><CardContent className="space-y-3">
        {data.agents.map(agent => <div key={agent.id} className="rounded-md border p-3">
          <div className="flex flex-wrap items-center justify-between gap-2"><Link className="font-medium underline" to={`/agents/${agent.id}`}>{agent.name}</Link>
            <span className="text-sm text-muted-foreground">{statuses[agent.status] ?? "狀態待確認"}</span></div>
          {agent.title && <p className="mt-1 text-sm">{agent.title}</p>}
          <p className="mt-2 break-words text-sm text-muted-foreground">模型：{agent.model ?? "沿用執行器預設"}</p>
          <p className="mt-1 break-words text-sm text-muted-foreground">已指派 {agent.desiredSkills.length} 項技能</p>
          <details className="mt-1 text-sm text-muted-foreground"><summary className="cursor-pointer">查看技能</summary>
            <p className="mt-1 break-words">{agent.desiredSkills.map(skill => { const key = typeof skill === "string" ? skill : skill.key; return data.skills.find(item => item.key === key)?.name ?? key.split("/").pop(); }).join("、") || "未指定"}</p>
          </details>
          <p className="mt-1 text-xs text-muted-foreground">可由 sammi 調整職責、模型與技能，設定保留版本。能否完成工作仍須實際執行驗證。</p>
        </div>)}
      </CardContent></Card>
      <Card><CardHeader><CardTitle>技能與執行環境</CardTitle></CardHeader><CardContent className="space-y-3">
        <p className="text-sm">可請 sammi 安裝或更新公司技能、檢查依賴，再交由指定 Agent 實測。</p>
        <details className="text-sm"><summary className="cursor-pointer">查看公司技能目錄（{data.skills.length} 項）</summary>
          {data.skills.length ? <ul className="mt-3 space-y-2">{data.skills.map(skill => <li key={skill.id} className="break-words">{skill.name} <span className="text-muted-foreground">{skill.currentVersionId ? " · 已有公司版本" : " · 來源同步技能"}</span></li>)}</ul> : <p className="mt-3 text-muted-foreground">尚無公司技能紀錄；這不包含主機上另外安裝的工具。</p>}
        </details>
        <details className="rounded-md border p-3 text-sm"><summary className="cursor-pointer">受管工具的安裝與還原</summary>
          <p className="my-2">目前提供固定版本的影音工具組。只安裝到當前公司的沙箱目錄，保留上個版本供還原。</p>
          <code className="block overflow-x-auto py-1">{data.runtime.installCommand}</code>
          <code className="block overflow-x-auto py-1">{data.runtime.inspectCommand}</code>
          <p className="mt-2 text-muted-foreground">{data.runtime.note}</p>
        </details>
      </CardContent></Card>
      <Card><CardHeader><CardTitle>連接器與資料範圍</CardTitle></CardHeader><CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">OAuth 完成、工具呼叫成功、外部租戶驗證是不同的證據。未驗證租戶前，不能據此確認連到申皇或 metabiz。</p>
        {data.connections.map(connection => <div key={connection.id} className="space-y-2 rounded-md border p-3 text-sm">
          <Link className="break-words font-medium underline" to={`/apps/${connection.id}/permissions`}>{connection.name}</Link>
          <p>{connection.enabled ? "連線已啟用" : "連線已停用"} · {statuses[connection.status] ?? "請檢查連線狀態"}</p>
          {connection.identities.length ? connection.identities.map(identity => <div key={identity.id} className="space-y-1 rounded bg-muted/40 p-2">
            <p className="break-all">授權身分：{identity.userName ?? identity.userId ?? identity.agentId ?? "組織共用身分"}</p>
            <p className="break-words">可使用的成員：{identity.audience === "company" ? "此公司所有成員" : identity.audience === "owner" ? "僅此身分的擁有人" : identity.audience.map(member => member.name ?? member.id).join("、")}</p>
            <p className="break-all">外部租戶：{identity.tenantName ?? "尚未記錄名稱"} · {identity.tenantId ?? "尚未記錄租戶 ID"}</p>
            <p className="text-xs text-muted-foreground">以上為授權紀錄；尚未由本頁驗證實際業務資料所屬租戶。</p>
          </div>) : <p>尚無有效授權身分。</p>}
          <p>安裝範圍：{connection.installs.some(item => item.targetType === "company") ? "此公司的代理（仍須符合身分與工具權限）" : `${connection.installs.length} 個指定安裝對象（仍須符合身分與工具權限）`}</p>
          <p>最近成功呼叫：{connection.lastSuccessfulCall ? `${connection.lastSuccessfulCall.toolName} · ${date(connection.lastSuccessfulCall.at)}` : "尚無本頁可確認的成功紀錄"}</p>
        </div>)}
        {!data.connections.length && <p className="text-sm">尚無連接器。</p>}
        <Button variant="outline" asChild><Link to="/apps">管理連線與授權對象</Link></Button>
      </CardContent></Card>
      <details className="rounded-lg border p-4"><summary className="cursor-pointer font-medium">最近設定異動</summary>
        <ul className="mt-3 space-y-2 text-xs text-muted-foreground">{data.history.map(event => <li key={event.id} className="break-words">{date(event.createdAt)} · {event.action}</li>)}</ul>
        {!data.history.length && <p className="mt-3 text-sm">尚無異動紀錄。</p>}
      </details>
    </>}
  </div>;
}
