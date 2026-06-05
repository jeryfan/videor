import { useTranslation } from "react-i18next";
import { ArrowLeft, Settings, History, UserRound, LogOut } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { SourceSwitcher } from "@/components/SourceSwitcher";
import type { VideoSource } from "@/types/download";
import type { BilibiliLoginStatus } from "@/lib/api/videoParser";
import {
  DRAG_REGION_ATTR,
  DRAG_REGION_STYLE,
} from "@/lib/platform";

interface AppHeaderProps {
  showSettings: boolean;
  showHistory: boolean;
  activeSource: VideoSource;
  bilibiliStatus: BilibiliLoginStatus | null;
  onBackToMain: () => void;
  onShowSettings: () => void;
  onToggleHistory: () => void;
  onSwitchSource: (source: VideoSource) => void;
  onBilibiliLogin: () => void;
  onBilibiliLogout: () => void;
  dragBarHeight: number;
}

export function AppHeader({
  showSettings,
  showHistory,
  activeSource,
  bilibiliStatus,
  onBackToMain,
  onShowSettings,
  onToggleHistory,
  onSwitchSource,
  onBilibiliLogin,
  onBilibiliLogout,
  dragBarHeight,
}: AppHeaderProps) {
  const { t } = useTranslation();

  return (
    <header
      className="fixed z-50 w-full transition-all duration-300 bg-background/80 backdrop-blur-md"
      {...DRAG_REGION_ATTR}
      style={
        {
          ...DRAG_REGION_STYLE,
          top: dragBarHeight,
          height: 64,
        } as any
      }
    >
      <div
        className="grid h-full grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 px-6"
        {...DRAG_REGION_ATTR}
        style={{ ...DRAG_REGION_STYLE } as any}
      >
        <div
          className="flex min-w-0 items-center gap-2 justify-self-start"
          style={{ WebkitAppRegion: "no-drag" } as any}
        >
          {showSettings || showHistory ? (
            <Button
              variant="outline"
              size="icon"
              onClick={onBackToMain}
              className="mr-2 rounded-lg"
            >
              <ArrowLeft className="w-4 h-4" />
            </Button>
          ) : null}
          <span className="text-xl font-semibold text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300 transition-colors">
            {showSettings
              ? t("settings.title")
              : showHistory
                ? t("download.historyTitle", { defaultValue: "下载历史" })
                : "Videor"}
          </span>
          {!showSettings && !showHistory && (
            <Button
              variant="ghost"
              size="icon"
              onClick={onShowSettings}
              title={t("common.settings")}
              className="hover:bg-black/5 dark:hover:bg-white/5"
            >
              <Settings className="w-4 h-4" />
            </Button>
          )}
        </div>

        {!showSettings && !showHistory && (
          <div
            className="min-w-0 justify-self-center"
            style={{ WebkitAppRegion: "no-drag" } as any}
          >
            <SourceSwitcher
              activeSource={activeSource}
              onSwitch={onSwitchSource}
            />
          </div>
        )}

        <div
          className="flex items-center gap-2 justify-self-end"
          style={{ WebkitAppRegion: "no-drag" } as any}
        >
          {!showSettings && !showHistory && activeSource === "bilibili" && (
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  bilibiliStatus?.logged_in
                    ? void onBilibiliLogout()
                    : void onBilibiliLogin()
                }
                title={
                  bilibiliStatus?.logged_in
                    ? `Bilibili: ${bilibiliStatus.username || t("video.bilibili.loggedIn")}`
                    : t("video.bilibili.scanLogin")
                }
                className={cn(
                  "h-8 gap-1.5 px-2 hover:bg-black/5 dark:hover:bg-white/5",
                  bilibiliStatus?.logged_in && "text-emerald-600",
                )}
              >
                {bilibiliStatus?.logged_in ? (
                  <LogOut className="h-4 w-4" />
                ) : (
                  <UserRound className="h-4 w-4" />
                )}
                <span className="hidden text-xs lg:inline">
                  {bilibiliStatus?.logged_in
                    ? bilibiliStatus.username || t("video.bilibili.loggedIn")
                    : t("video.bilibili.login")}
                </span>
              </Button>
            </div>
          )}
          {!showSettings && !showHistory && (
            <Button
              variant="ghost"
              size="icon"
              onClick={onToggleHistory}
              title={t("download.history", { defaultValue: "下载历史" })}
              className={cn(
                "hover:bg-black/5 dark:hover:bg-white/5",
                showHistory && "bg-black/5 dark:bg-white/10",
              )}
            >
              <History className="w-5 h-5" />
            </Button>
          )}
        </div>
      </div>
    </header>
  );
}
