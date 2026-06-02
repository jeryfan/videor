import { useTranslation } from "react-i18next";
import type { SettingsFormState } from "@/hooks/useSettings";
import { FolderDown, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";

interface DownloadDirectorySettingsProps {
  directory: string | undefined;
  onChange: (updates: Partial<SettingsFormState>) => void;
}

export function DownloadDirectorySettings({
  directory,
  onChange,
}: DownloadDirectorySettingsProps) {
  const { t } = useTranslation();

  const handlePickDirectory = async () => {
    try {
      const dir = await invoke<string | null>("pick_directory", {});
      if (dir) {
        onChange({ downloadDirectory: dir });
        toast.success(
          t("settings.downloadDirChanged", {
            defaultValue: "下载目录已更新",
          }),
        );
      }
    } catch (error) {
      console.error(
        "[DownloadDirectorySettings] Failed to pick directory:",
        error,
      );
      toast.error(
        t("settings.downloadDirPickFailed", {
          defaultValue: "选择目录失败",
        }),
      );
    }
  };

  const handleResetDefault = () => {
    onChange({ downloadDirectory: undefined });
    toast.success(
      t("settings.downloadDirReset", {
        defaultValue: "已恢复为系统默认下载目录",
      }),
    );
  };

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2 pb-2 border-b border-border/40">
        <FolderDown className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-medium">
          {t("settings.downloadDirectory", { defaultValue: "下载目录" })}
        </h3>
      </div>

      <div className="flex items-center justify-between gap-4 rounded-xl border border-border bg-card/50 p-4 transition-colors hover:bg-muted/50">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-background ring-1 ring-border">
            <FolderDown className="h-4 w-4 text-primary" />
          </div>
          <div className="space-y-1 min-w-0">
            <p
              className="text-sm font-medium leading-none truncate"
              title={directory}
            >
              {directory ||
                t("settings.downloadDirectoryDefault", {
                  defaultValue: "系统默认下载目录",
                })}
            </p>
            <p className="text-xs text-muted-foreground">
              {t("settings.downloadDirectoryDescription", {
                defaultValue: "视频下载的默认保存位置",
              })}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="outline"
            size="sm"
            onClick={handlePickDirectory}
            className="gap-1.5"
          >
            {t("settings.changeDirectory", { defaultValue: "更改" })}
          </Button>
          {directory !== undefined && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleResetDefault}
              className="gap-1.5 text-muted-foreground hover:text-foreground px-2"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}
