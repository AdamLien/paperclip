import type { SVGProps } from "react";
import { cn } from "../lib/utils";

export function AnimatedPaperclipIcon({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="-1 -1 26 26"
      className={cn("paperclip-thinking-icon", className)}
      aria-hidden="true"
      {...props}
    >
      <path
        className="paperclip-thinking-icon-path"
        d="M16 6 l-8.414 8.586 a2.000 2.000 0 0 0 2.828 2.828 l8.414 -8.586 a4.000 4.000 0 1 0 -5.657 -5.657 l-8.379 8.551 a6.000 6.000 0 1 0 8.485 8.485 l8.379 -8.551"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Full-page loading state using the metabiz Crew product branding. */
export function PaperclipLoading({ className }: { className?: string }) {
  return (
    <div
      role="status"
      className={cn("flex min-h-dvh w-full flex-col items-center justify-center gap-4", className)}
    >
      <div className="relative">
        <img
          src="/metabiz-crew-logo.png"
          alt=""
          className="h-24 w-24 object-contain motion-safe:animate-pulse"
        />
        <span className="absolute -right-4 top-1 whitespace-nowrap text-xl font-bold tracking-widest text-red-500">CREW</span>
      </div>
      <span className="text-lg font-semibold tracking-wide">metabiz Crew</span>
      <span className="sr-only">正在載入…</span>
    </div>
  );
}
