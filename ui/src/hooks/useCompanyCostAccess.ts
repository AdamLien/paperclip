import { useQuery } from "@tanstack/react-query";
import { accessApi, type CurrentBoardAccess } from "@/api/access";
import { queryKeys } from "@/lib/queryKeys";

/**
 * Whether a board may view company costs and budgets for `companyId`,
 * judged from the current board access snapshot.
 *
 * Local implicit boards and instance admins always pass. Otherwise the active
 * membership's server-reported `canViewCosts` decides, which includes explicit
 * grants; snapshots without it fall back to the owner and admin roles that
 * carry `costs:view` by default. The server stays authoritative.
 */
export function canViewCompanyCosts(
  companyId: string | null | undefined,
  boardAccess: CurrentBoardAccess | undefined,
): boolean {
  if (!boardAccess) return false;
  if (boardAccess.source === "local_implicit" || boardAccess.isInstanceAdmin) return true;
  if (!companyId) return false;
  const membership = boardAccess.memberships?.find(
    (item) => item.companyId === companyId && item.status === "active",
  );
  if (typeof membership?.canViewCosts === "boolean") return membership.canViewCosts;
  return membership?.membershipRole === "owner" || membership?.membershipRole === "admin";
}

/** Resolves to `undefined` until the board access snapshot has loaded. */
export function useCanViewCompanyCosts(companyId: string | null | undefined): boolean | undefined {
  const boardAccess = useQuery({
    queryKey: queryKeys.access.currentBoardAccess,
    queryFn: () => accessApi.getCurrentBoardAccess(),
    retry: false,
    staleTime: 30_000,
  });
  if (!boardAccess.isFetched) return undefined;
  return canViewCompanyCosts(companyId, boardAccess.data);
}
