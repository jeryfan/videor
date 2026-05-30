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
  Trash2,
  ExternalLink,
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
import { extractErrorMessage } from "@/utils/errorUtils";
import { parseVideo, type VideoFormat } from "@/lib/api/videoParser";
import {
  startVideoDownload,
  cancelVideoDownload,
  listenDownloadProgress,
} from "@/lib/api/download";
import { invoke } from "@tauri-apps/api/core";
import { Download, Loader2 } from "lucide-react";

const DEFAULT_DRAG_BAR_HEIGHT = isWindows() || isLinux() ? 0 : 28; // px
const HEADER_HEIGHT = 64; // px

interface DownloadRecord {
  id: string;
  url: string;
  title: string;
  status: "pending" | "downloading" | "completed" | "failed";
  createdAt: string;
}

const HISTORY_STORAGE_KEY = "videor-download-history";

function loadHistory(): DownloadRecord[] {
  try {
    const raw = localStorage.getItem(HISTORY_STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    // ignore
  }
  return [];
}

function saveHistory(history: DownloadRecord[]) {
  try {
    localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history));
  } catch {
    // ignore
  }
}

function App() {
  const { t } = useTranslation();
  const [showSettings, setShowSettings] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [downloadUrl, setDownloadUrl] = useState("");
  const [history, setHistory] = useState<DownloadRecord[]>(loadHistory);
  const [isWindowMaximized, setIsWindowMaximized] = useState(false);
  const [videoFormats, setVideoFormats] = useState<VideoFormat[]>([]);
  const [selectedFormatIdx, setSelectedFormatIdx] = useState(0);
  const [videoTitle, setVideoTitle] = useState("");

  const [videoCover, setVideoCover] = useState("");
  const [videoPlatform, setVideoPlatform] = useState("");
  const [parseStatus, setParseStatus] = useState<"idle" | "parsing" | "success" | "error">("idle");

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
        setDownloadProgress(progress.total && progress.total > 0
          ? Math.round((progress.downloaded / progress.total) * 100)
          : 0);
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

    toast.info("正在打开目录选择器...");

    try {
      const dir = await invoke<string | null>("pick_directory", {});
      if (!dir) {
        toast.info("未选择保存目录");
        return;
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
  }, [videoFormats, videoTitle, selectedFormatIdx]);

  const handleCancelDownload = useCallback(async () => {
    if (!downloadTaskId) return;
    try {
      await cancelVideoDownload(downloadTaskId);
    } catch (error) {
      console.error("[Download] Failed to cancel:", error);
    }
  }, [downloadTaskId]);

  const handleClearHistory = useCallback(() => {
    setHistory([]);
    saveHistory([]);
    toast.success(t("download.historyCleared", { defaultValue: "历史记录已清空" }));
  }, [t]);

  const handleRemoveRecord = useCallback(
    (id: string) => {
      const next = history.filter((r) => r.id !== id);
      setHistory(next);
      saveHistory(next);
    },
    [history],
  );

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
          className="flex h-full items-center justify-between gap-2 px-6"
          {...DRAG_REGION_ATTR}
          style={{ ...DRAG_REGION_STYLE } as any}
        >
          <div
            className="flex items-center gap-2"
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

          <div
            className="flex items-center gap-2"
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

      <main className="flex-1 min-h-0 flex flex-col overflow-y-auto animate-fade-in px-6 pt-4">
        {showSettings ? (
          <SettingsPage
            open={true}
            onOpenChange={() => setShowSettings(false)}
            defaultTab="general"
          />
        ) : showHistory ? (
          <div className="flex flex-col h-full">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">
                {t("download.historyTitle", { defaultValue: "下载历史" })}
              </h2>
              {history.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleClearHistory}
                  className="text-destructive hover:text-destructive"
                >
                  <Trash2 className="w-4 h-4 mr-1" />
                  {t("common.clear", { defaultValue: "清空" })}
                </Button>
              )}
            </div>
            {history.length === 0 ? (
              <div className="flex-1 flex items-center justify-center text-muted-foreground">
                {t("download.noHistory", { defaultValue: "暂无下载记录" })}
              </div>
            ) : (
              <div className="space-y-2 overflow-y-auto">
                {history.map((record) => (
                  <div
                    key={record.id}
                    className="flex items-center gap-3 p-3 rounded-lg border border-border/50 bg-card/50 hover:bg-card transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <ExternalLink className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                        <span className="text-sm font-medium truncate">
                          {record.title}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground truncate mt-0.5">
                        {record.url}
                      </p>
                    </div>
                    <span
                      className={cn(
                        "text-xs px-2 py-0.5 rounded-full shrink-0",
                        record.status === "completed" &&
                          "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
                        record.status === "pending" &&
                          "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
                        record.status === "downloading" &&
                          "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
                        record.status === "failed" &&
                          "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
                      )}
                    >
                      {t(`download.status.${record.status}`, {
                        defaultValue: record.status,
                      })}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 shrink-0"
                      onClick={() => handleRemoveRecord(record.id)}
                    >
                      <Trash2 className="w-3.5 h-3.5 text-muted-foreground" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center flex-1 px-6">
            <div className="w-full max-w-4xl space-y-4">
              {/* 输入框 */}
              <div className="relative">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground/50" />
                <Input
                  value={downloadUrl}
                  onChange={(e) => setDownloadUrl(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={t("download.urlPlaceholder", {
                    defaultValue: "粘贴视频链接，按 Enter 开始解析...",
                  })}
                  className="w-full h-14 pl-11 pr-5 text-base rounded-2xl border border-border bg-background/60 shadow-none focus:ring-0 focus:border-border focus:shadow-none"
                />
              </div>

              {/* 解析 Loading */}
              {parseStatus === "parsing" && (
                <div className="flex items-center justify-center gap-2 py-2 animate-fade-in">
                  <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                  <span className="text-sm text-muted-foreground">正在解析视频...</span>
                </div>
              )}

              {/* 视频预览 */}
              {parseStatus === "success" && videoFormats.length > 0 && (
                <div className="animate-fade-in space-y-3">
                  {/* 视频容器：悬浮时显示下载按钮 */}
                  <div className="relative group">
                    <video
                      key={selectedFormatIdx}
                      src={videoFormats[selectedFormatIdx]?.url}
                      controls
                      poster={videoCover || undefined}
                      className="w-full rounded-xl bg-muted"
                      style={{ maxHeight: "65vh" }}
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
                                  <span>{(downloadSpeed / 1024 / 1024).toFixed(1)} MB/s</span>
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
                    {videoTitle && (
                      <p className="text-sm font-medium text-foreground truncate">
                        {videoTitle}
                      </p>
                    )}
                    <div className="flex items-center gap-3 flex-wrap">
                      {/* 清晰度选择 */}
                      {videoFormats.length > 1 && (
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground">清晰度:</span>
                          <select
                            value={selectedFormatIdx}
                            onChange={(e) => setSelectedFormatIdx(Number(e.target.value))}
                            className="text-xs bg-background border border-border rounded-md px-2 py-1 outline-none focus:border-primary"
                          >
                            {videoFormats.map((fmt, idx) => (
                              <option key={idx} value={idx}>
                                {fmt.quality}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}
                      {videoPlatform && (
                        <span className="text-xs text-muted-foreground">
                          来源: {videoPlatform === "douyin" ? "抖音" : videoPlatform === "bilibili" ? "B站" : "直链"}
                        </span>
                      )}
                    </div>

                    {downloadError && (
                      <p className="text-xs text-destructive">{downloadError}</p>
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
