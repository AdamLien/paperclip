import { cn } from "../lib/utils";

/** Full-page loading state using the existing mDeck identity. */
export function PaperclipLoading({ className }: { className?: string }) {
  return (
    <div
      role="status"
      className={cn("flex min-h-dvh w-full items-center justify-center", className)}
    >
      <div className="morbit-loading-mark" aria-hidden="true">
        <span className="morbit-loading-orbit" />
        <img className="morbit-loading-logo" src="/mdeck-app.png" alt="" />
      </div>
      <span className="sr-only">Loading…</span>
    </div>
  );
}
