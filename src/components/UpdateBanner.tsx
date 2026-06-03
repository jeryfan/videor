import { useState, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, Download, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useUpdate } from "@/contexts/UpdateContext";
import { relaunchApp } from "@/lib/updater";
import { toast } from "sonner";

export function UpdateBanner() {
  const { t } = useTranslation();
  const {
    hasUpdate,
    updateInfo,
    updateHandle,
    isDismissed,
    dismissUpdate,
    error: updateError,
  } = useUpdate();
  const [phase, setPhase] = useState<"idle" | "downloading" | "done" | "error">(
    "idle",
  );
  const [progress, setProgress] = useState(0);
  const totalRef = useRef(0);
  const downloadedRef = useRef(0);

  const handleUpdate = useCallback(async () => {
    if (!updateHandle) return;
    setPhase("downloading");
    setProgress(0);
    totalRef.current = 0;
    downloadedRef.current = 0;

    try {
      await updateHandle.downloadAndInstall((evt) => {
        if (evt.event === "Started") {
          totalRef.current = evt.total ?? 0;
          downloadedRef.current = 0;
        } else if (evt.event === "Progress") {
          downloadedRef.current += evt.downloaded ?? 0;
          if (totalRef.current > 0) {
            setProgress(
              Math.min((downloadedRef.current / totalRef.current) * 100, 99),
            );
          }
        } else if (evt.event === "Finished") {
          setProgress(100);
          setPhase("done");
        }
      });
      // downloadAndInstall 完成后（无异常），说明已下载+安装完成
      if (phase !== "done") {
        setProgress(100);
        setPhase("done");
      }
    } catch (err) {
      console.error("[UpdateBanner] Download/install failed:", err);
      toast.error(t("updateBanner.downloadFailed"));
      setPhase("error");
      setProgress(0);
    }
  }, [updateHandle, phase]);

  const handleRelaunch = useCallback(async () => {
    setPhase("done");
    try {
      await relaunchApp();
    } catch (err) {
      console.error("[UpdateBanner] Relaunch failed:", err);
      toast.error("重启失败，请手动重启应用");
    }
  }, []);

  if (!hasUpdate || isDismissed) return null;

  return (
    <div className="shrink-0 w-full bg-primary/10 border-b border-primary/20 px-6 py-3 animate-fade-in">
      <div className="mx-auto w-full max-w-full sm:max-w-3xl md:max-w-4xl lg:max-w-5xl xl:max-w-6xl flex items-center justify-between gap-3">
        <div className="min-w-0 flex items-center gap-2">
          <Download className="h-4 w-4 shrink-0 text-primary" />
          <div>
            <p className="text-sm font-medium text-foreground">
              {t("updateBanner.title", {
                version: updateInfo?.availableVersion,
              })}
            </p>
            <p className="text-xs text-muted-foreground truncate">
              {t("updateBanner.currentVersion", {
                version: updateInfo?.currentVersion,
              })}
              {updateInfo?.notes ? ` · ${updateInfo.notes}` : ""}
              {updateError ? ` · ${updateError}` : ""}
            </p>
          </div>
        </div>
        <div className="shrink-0 flex items-center gap-2">
          {phase === "idle" && (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={dismissUpdate}
                className="h-8 px-2 text-xs"
              >
                {t("updateBanner.later")}
              </Button>
              <Button
                size="sm"
                onClick={() => void handleUpdate()}
                className="h-8 px-3 text-xs"
              >
                {t("updateBanner.updateNow")}
              </Button>
            </>
          )}
          {phase === "downloading" && (
            <div className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              <span className="text-xs text-muted-foreground tabular-nums">
                {t("updateBanner.downloading")} {progress.toFixed(0)}%
              </span>
            </div>
          )}
          {phase === "done" && (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={dismissUpdate}
                className="h-8 px-2 text-xs"
              >
                {t("updateBanner.restartLater")}
              </Button>
              <Button
                size="sm"
                onClick={() => void handleRelaunch()}
                className="h-8 px-3 text-xs gap-1"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                {t("updateBanner.restartApp")}
              </Button>
            </>
          )}
          {phase === "error" && (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={dismissUpdate}
                className="h-8 px-2 text-xs"
              >
                {t("updateBanner.close")}
              </Button>
              <Button
                size="sm"
                onClick={() => void handleUpdate()}
                className="h-8 px-3 text-xs"
              >
                {t("updateBanner.retry")}
              </Button>
            </>
          )}
        </div>
      </div>
      {phase === "downloading" && totalRef.current > 0 && (
        <div className="mt-2.5 h-1 w-full bg-primary/10 rounded-full overflow-hidden">
          <div
            className="h-full bg-primary transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}
    </div>
  );
}
