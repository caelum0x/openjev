import { cn } from "@/lib/utils";

export function Mark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={cn("text-fg", className)}
      aria-hidden="true"
    >
      <rect x="4" y="12" width="3.2" height="8" rx="0.6" fill="currentColor" opacity="0.45" />
      <rect x="10.4" y="7" width="3.2" height="13" rx="0.6" fill="currentColor" opacity="0.75" />
      <rect x="16.8" y="3" width="3.2" height="17" rx="0.6" fill="currentColor" />
    </svg>
  );
}
