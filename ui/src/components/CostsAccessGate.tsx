import type { ReactNode } from "react";
import { DollarSign } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { useCompany } from "@/context/CompanyContext";
import { useCanViewCompanyCosts } from "@/hooks/useCompanyCostAccess";

export function CostsAccessGate({ children }: { children: ReactNode }) {
  const { selectedCompanyId } = useCompany();
  const canView = useCanViewCompanyCosts(selectedCompanyId);
  if (canView === undefined) return null;
  if (!canView) {
    return <EmptyState icon={DollarSign} message="You don't have permission to view costs and budgets." />;
  }
  return <>{children}</>;
}
