import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  CheckCircle2,
  Download,
  Loader2,
  RefreshCw,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

interface FfmpegStatus {
  installed: boolean;
  path?: string;
  version?: string;
}

export function FfmpegSettings() {
  const [status, setStatus] = useState<FfmpegStatus | null>(null);
  const [isChecking, setIsChecking] = useState(false);

  const refresh = useCallback(async () => {
    setIsChecking(true);
    try {
      setStatus(await invoke<FfmpegStatus>("get_ffmpeg_status"));
    } catch (error) {
      console.error("[FfmpegSettings] Failed to check ffmpeg:", error);
      toast.error("检测 ffmpeg 失败");
      setStatus({ installed: false });
    } finally {
      setIsChecking(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleInstall = async () => {
    try {
      await invoke("open_ffmpeg_install_page");
    } catch (error) {
      console.error("[FfmpegSettings] Failed to open install page:", error);
      toast.error("打开安装页面失败");
    }
  };

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2 border-b border-border/40 pb-2">
        <Download className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-medium">FFmpeg</h3>
      </div>

      <div className="flex items-center justify-between gap-4 rounded-xl border border-border bg-card/50 p-4 transition-colors hover:bg-muted/50">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-background ring-1 ring-border">
            {isChecking ? (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            ) : status?.installed ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            ) : (
              <XCircle className="h-4 w-4 text-destructive" />
            )}
          </div>
          <div className="min-w-0 space-y-1">
            <p className="truncate text-sm font-medium leading-none">
              {status?.installed
                ? status.version || "已安装"
                : "未检测到 ffmpeg"}
            </p>
            <p
              className="truncate text-xs text-muted-foreground"
              title={status?.path}
            >
              {status?.installed
                ? status.path || "可用于 M3U8 下载、转封装和合流"
                : "M3U8 下载需要 ffmpeg"}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void refresh()}
            disabled={isChecking}
            className="gap-1.5"
          >
            {isChecking ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            检测
          </Button>
          {!status?.installed && (
            <Button
              size="sm"
              onClick={() => void handleInstall()}
              className="gap-1.5"
            >
              <Download className="h-3.5 w-3.5" />
              安装
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}
