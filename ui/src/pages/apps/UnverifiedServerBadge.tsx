import { ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { translateUiLiteral, useUiLiteralLocale } from "@/i18n/LegacyLiteralLocalizer";

export function UnverifiedServerBadge({ host, className }: { host: string | null; className?: string }) {
  useUiLiteralLocale();
  return (
    <div className={cn("flex flex-wrap items-center gap-2 text-xs", className)}>
      <span title={translateUiLiteral("Added by URL, not verified through the connector catalog. This is separate from connection status and merchant authorization.")} className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 font-medium text-amber-700 dark:text-amber-400">
        <ShieldAlert className="h-3 w-3" />
        {translateUiLiteral("Unverified server")}
      </span>
      {host ? <span className="font-mono text-muted-foreground">{host}</span> : null}
    </div>
  );
}
