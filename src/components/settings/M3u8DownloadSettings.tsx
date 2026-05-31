import type { SettingsFormState } from "@/hooks/useSettings";
import { Radio } from "lucide-react";

interface M3u8DownloadSettingsProps {
  concurrency: number | undefined;
  onChange: (updates: Partial<SettingsFormState>) => void;
}

const OPTIONS = [1, 4, 8, 16];

export function M3u8DownloadSettings({
  concurrency,
  onChange,
}: M3u8DownloadSettingsProps) {
  const value = concurrency ?? 8;

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2 border-b border-border/40 pb-2">
        <Radio className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-medium">M3U8</h3>
      </div>

      <div className="flex items-center justify-between gap-4 rounded-xl border border-border bg-card/50 p-4 transition-colors hover:bg-muted/50">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-background ring-1 ring-border">
            <Radio className="h-4 w-4 text-primary" />
          </div>
          <div className="min-w-0 space-y-1">
            <p className="truncate text-sm font-medium leading-none">
              分片并发数
            </p>
            <p className="text-xs text-muted-foreground">
              普通 VOD HLS 使用并发分片下载，复杂流会自动回退 ffmpeg
            </p>
          </div>
        </div>
        <div className="inline-flex shrink-0 rounded-lg border border-border bg-background p-1">
          {OPTIONS.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => onChange({ m3u8Concurrency: option })}
              className={[
                "h-8 min-w-10 rounded-md px-3 text-sm transition-colors",
                value === option
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              ].join(" ")}
            >
              {option}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
