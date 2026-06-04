import { cn } from "@/lib/utils";
import type { BatchDownloadStatus } from "@/types/download";

export function CircularProgress({
  progress,
  size = 32,
  status,
}: {
  progress: number;
  size?: number;
  status?: BatchDownloadStatus;
}) {
  const stroke = 3;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c - (progress / 100) * c;
  const colorClass = status === "failed" ? "text-destructive" : "text-primary";
  return (
    <svg width={size} height={size} className="shrink-0 -rotate-90">
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth={stroke}
        className="text-muted/30"
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={offset}
        className={cn("transition-all duration-500", colorClass)}
      />
    </svg>
  );
}
