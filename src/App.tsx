import { useEffect, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  Settings,
  History,
  ArrowLeft,
  Minus,
  Maximize2,
  Minimize2,
  X,
  Search,
  Music2,
  Tv,
  Radio,
  Link2,
  Download,
  Loader2,
} from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { SettingsPage } from "@/components/settings/SettingsPage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  isWindows,
  isLinux,
  DRAG_REGION_ATTR,
  DRAG_REGION_STYLE,
} from "@/lib/platform";
import { useSettingsQuery } from "@/lib/query";
import { settingsApi } from "@/lib/api";
import type { Settings as AppSettings } from "@/types";
import { extractErrorMessage } from "@/utils/errorUtils";
import { parseVideo, type VideoFormat } from "@/lib/api/videoParser";
import {
  startVideoDownload,
  cancelVideoDownload,
  listenDownloadProgress,
} from "@/lib/api/download";
import { invoke } from "@tauri-apps/api/core";

const DEFAULT_DRAG_BAR_HEIGHT = isWindows() || isLinux() ? 0 : 28; // px
const HEADER_HEIGHT = 64; // px
const VIDEO_SOURCE_STORAGE_KEY = "videor-active-source";

type VideoSource = "douyin" | "bilibili" | "m3u8" | "other";

const VIDEO_SOURCES: Array<{
  id: VideoSource;
  label: string;
  icon: typeof Music2;
}> = [
  { id: "douyin", label: "抖音", icon: Music2 },
  { id: "bilibili", label: "Bilibili", icon: Tv },
  { id: "m3u8", label: "M3U8", icon: Radio },
  { id: "other", label: "其他", icon: Link2 },
];

const getInitialVideoSource = (): VideoSource => {
  const saved = localStorage.getItem(VIDEO_SOURCE_STORAGE_KEY) as
    | VideoSource
    | null;
  if (saved && VIDEO_SOURCES.some((source) => source.id === saved)) {
    return saved;
  }
  return "douyin";
};

function SourceSwitcher({
  activeSource,
  onSwitch,
}: {
  activeSource: VideoSource;
  onSwitch: (source: VideoSource) => void;
}) {
  const handleSwitch = (source: VideoSource) => {
    if (source === activeSource) return;
    localStorage.setItem(VIDEO_SOURCE_STORAGE_KEY, source);
    onSwitch(source);
  };

  return (
    <div className="inline-flex max-w-full items-center gap-1 rounded-xl bg-muted p-1">
      {VIDEO_SOURCES.map(({ id, label, icon: Icon }) => {
        const isActive = id === activeSource;
        return (
          <button
            key={id}
            type="button"
            onClick={() => handleSwitch(id)}
            title={label}
            className={cn(
              "group inline-flex h-8 items-center rounded-md px-3 text-sm font-medium transition-all duration-200",
              isActive
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:bg-background/50 hover:text-foreground",
            )}
          >
            <Icon className="h-4 w-4 shrink-0" />
            <span className="ml-2 whitespace-nowrap transition-all duration-200 max-[760px]:ml-0 max-[760px]:max-w-0 max-[760px]:overflow-hidden max-[760px]:opacity-0">
              {label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function App() {
  const { t } = useTranslation();
  const [showSettings, setShowSettings] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [activeSource, setActiveSource] = useState<VideoSource>(
    getInitialVideoSource,
  );
  const [downloadUrl, setDownloadUrl] = useState("");
  const [isWindowMaximized, setIsWindowMaximized] = useState(false);
  const [videoFormats, setVideoFormats] = useState<VideoFormat[]>([]);
  const [selectedFormatIdx, setSelectedFormatIdx] = useState(0);
  const [videoTitle, setVideoTitle] = useState("");

  const [videoCover, setVideoCover] = useState("");
  const [videoPlatform, setVideoPlatform] = useState("");
  const [parseStatus, setParseStatus] = useState<
    "idle" | "parsing" | "success" | "error"
  >("idle");

  // 下载状态
  const [downloadTaskId, setDownloadTaskId] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [downloadSpeed, setDownloadSpeed] = useState(0);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const { data: settingsData } = useSettingsQuery();
  const useAppWindowControls =
    isLinux() && (settingsData?.useAppWindowControls ?? false);
  const dragBarHeight = useAppWindowControls ? 32 : DEFAULT_DRAG_BAR_HEIGHT;
  const contentTopOffset = dragBarHeight + HEADER_HEIGHT;
  const videoPlatformLabel =
    videoPlatform === "douyin"
      ? "抖音"
      : videoPlatform === "bilibili"
        ? "B站"
        : videoPlatform
          ? "直链"
          : "";
  const downloadPlaceholder =
    activeSource === "douyin"
      ? "粘贴抖音视频链接，按 Enter 开始解析..."
      : activeSource === "bilibili"
        ? "粘贴 Bilibili 视频、合集或充电合集链接..."
        : activeSource === "m3u8"
          ? "粘贴 M3U8 播放列表链接，按 Enter 开始解析..."
          : "粘贴视频链接，按 Enter 开始解析...";

  useEffect(() => {
    let active = true;
    let unlistenResize: (() => void) | undefined;

    const setupWindowStateSync = async () => {
      try {
        const currentWindow = getCurrentWindow();
        const syncWindowMaximizedState = async () => {
          const maximized = await currentWindow.isMaximized();
          if (active) {
            setIsWindowMaximized(maximized);
          }
        };

        await syncWindowMaximizedState();
        unlistenResize = await currentWindow.onResized(() => {
          void syncWindowMaximizedState();
        });
      } catch (error) {
        console.error("[App] Failed to sync window maximized state", error);
      }
    };

    void setupWindowStateSync();
    return () => {
      active = false;
      unlistenResize?.();
    };
  }, []);

  useEffect(() => {
    if (!settingsData) return;
    const syncWindowDecorations = async () => {
      try {
        await getCurrentWindow().setDecorations(!useAppWindowControls);
      } catch (error) {
        console.error("[App] Failed to update window decorations", error);
      }
    };
    void syncWindowDecorations();
  }, [useAppWindowControls, settingsData]);

  const notifyWindowControlError = (error: unknown) => {
    toast.error(
      t("notifications.windowControlFailed", {
        defaultValue: "窗口控制失败：{{error}}",
        error: extractErrorMessage(error),
      }),
    );
  };

  const handleWindowMinimize = async () => {
    try {
      await getCurrentWindow().minimize();
    } catch (error) {
      console.error("[App] Failed to minimize window", error);
      notifyWindowControlError(error);
    }
  };

  const handleWindowToggleMaximize = async () => {
    try {
      const currentWindow = getCurrentWindow();
      await currentWindow.toggleMaximize();
      setIsWindowMaximized(await currentWindow.isMaximized());
    } catch (error) {
      console.error("[App] Failed to toggle maximize", error);
      notifyWindowControlError(error);
    }
  };

  const handleWindowClose = async () => {
    try {
      await getCurrentWindow().close();
    } catch (error) {
      console.error("[App] Failed to close window", error);
      notifyWindowControlError(error);
    }
  };

  const handleDownload = useCallback(async () => {
    const rawInput = downloadUrl.trim();
    if (!rawInput) {
      toast.error(t("download.emptyUrl", { defaultValue: "请输入视频链接" }));
      return;
    }

    // 重置状态
    setParseStatus("parsing");
    setVideoFormats([]);
    setSelectedFormatIdx(0);
    setVideoTitle("");

    setVideoCover("");
    setVideoPlatform("");

    try {
      const info = await parseVideo(rawInput);
      setVideoFormats(info.formats);
      setVideoTitle(info.title);
      setVideoCover(info.cover_url || "");
      setVideoPlatform(info.platform);
      setParseStatus("success");
    } catch (error) {
      console.error("[VideoParser] Failed to parse:", error);
      toast.error(extractErrorMessage(error) || "视频解析失败");
      setParseStatus("error");
    }
  }, [downloadUrl, t]);

  // 监听下载进度
  useEffect(() => {
    let unlisten: (() => void) | undefined;

    const setup = async () => {
      unlisten = await listenDownloadProgress((progress) => {
        setDownloadProgress(
          progress.total && progress.total > 0
            ? Math.round((progress.downloaded / progress.total) * 100)
            : 0,
        );
        setDownloadSpeed(progress.speed);

        if (progress.status === "completed") {
          toast.success("下载完成");
          setDownloadTaskId(null);
        } else if (progress.status === "failed") {
          setDownloadError("下载失败");
          toast.error("下载失败");
          setDownloadTaskId(null);
        } else if (progress.status === "cancelled") {
          toast.info("下载已取消");
          setDownloadTaskId(null);
        }
      });
    };

    void setup();
    return () => {
      unlisten?.();
    };
  }, []);

  const handleStartDownload = useCallback(async () => {
    if (videoFormats.length === 0 || !videoTitle) {
      toast.error("视频信息不完整，无法下载");
      return;
    }

    try {
      let dir: string | null = settingsData?.downloadDirectory ?? null;

      // 没有默认目录时，弹出选择器
      if (!dir) {
        dir = await invoke<string | null>("pick_directory", {});
        if (!dir) {
          toast.info("未选择保存目录");
          return;
        }
        // 保存为默认目录
        try {
          await settingsApi.save({
            ...settingsData,
            downloadDirectory: dir,
          } as AppSettings);
        } catch (e) {
          console.warn("[Download] Failed to save default directory:", e);
        }
      }

      setDownloadError(null);
      setDownloadProgress(0);
      setDownloadSpeed(0);

      const format = videoFormats[selectedFormatIdx];
      toast.info(`开始下载: ${videoTitle}`);
      const taskId = await startVideoDownload(videoTitle, format, dir);
      setDownloadTaskId(taskId);
    } catch (error) {
      console.error("[Download] Failed to start:", error);
      toast.error(extractErrorMessage(error) || "启动下载失败");
    }
  }, [videoFormats, videoTitle, selectedFormatIdx, settingsData]);

  const handleCancelDownload = useCallback(async () => {
    if (!downloadTaskId) return;
    try {
      await cancelVideoDownload(downloadTaskId);
    } catch (error) {
      console.error("[Download] Failed to cancel:", error);
    }
  }, [downloadTaskId]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      void handleDownload();
    }
  };

  return (
    <div
      className="flex flex-col h-screen overflow-hidden bg-background text-foreground selection:bg-primary/30 pb-4"
      style={{ overflowX: "hidden", paddingTop: contentTopOffset }}
    >
      {(dragBarHeight > 0 || useAppWindowControls) && (
        <div
          className="fixed top-0 left-0 right-0 z-[70] flex items-center justify-end px-2"
          data-tauri-drag-region
          style={{ WebkitAppRegion: "drag", height: dragBarHeight } as any}
        >
          {useAppWindowControls && (
            <div
              className="flex items-center gap-1"
              style={{ WebkitAppRegion: "no-drag" } as any}
            >
              <Button
                variant="ghost"
                size="icon"
                onClick={() => void handleWindowMinimize()}
                title={t("header.windowMinimize")}
                className="h-7 w-7"
              >
                <Minus className="w-4 h-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => void handleWindowToggleMaximize()}
                title={
                  isWindowMaximized
                    ? t("header.windowRestore")
                    : t("header.windowMaximize")
                }
                className="h-7 w-7"
              >
                {isWindowMaximized ? (
                  <Minimize2 className="w-4 h-4" />
                ) : (
                  <Maximize2 className="w-4 h-4" />
                )}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => void handleWindowClose()}
                title={t("header.windowClose")}
                className="h-7 w-7 hover:bg-red-500/15 hover:text-red-500"
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
          )}
        </div>
      )}

      <header
        className="fixed z-50 w-full transition-all duration-300 bg-background/80 backdrop-blur-md"
        {...DRAG_REGION_ATTR}
        style={
          {
            ...DRAG_REGION_STYLE,
            top: dragBarHeight,
            height: HEADER_HEIGHT,
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
                onClick={() => {
                  setShowSettings(false);
                  setShowHistory(false);
                }}
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
                onClick={() => setShowSettings(true)}
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
                onSwitch={setActiveSource}
              />
            </div>
          )}

          <div
            className="flex items-center gap-2 justify-self-end"
            style={{ WebkitAppRegion: "no-drag" } as any}
          >
            {!showSettings && (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setShowHistory((v) => !v)}
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

      <main className="flex-1 min-h-0 flex flex-col overflow-y-auto animate-fade-in px-6">
        {showSettings ? (
          <SettingsPage
            open={true}
            onOpenChange={() => setShowSettings(false)}
            defaultTab="general"
          />
        ) : showHistory ? (
          <div className="flex flex-col h-full" />
        ) : (
          <div className="flex flex-col items-center flex-1">
            <div className="w-full max-w-4xl">
              {/* 输入框 */}
              <div className="sticky top-0 z-30 bg-background/95 py-2 backdrop-blur-md">
                <div className="relative">
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground/50" />
                  <Input
                    value={downloadUrl}
                    onChange={(e) => setDownloadUrl(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={t(`download.urlPlaceholder.${activeSource}`, {
                      defaultValue: downloadPlaceholder,
                    })}
                    className="w-full h-14 pl-11 pr-5 text-base rounded-2xl border border-border bg-background/60 shadow-none focus:ring-0 focus:border-border focus:shadow-none"
                  />
                </div>
              </div>

              {/* 解析 Loading */}
              {parseStatus === "parsing" && (
                <div className="flex items-center justify-center gap-2 py-2 animate-fade-in">
                  <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                  <span className="text-sm text-muted-foreground">
                    正在解析视频...
                  </span>
                </div>
              )}

              {/* 视频预览 */}
              {parseStatus === "success" && videoFormats.length > 0 && (
                <div className="animate-fade-in space-y-3">
                  {/* 视频容器：悬浮时显示下载按钮 */}
                  <div className="relative group flex w-full justify-center overflow-hidden rounded-xl bg-black">
                    <video
                      key={selectedFormatIdx}
                      src={videoFormats[selectedFormatIdx]?.url}
                      controls
                      poster={videoCover || undefined}
                      className="h-auto max-h-[calc(100vh-220px)] w-full rounded-xl object-contain"
                    />
                    {/* 悬浮下载按钮 / 进度 */}
                    <div className="absolute top-3 right-3 z-10 opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex flex-col items-end gap-2">
                      {downloadTaskId ? (
                        <div className="flex items-center gap-2 bg-black/70 backdrop-blur-sm rounded-lg px-3 py-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={handleCancelDownload}
                            className="h-7 text-white hover:text-white hover:bg-white/20 gap-1.5 text-xs px-2"
                          >
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            取消
                          </Button>
                          {downloadProgress > 0 && (
                            <div className="w-24">
                              <div className="h-1 bg-white/30 rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-white rounded-full transition-all duration-200"
                                  style={{ width: `${downloadProgress}%` }}
                                />
                              </div>
                              <div className="flex justify-between text-[10px] text-white/80 mt-0.5">
                                <span>{downloadProgress}%</span>
                                {downloadSpeed > 0 && (
                                  <span>
                                    {(downloadSpeed / 1024 / 1024).toFixed(1)}{" "}
                                    MB/s
                                  </span>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      ) : (
                        <Button
                          size="sm"
                          onClick={handleStartDownload}
                          className="bg-black/70 backdrop-blur-sm hover:bg-black/80 text-white border-0 gap-1.5 shadow-lg"
                        >
                          <Download className="w-3.5 h-3.5" />
                          下载视频
                        </Button>
                      )}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      {videoTitle ? (
                        <p className="min-w-0 truncate text-sm font-medium text-foreground">
                          {videoTitle}
                        </p>
                      ) : (
                        <span className="min-w-0" />
                      )}
                      {videoPlatformLabel && (
                        <span className="shrink-0 text-xs text-muted-foreground">
                          来源: {videoPlatformLabel}
                        </span>
                      )}
                    </div>
                    {videoFormats.length > 1 && (
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground">
                            清晰度:
                          </span>
                          <select
                            value={selectedFormatIdx}
                            onChange={(e) =>
                              setSelectedFormatIdx(Number(e.target.value))
                            }
                            className="text-xs bg-background border border-border rounded-md px-2 py-1 outline-none focus:border-primary"
                          >
                            {videoFormats.map((fmt, idx) => (
                              <option key={idx} value={idx}>
                                {fmt.quality}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                    )}

                    {downloadError && (
                      <p className="text-xs text-destructive">
                        {downloadError}
                      </p>
                    )}
                  </div>
                </div>
              )}

              {parseStatus === "error" && (
                <div className="text-center text-sm text-destructive py-2">
                  解析失败，请检查链接是否正确
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
