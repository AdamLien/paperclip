import { useQuery } from "@tanstack/react-query";
import { Settings2 } from "lucide-react";
import { authApi } from "../api/auth";
import { queryKeys } from "../lib/queryKeys";

/** Management is hosted from metabiz-web; capability checks use the current user and workspace. */
export function MorbitManagementLink({ companyId }: { companyId: string | null }) {
  const session = useQuery({ queryKey: queryKeys.auth.session, queryFn: authApi.getSession, retry: false });
  const userId = session.data?.user.id;
  const access = useQuery({
    queryKey: ["morbit-management-access", userId, companyId],
    enabled: Boolean(userId && companyId), retry: false, gcTime: 0, staleTime: 0,
    refetchOnMount: "always", refetchOnWindowFocus: "always", refetchInterval: 30_000,
    queryFn: async () => {
      const response = await fetch(`/api/companies/${encodeURIComponent(companyId!)}/morbit/access`, {
        credentials: "same-origin", cache: "no-store", signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) return false;
      const body = await response.json() as { data?: { can_manage_workspace?: boolean } };
      return body.data?.can_manage_workspace === true;
    },
  });
  if (!userId || access.isError || access.data !== true) return null;
  return <a href="/management/" className="flex items-center gap-2.5 mx-2 rounded-lg px-2 py-1.5 text-foreground/80 hover:bg-sidebar-accent" aria-label="能力與設定">
    <Settings2 className="h-4 w-4 shrink-0" /><span>能力與設定</span>
  </a>;
}
