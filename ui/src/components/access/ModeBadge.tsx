import { translateUiLiteral, useUiLiteralLocale } from "@/i18n/LegacyLiteralLocalizer";
import type { DeploymentExposure, DeploymentMode } from "@paperclipai/shared";
import { Badge } from "@/components/ui/badge";

export function ModeBadge({
  deploymentMode,
  deploymentExposure,
}: {
  deploymentMode?: DeploymentMode;
  deploymentExposure?: DeploymentExposure;
}) {
  useUiLiteralLocale();
  if (!deploymentMode) return null;

  const label =
    deploymentMode === "local_trusted"
      ? "Local trusted"
      : `Authenticated ${deploymentExposure ?? "private"}`;

  return <Badge variant="outline">{translateUiLiteral(label)}</Badge>;
}
