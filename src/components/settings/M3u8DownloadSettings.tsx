import type { SettingsFormState } from "@/hooks/useSettings";
import { Radio, Layers, Gauge, FolderOpen, FolderTree } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { useTranslation } from "react-i18next";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface M3u8DownloadSettingsProps {
  concurrency: number | undefined;
  downloadConcurrency: number | undefined;
  downloadSpeedLimit: number | undefined;
  autoOpenAfterDownload: "none" | "open" | "reveal" | undefined;
  autoClassifyDownloads: boolean | undefined;
  batchParseIntervalMs: number | undefined;
  onChange: (updates: Partial<SettingsFormState>) => void;
}

const M3U8_OPTIONS = [1, 4, 8, 16];
const DOWNLOAD_OPTIONS = [1, 2, 3, 4, 5];
const BATCH_INTERVAL_OPTIONS = [500, 1000, 1500, 2000, 3000];

const AUTO_OPEN_OPTIONS: {
  value: "none" | "open" | "reveal";
  label: string;
}[] = [
  { value: "none", label: "无" },
  { value: "open", label: "打开文件" },
  { value: "reveal", label: "打开所在目录" },
];

export function M3u8DownloadSettings({
  concurrency,
  downloadConcurrency,
  downloadSpeedLimit,
  autoOpenAfterDownload,
  autoClassifyDownloads,
  batchParseIntervalMs,
  onChange,
}: M3u8DownloadSettingsProps) {
  const { t } = useTranslation();
  const m3u8Value = concurrency ?? 8;
  const downloadValue = downloadConcurrency ?? 3;
  const speedLimitMb = Math.round((downloadSpeedLimit ?? 0) / 1024);
  const autoOpenValue = autoOpenAfterDownload ?? "none";
  const classifyValue = autoClassifyDownloads ?? false;
  const batchIntervalValue = batchParseIntervalMs ?? 1500;

  const handleSpeedChange = (value: string) => {
    const num = parseInt(value, 10);
    if (Number.isNaN(num)) return;
    const clamped = Math.max(0, Math.min(50, num));
    onChange({ downloadSpeedLimit: clamped * 1024 });
  };

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2 border-b border-border/40 pb-2">
        <Layers className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-medium">
          {t("settings.tabDownload", { defaultValue: "下载" })}
        </h3>
      </div>

      <div className="flex items-center justify-between gap-4 rounded-xl border border-border bg-card/50 p-4 transition-colors hover:bg-muted/50">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-background ring-1 ring-border">
            <Layers className="h-4 w-4 text-primary" />
          </div>
          <div className="min-w-0 space-y-1">
            <p className="truncate text-sm font-medium leading-none">
              {t("settings.downloadConcurrency")}
            </p>
            <p className="text-xs text-muted-foreground">
              {t("settings.downloadConcurrencyHint")}
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
              {t("settings.m3u8Concurrency")}
            </p>
            <p className="text-xs text-muted-foreground">
              {t("settings.m3u8ConcurrencyHint")}
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

      <div className="flex items-center justify-between gap-4 rounded-xl border border-border bg-card/50 p-4 transition-colors hover:bg-muted/50">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-background ring-1 ring-border">
            <Gauge className="h-4 w-4 text-primary" />
          </div>
          <div className="min-w-0 space-y-1">
            <p className="truncate text-sm font-medium leading-none">
              {t("settings.speedLimit")}
            </p>
            <p className="text-xs text-muted-foreground">
              {t("settings.speedLimitHint")}
            </p>
          </div>
        </div>
        <div className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-border bg-background p-1">
          <input
            type="number"
            min={0}
            max={50}
            step={1}
            value={speedLimitMb}
            onChange={(e) => handleSpeedChange(e.target.value)}
            className="h-8 w-14 rounded-md bg-transparent px-2 text-sm text-right outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          />
          <span className="pr-2 text-xs text-muted-foreground">MB/s</span>
        </div>
      </div>

      <div className="flex items-center justify-between gap-4 rounded-xl border border-border bg-card/50 p-4 transition-colors hover:bg-muted/50">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-background ring-1 ring-border">
            <FolderOpen className="h-4 w-4 text-primary" />
          </div>
          <div className="min-w-0 space-y-1">
            <p className="truncate text-sm font-medium leading-none">
              {t("settings.autoOpenAfterDownload")}
            </p>
            <p className="text-xs text-muted-foreground">
              {t("settings.autoOpenAfterDownloadHint")}
            </p>
          </div>
        </div>
        <Select
          value={autoOpenValue}
          onValueChange={(value) =>
            onChange({
              autoOpenAfterDownload: value as "none" | "open" | "reveal",
            })
          }
        >
          <SelectTrigger className="h-8 w-36 shrink-0 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {AUTO_OPEN_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center justify-between gap-4 rounded-xl border border-border bg-card/50 p-4 transition-colors hover:bg-muted/50">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-background ring-1 ring-border">
            <FolderTree className="h-4 w-4 text-primary" />
          </div>
          <div className="min-w-0 space-y-1">
            <p className="truncate text-sm font-medium leading-none">
              {t("video.bilibili.autoClassify")}
            </p>
            <p className="text-xs text-muted-foreground">
              {t("video.bilibili.autoClassifyHint")}
            </p>
          </div>
        </div>
        <Switch
          checked={classifyValue}
          onCheckedChange={(checked) =>
            onChange({ autoClassifyDownloads: checked })
          }
        />
      </div>

      <div className="flex items-center justify-between gap-4 rounded-xl border border-border bg-card/50 p-4 transition-colors hover:bg-muted/50">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-background ring-1 ring-border">
            <Layers className="h-4 w-4 text-primary" />
          </div>
          <div className="min-w-0 space-y-1">
            <p className="truncate text-sm font-medium leading-none">
              {t("settings.batchParseInterval", { defaultValue: "批量解析间隔" })}
            </p>
            <p className="text-xs text-muted-foreground">
              {t("settings.batchParseIntervalHint", { defaultValue: "批量下载时两次解析之间的等待时间（毫秒）" })}
            </p>
          </div>
        </div>
        <div className="inline-flex shrink-0 rounded-lg border border-border bg-background p-1">
          {BATCH_INTERVAL_OPTIONS.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => onChange({ batchParseIntervalMs: option })}
              className={[
                "h-8 min-w-10 rounded-md px-3 text-sm transition-colors",
                batchIntervalValue === option
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              ].join(" ")}
            >
              {option}ms
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
