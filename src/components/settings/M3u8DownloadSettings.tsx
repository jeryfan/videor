import type { SettingsFormState } from "@/hooks/useSettings";
import { Radio, Layers } from "lucide-react";

interface M3u8DownloadSettingsProps {
  concurrency: number | undefined;
  downloadConcurrency: number | undefined;
  onChange: (updates: Partial<SettingsFormState>) => void;
}

const M3U8_OPTIONS = [1, 4, 8, 16];
const DOWNLOAD_OPTIONS = [1, 2, 3, 4, 5];

export function M3u8DownloadSettings({
  concurrency,
  downloadConcurrency,
  onChange,
}: M3u8DownloadSettingsProps) {
  const m3u8Value = concurrency ?? 8;
  const downloadValue = downloadConcurrency ?? 3;

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2 border-b border-border/40 pb-2">
        <Layers className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-medium">下载并发</h3>
      </div>

      <div className="flex items-center justify-between gap-4 rounded-xl border border-border bg-card/50 p-4 transition-colors hover:bg-muted/50">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-background ring-1 ring-border">
            <Layers className="h-4 w-4 text-primary" />
          </div>
          <div className="min-w-0 space-y-1">
            <p className="truncate text-sm font-medium leading-none">
              同时下载任务数
            </p>
            <p className="text-xs text-muted-foreground">
              整个应用同时下载几个不同的视频，其余任务排队等待
            </p>
          </div>
        </div>
        <div className="inline-flex shrink-0 rounded-lg border border-border bg-background p-1">
          {DOWNLOAD_OPTIONS.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => onChange({ downloadConcurrency: option })}
              className={[
                "h-8 min-w-10 rounded-md px-3 text-sm transition-colors",
                downloadValue === option
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              ].join(" ")}
            >
              {option}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between gap-4 rounded-xl border border-border bg-card/50 p-4 transition-colors hover:bg-muted/50">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-background ring-1 ring-border">
            <Radio className="h-4 w-4 text-primary" />
          </div>
          <div className="min-w-0 space-y-1">
            <p className="truncate text-sm font-medium leading-none">
              M3U8 分片并发数
            </p>
            <p className="text-xs text-muted-foreground">
              单个 M3U8 视频同时下载几个 .ts 分片，数值越大越快但占用带宽越多
            </p>
          </div>
        </div>
        <div className="inline-flex shrink-0 rounded-lg border border-border bg-background p-1">
          {M3U8_OPTIONS.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => onChange({ m3u8Concurrency: option })}
              className={[
                "h-8 min-w-10 rounded-md px-3 text-sm transition-colors",
                m3u8Value === option
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
