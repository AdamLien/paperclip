import type { ToolConnection } from "@paperclipai/shared";
import { useCompany } from "@/context/CompanyContext";
import { translateUiLiteral, useUiLiteralLocale } from "@/i18n/LegacyLiteralLocalizer";

/** Resolve from the saved connection, never from whichever workspace is selected. */
export function ConnectionCompanyScope({ connection }: { connection: Pick<ToolConnection, "companyId"> }) {
  useUiLiteralLocale();
  const { companies, selectedCompany } = useCompany();
  const company = companies?.find((candidate) => candidate.id === connection.companyId)
    ?? (selectedCompany?.id === connection.companyId ? selectedCompany : null);
  return (
    <p className="mt-2 text-xs text-muted-foreground" data-testid="connection-company-scope">
      {translateUiLiteral("Crew workspace")}: <strong>{company?.name ?? translateUiLiteral("Workspace unavailable")}</strong>
      {company ? <span> · {translateUiLiteral("Only members and agents in this workspace can use this connection.")}</span> : null}
    </p>
  );
}
