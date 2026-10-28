import { useQuery } from "@tanstack/react-query";
import { accessApi, type CurrentBoardAccess } from "@/api/access";
import { queryKeys } from "@/lib/queryKeys";

/**
 * Whether a board manages `companyId`: local implicit boards, instance admins,
 * and active owner or admin members. Decides which home the workspace shows;
 * management data the role must not read is withheld by the server.
 */
export function isCompanyManager(
  companyId: string | null | undefined,
  boardAccess: CurrentBoardAccess | undefined,
): boolean {
  if (!boardAccess) return false;
  if (boardAccess.source === "local_implicit" || boardAccess.isInstanceAdmin) return true;
  if (!companyId) return false;
  const membership = boardAccess.memberships?.find(
    (item) => item.companyId === companyId && item.status === "active",
  );
  return membership?.membershipRole === "owner" || membership?.membershipRole === "admin";
}

/** Resolves to `undefined` until the board access snapshot has loaded. */
export function useIsCompanyManager(companyId: string | null | undefined): boolean | undefined {
  const boardAccess = useQuery({
    queryKey: queryKeys.access.currentBoardAccess,
    queryFn: () => accessApi.getCurrentBoardAccess(),
    retry: false,
    staleTime: 30_000,
  });
  if (!boardAccess.isFetched) return undefined;
  return isCompanyManager(companyId, boardAccess.data);
}
