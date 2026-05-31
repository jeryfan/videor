import { useEffect, useRef, useState, useCallback } from "react";
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
  UserRound,
  LogOut,
  ChevronDown,
  ChevronRight,
  FileText,
} from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { join } from "@tauri-apps/api/path";
import { SettingsPage } from "@/components/settings/SettingsPage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
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
import {
  parseVideo,
  generateBilibiliLoginQr,
  getBilibiliLoginStatus,
  logoutBilibili,
  pollBilibiliLoginQr,
  type BilibiliLoginStatus,
  type VideoFormat,
} from "@/lib/api/videoParser";
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
type BatchDownloadStatus =
  | "queued"
  | "parsing"
  | "downloading"
  | "completed"
  | "failed"
  | "cancelled";

interface BatchDownloadItem {
  id: string;
  title: string;
  taskId?: string;
  status: BatchDownloadStatus;
  progress: number;
  speed: number;
  error?: string;
}

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
  const saved = localStorage.getItem(
    VIDEO_SOURCE_STORAGE_KEY,
  ) as VideoSource | null;
  if (saved && VIDEO_SOURCES.some((source) => source.id === saved)) {
    return saved;
  }
  return "douyin";
};

function sanitizePathSegment(value: string): string {
  return (
    value
      .replace(/[\\/:*?"<>|]/g, "_")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120) || "Bilibili合集"
  );
}

function formatBatchItemTitle(index: number, title: string): string {
  const prefix = String(index + 1).padStart(2, "0");
  return `${prefix}.${sanitizePathSegment(title || "Bilibili视频")}`;
}

function extractUrlFromCurl(rawCurl: string): string | null {
  const trimmed = rawCurl.trim();
  if (!trimmed.startsWith("curl ")) return null;

  const urlFlag = trimmed.match(/(?:^|\s)--url\s+(['"])(https?:\/\/.*?)\1/s);
  if (urlFlag?.[2]) return urlFlag[2];

  const quotedUrl = trimmed.match(/(?:^|\s)(['"])(https?:\/\/.*?)\1/s);
  if (quotedUrl?.[2]) return quotedUrl[2];

  const bareUrl = trimmed.match(/(?:^|\s)(https?:\/\/[^\s'"\\]+)/);
  return bareUrl?.[1] ?? null;
}

function countUsableCurlHeaders(rawCurl: string): number {
  if (!rawCurl.trim().startsWith("curl ")) return 0;

  const blocked = new Set([
    "host",
    "authority",
    "method",
    "path",
    "scheme",
    "content-length",
    "connection",
    "transfer-encoding",
    "accept-encoding",
    "upgrade",
    "proxy-connection",
  ]);

  return Array.from(
    rawCurl.matchAll(/(?:^|\s)(?:-H|--header)\s+(['"])(.*?)\1/gs),
  ).filter((match) => {
    const header = match[2];
    const separator = header.indexOf(":");
    if (separator <= 0) return false;
    const name = header.slice(0, separator).trim().toLowerCase();
    const value = header.slice(separator + 1).trim();
    return Boolean(name && value && !blocked.has(name));
  }).length;
}

function batchStatusLabel(status: BatchDownloadStatus): string {
  switch (status) {
    case "queued":
      return "等待";
    case "parsing":
      return "解析中";
    case "downloading":
      return "下载中";
    case "completed":
      return "完成";
    case "failed":
      return "失败";
    case "cancelled":
      return "已取消";
  }
}

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
  const [isCurlDialogOpen, setIsCurlDialogOpen] = useState(false);
  const [m3u8CurlRaw, setM3u8CurlRaw] = useState("");
  const [isWindowMaximized, setIsWindowMaximized] = useState(false);
  const [videoFormats, setVideoFormats] = useState<VideoFormat[]>([]);
  const [selectedFormatIdx, setSelectedFormatIdx] = useState(0);
  const [videoTitle, setVideoTitle] = useState("");

  const [videoCover, setVideoCover] = useState("");
  const [videoPlatform, setVideoPlatform] = useState("");
  const [videoItems, setVideoItems] = useState<
    NonNullable<Awaited<ReturnType<typeof parseVideo>>["items"]>
  >([]);
  const [videoKind, setVideoKind] = useState("video");
  const [videoMessage, setVideoMessage] = useState("");
  const [videoLoginRequired, setVideoLoginRequired] = useState(false);
  const [selectedVideoItems, setSelectedVideoItems] = useState<string[]>([]);
  const [bilibiliStatus, setBilibiliStatus] =
    useState<BilibiliLoginStatus | null>(null);
  const [isBilibiliLoginOpen, setIsBilibiliLoginOpen] = useState(false);
  const [bilibiliQrKey, setBilibiliQrKey] = useState("");
  const [bilibiliQrImage, setBilibiliQrImage] = useState("");
  const [bilibiliLoginMessage, setBilibiliLoginMessage] = useState("");
  const [parseStatus, setParseStatus] = useState<
    "idle" | "parsing" | "success" | "error"
  >("idle");

  // 下载状态
  const [downloadTaskId, setDownloadTaskId] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [downloadSpeed, setDownloadSpeed] = useState(0);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [batchDownloadItems, setBatchDownloadItems] = useState<
    BatchDownloadItem[]
  >([]);
  const [isBatchHistoryExpanded, setIsBatchHistoryExpanded] = useState(false);
  const previewVideoRef = useRef<HTMLVideoElement | null>(null);
  const batchTaskIdsRef = useRef<Set<string>>(new Set());

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
  const previewVideoUrl = videoFormats[selectedFormatIdx]?.preview_url
    ? videoFormats[selectedFormatIdx].preview_url
    : videoPlatform === "bilibili" && videoFormats[selectedFormatIdx]?.url
      ? `videor-stream://localhost/video?url=${encodeURIComponent(
          videoFormats[selectedFormatIdx].url,
        )}`
      : videoFormats[selectedFormatIdx]?.url;
  const downloadPlaceholder =
    activeSource === "douyin"
      ? "粘贴抖音视频链接，按 Enter 开始解析..."
      : activeSource === "bilibili"
        ? "粘贴 Bilibili 视频、合集或充电合集链接..."
        : activeSource === "m3u8"
          ? "粘贴 M3U8 播放列表链接，按 Enter 开始解析..."
          : "粘贴视频链接，按 Enter 开始解析...";
  const activeBatchCount = batchDownloadItems.filter((item) =>
    ["queued", "parsing", "downloading"].includes(item.status),
  ).length;
  const completedBatchCount = batchDownloadItems.filter(
    (item) => item.status === "completed",
  ).length;
  const failedBatchCount = batchDownloadItems.filter(
    (item) => item.status === "failed",
  ).length;
  const batchOverallProgress =
    batchDownloadItems.length > 0
      ? Math.round(
          batchDownloadItems.reduce((sum, item) => sum + item.progress, 0) /
            batchDownloadItems.length,
        )
      : 0;
  const batchStatus =
    batchDownloadItems.length === 0
      ? "queued"
      : failedBatchCount > 0 && activeBatchCount === 0
        ? "failed"
        : completedBatchCount === batchDownloadItems.length
          ? "completed"
          : activeBatchCount > 0
            ? "downloading"
            : "queued";
  const m3u8CurlHeaderCount = countUsableCurlHeaders(m3u8CurlRaw);

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

  const refreshBilibiliStatus = useCallback(async () => {
    try {
      setBilibiliStatus(await getBilibiliLoginStatus());
    } catch (error) {
      console.warn("[Bilibili] Failed to refresh login status", error);
      setBilibiliStatus({
        logged_in: false,
        message: extractErrorMessage(error),
      });
    }
  }, []);

  useEffect(() => {
    if (activeSource === "bilibili") {
      void refreshBilibiliStatus();
    }
  }, [activeSource, refreshBilibiliStatus]);

  useEffect(() => {
    if (!isBilibiliLoginOpen || !bilibiliQrKey) return;

    let active = true;
    const interval = window.setInterval(() => {
      void (async () => {
        try {
          const result = await pollBilibiliLoginQr(bilibiliQrKey);
          if (!active) return;
          setBilibiliLoginMessage(result.message);
          if (result.status === "confirmed") {
            window.clearInterval(interval);
            setIsBilibiliLoginOpen(false);
            await refreshBilibiliStatus();
            toast.success("Bilibili 登录成功");
          }
        } catch (error) {
          if (!active) return;
          setBilibiliLoginMessage(extractErrorMessage(error));
        }
      })();
    }, 2500);

    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [bilibiliQrKey, isBilibiliLoginOpen, refreshBilibiliStatus]);

  const handleOpenBilibiliLogin = useCallback(async () => {
    try {
      setBilibiliLoginMessage("正在生成二维码...");
      setBilibiliQrImage("");
      setBilibiliQrKey("");
      setIsBilibiliLoginOpen(true);
      const qr = await generateBilibiliLoginQr();
      setBilibiliQrKey(qr.qrcode_key);
      setBilibiliQrImage(qr.svg);
      setBilibiliLoginMessage("请使用 Bilibili App 扫码登录");
    } catch (error) {
      setBilibiliLoginMessage(extractErrorMessage(error));
    }
  }, []);

  const handleBilibiliLogout = useCallback(async () => {
    try {
      await logoutBilibili();
      await refreshBilibiliStatus();
      toast.info("已退出 Bilibili 登录");
    } catch (error) {
      toast.error(extractErrorMessage(error));
    }
  }, [refreshBilibiliStatus]);

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

  const closeCurrentVideo = useCallback(() => {
    const video = previewVideoRef.current;
    if (video) {
      video.pause();
      video.removeAttribute("src");
      video.load();
    }
  }, []);

  const resetParsedVideoState = useCallback(() => {
    closeCurrentVideo();
    setParseStatus("idle");
    setVideoFormats([]);
    setSelectedFormatIdx(0);
    setVideoTitle("");
    setVideoCover("");
    setVideoPlatform("");
    setVideoItems([]);
    setVideoKind("video");
    setVideoMessage("");
    setVideoLoginRequired(false);
    setSelectedVideoItems([]);
  }, [closeCurrentVideo]);

  const handleSourceSwitch = useCallback(
    (source: VideoSource) => {
      if (source === activeSource) return;
      resetParsedVideoState();
      setActiveSource(source);
    },
    [activeSource, resetParsedVideoState],
  );

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
    setVideoItems([]);
    setVideoKind("video");
    setVideoMessage("");
    setVideoLoginRequired(false);
    setSelectedVideoItems([]);
    setBatchDownloadItems([]);
    setIsBatchHistoryExpanded(false);
    batchTaskIdsRef.current.clear();

    try {
      const info = await parseVideo(
        rawInput,
        activeSource === "m3u8" ? m3u8CurlRaw : undefined,
      );
      setVideoFormats(info.formats);
      setVideoTitle(info.title);
      setVideoCover(info.cover_url || "");
      setVideoPlatform(info.platform);
      setVideoItems(info.items || []);
      setVideoKind(info.kind || "video");
      setVideoMessage(info.message || "");
      setVideoLoginRequired(Boolean(info.login_required));
      setSelectedVideoItems((info.items || []).map((item) => item.id));
      setParseStatus("success");
    } catch (error) {
      console.error("[VideoParser] Failed to parse:", error);
      toast.error(extractErrorMessage(error) || "视频解析失败");
      setParseStatus("error");
    }
  }, [activeSource, downloadUrl, m3u8CurlRaw, t]);

  // 监听下载进度
  useEffect(() => {
    let unlisten: (() => void) | undefined;

    const setup = async () => {
      unlisten = await listenDownloadProgress((progress) => {
        if (batchTaskIdsRef.current.has(progress.task_id)) {
          setBatchDownloadItems((items) =>
            items.map((item) => {
              if (item.taskId !== progress.task_id) return item;

              const percent =
                progress.total && progress.total > 0
                  ? Math.round((progress.downloaded / progress.total) * 100)
                  : item.progress;
              const nextStatus =
                progress.status === "completed"
                  ? "completed"
                  : progress.status === "failed"
                    ? "failed"
                    : progress.status === "cancelled"
                      ? "cancelled"
                      : "downloading";

              return {
                ...item,
                status: nextStatus,
                progress: nextStatus === "completed" ? 100 : percent,
                speed: progress.speed,
                error: progress.status === "failed" ? "下载失败" : item.error,
              };
            }),
          );
          return;
        }

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

      const format = videoFormats[0];
      toast.info(`开始下载: ${videoTitle}`);
      const taskId = await startVideoDownload(videoTitle, format, dir);
      setDownloadTaskId(taskId);
    } catch (error) {
      console.error("[Download] Failed to start:", error);
      toast.error(extractErrorMessage(error) || "启动下载失败");
    }
  }, [videoFormats, videoTitle, settingsData]);

  const ensureDownloadDirectory = useCallback(async () => {
    let dir: string | null = settingsData?.downloadDirectory ?? null;
    if (!dir) {
      dir = await invoke<string | null>("pick_directory", {});
      if (!dir) {
        toast.info("未选择保存目录");
        return null;
      }
      try {
        await settingsApi.save({
          ...settingsData,
          downloadDirectory: dir,
        } as AppSettings);
      } catch (e) {
        console.warn("[Download] Failed to save default directory:", e);
      }
    }
    return dir;
  }, [settingsData]);

  const handleStartBilibiliBatchDownload = useCallback(async () => {
    const selectedItems = videoItems.filter((item) =>
      selectedVideoItems.includes(item.id),
    );
    if (selectedItems.length === 0) {
      toast.error("请选择要下载的视频");
      return;
    }

    const dir = await ensureDownloadDirectory();
    if (!dir) return;

    const collectionDir = await join(dir, sanitizePathSegment(videoTitle));
    batchTaskIdsRef.current.clear();
    setIsBatchHistoryExpanded(true);
    setBatchDownloadItems(
      selectedItems.map((item) => ({
        id: item.id,
        title: item.title,
        status: "queued",
        progress: 0,
        speed: 0,
      })),
    );
    toast.info(
      `已开始批量解析 ${selectedItems.length} 个 Bilibili 视频，保存到合集目录`,
    );

    for (const [idx, item] of selectedItems.entries()) {
      try {
        // 保守节奏：逐条解析并启动，避免短时间大量请求 B 站接口。
        if (idx > 0) {
          await new Promise((resolve) => window.setTimeout(resolve, 1500));
        }
        setBatchDownloadItems((items) =>
          items.map((batchItem) =>
            batchItem.id === item.id
              ? { ...batchItem, status: "parsing", error: undefined }
              : batchItem,
          ),
        );
        const info = await parseVideo(item.url);
        const format = info.formats[0];
        if (!format) {
          setBatchDownloadItems((items) =>
            items.map((batchItem) =>
              batchItem.id === item.id
                ? {
                    ...batchItem,
                    status: "failed",
                    error: "未找到可下载清晰度",
                  }
                : batchItem,
            ),
          );
          toast.error(`未找到可下载清晰度：${item.title}`);
          continue;
        }
        const taskId = await startVideoDownload(
          formatBatchItemTitle(idx, item.title || info.title),
          format,
          collectionDir,
        );
        batchTaskIdsRef.current.add(taskId);
        setBatchDownloadItems((items) =>
          items.map((batchItem) =>
            batchItem.id === item.id
              ? {
                  ...batchItem,
                  taskId,
                  status: "downloading",
                  progress: 0,
                  speed: 0,
                }
              : batchItem,
          ),
        );
      } catch (error) {
        const message = extractErrorMessage(error);
        setBatchDownloadItems((items) =>
          items.map((batchItem) =>
            batchItem.id === item.id
              ? { ...batchItem, status: "failed", error: message }
              : batchItem,
          ),
        );
        toast.error(`${item.title}: ${message}`);
      }
    }
  }, [ensureDownloadDirectory, selectedVideoItems, videoItems, videoTitle]);

  const handleCancelDownload = useCallback(async () => {
    if (!downloadTaskId) return;
    try {
      await cancelVideoDownload(downloadTaskId);
    } catch (error) {
      console.error("[Download] Failed to cancel:", error);
    }
  }, [downloadTaskId]);

  const handleBackToMain = useCallback(() => {
    setShowSettings(false);
    setShowHistory(false);
  }, []);

  const handleDownloadUrlChange = useCallback(
    (value: string) => {
      if (activeSource === "m3u8" && value.trim().startsWith("curl ")) {
        setM3u8CurlRaw(value);
        const url = extractUrlFromCurl(value);
        if (url) {
          setDownloadUrl(url);
          return;
        }
      }
      setDownloadUrl(value);
    },
    [activeSource],
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

      <Dialog open={isBilibiliLoginOpen} onOpenChange={setIsBilibiliLoginOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Bilibili 登录</DialogTitle>
            <DialogDescription>
              登录信息只保存在本机，用于访问你账号有权限观看的内容。
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col items-center gap-4 px-6 py-5">
            <div className="flex h-56 w-56 items-center justify-center rounded-lg border border-border bg-white p-3">
              {bilibiliQrImage ? (
                <img
                  src={bilibiliQrImage}
                  alt="Bilibili 登录二维码"
                  className="h-full w-full"
                />
              ) : (
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              )}
            </div>
            <p className="text-center text-sm text-muted-foreground">
              {bilibiliLoginMessage || "等待二维码"}
            </p>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsBilibiliLoginOpen(false)}
            >
              取消
            </Button>
            <Button
              variant="secondary"
              onClick={() => void handleOpenBilibiliLogin()}
            >
              刷新二维码
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isCurlDialogOpen} onOpenChange={setIsCurlDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>M3U8 cURL</DialogTitle>
            <DialogDescription>
              粘贴浏览器 Network 面板复制的完整 cURL，解析和下载会提取其中的
              headers。
            </DialogDescription>
          </DialogHeader>
          <textarea
            value={m3u8CurlRaw}
            onChange={(event) => {
              const nextCurl = event.target.value;
              setM3u8CurlRaw(nextCurl);
              const url = extractUrlFromCurl(nextCurl);
              if (url) {
                setDownloadUrl(url);
              }
            }}
            spellCheck={false}
            placeholder={
              "curl 'https://example.com/video.m3u8' \\\n  -H 'Referer: https://example.com/' \\\n  -H 'User-Agent: Mozilla/5.0 ...'"
            }
            className="min-h-72 w-full resize-y rounded-lg border border-border bg-background px-3 py-2 font-mono text-xs leading-5 !outline-none !ring-0 focus:border-border focus:!outline-none focus:!ring-0 focus-visible:!outline-none focus-visible:!ring-0"
          />
          <DialogFooter className="items-center justify-between gap-3 sm:justify-between">
            <span className="text-xs text-muted-foreground">
              {m3u8CurlHeaderCount > 0
                ? `将使用 ${m3u8CurlHeaderCount} 个 header`
                : "未配置可用 cURL"}
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => setM3u8CurlRaw("")}
                disabled={!m3u8CurlRaw}
              >
                清空
              </Button>
              <Button onClick={() => setIsCurlDialogOpen(false)}>完成</Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
                onClick={handleBackToMain}
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
                onSwitch={handleSourceSwitch}
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
                      ? void handleBilibiliLogout()
                      : void handleOpenBilibiliLogin()
                  }
                  title={
                    bilibiliStatus?.logged_in
                      ? `Bilibili: ${bilibiliStatus.username || "已登录"}`
                      : "扫码登录 Bilibili"
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
                      ? bilibiliStatus.username || "已登录"
                      : "登录"}
                  </span>
                </Button>
              </div>
            )}
            {!showSettings && !showHistory && (
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

      <main className="relative flex-1 min-h-0 flex flex-col overflow-y-auto animate-fade-in px-6">
        <div
          className={cn(
            "min-h-0 flex-1 flex-col",
            showSettings ? "flex" : "hidden",
          )}
        >
          <SettingsPage
            open={true}
            onOpenChange={() => setShowSettings(false)}
            defaultTab="general"
          />
        </div>

        <div
          className={cn(
            "mx-auto w-full max-w-4xl flex-col gap-3 py-4",
            showHistory ? "flex" : "hidden",
          )}
        >
          {batchDownloadItems.length === 0 && !downloadTaskId && (
            <div className="rounded-xl border border-border bg-muted/20 p-6 text-center text-sm text-muted-foreground">
              暂无下载任务
            </div>
          )}

          {downloadTaskId && batchDownloadItems.length === 0 && (
            <div className="rounded-xl border border-border bg-background p-4">
              <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{videoTitle}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    单视频 · 下载中
                  </p>
                </div>
                <span className="text-sm tabular-nums text-muted-foreground">
                  {downloadProgress}%
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleCancelDownload}
                  className="h-8 px-3 text-xs"
                >
                  取消
                </Button>
              </div>
              <div className="mt-3 flex items-center gap-2">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary transition-all duration-300"
                    style={{ width: `${downloadProgress}%` }}
                  />
                </div>
                {downloadSpeed > 0 && (
                  <span className="w-20 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                    {(downloadSpeed / 1024 / 1024).toFixed(1)}MB/s
                  </span>
                )}
              </div>
              {downloadError && (
                <p className="mt-2 text-xs text-destructive">{downloadError}</p>
              )}
            </div>
          )}

          {batchDownloadItems.length > 0 && (
            <div className="overflow-hidden rounded-xl border border-border bg-background">
              <button
                type="button"
                onClick={() =>
                  setIsBatchHistoryExpanded((expanded) => !expanded)
                }
                className="grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 text-left hover:bg-muted/40"
              >
                {isBatchHistoryExpanded ? (
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                )}
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {videoTitle || "Bilibili 批量下载"}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    批量任务 · 共 {batchDownloadItems.length} 个 · 完成{" "}
                    {completedBatchCount} 个
                    {failedBatchCount > 0
                      ? ` · 失败 ${failedBatchCount} 个`
                      : ""}
                  </p>
                </div>
                <div className="flex min-w-32 flex-col items-end gap-1">
                  <span
                    className={cn(
                      "text-xs",
                      batchStatus === "completed" && "text-emerald-600",
                      batchStatus === "failed" && "text-destructive",
                      ["queued", "downloading"].includes(batchStatus) &&
                        "text-muted-foreground",
                    )}
                  >
                    {batchStatusLabel(batchStatus)}
                  </span>
                  <div className="flex w-full items-center gap-2">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                      <div
                        className={cn(
                          "h-full rounded-full transition-all duration-300",
                          batchStatus === "failed"
                            ? "bg-destructive"
                            : "bg-primary",
                        )}
                        style={{ width: `${batchOverallProgress}%` }}
                      />
                    </div>
                    <span className="w-9 text-right text-xs tabular-nums text-muted-foreground">
                      {batchOverallProgress}%
                    </span>
                  </div>
                </div>
              </button>

              {isBatchHistoryExpanded && (
                <div className="border-t border-border bg-muted/10">
                  {batchDownloadItems.map((item, index) => (
                    <div
                      key={item.id}
                      className="flex items-center gap-3 border-b border-border px-4 py-3 last:border-b-0"
                    >
                      <span className="w-8 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                        {index + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="min-w-0 flex-1 truncate text-sm">
                            {item.title}
                          </p>
                          <span
                            className={cn(
                              "shrink-0 text-xs",
                              item.status === "completed" && "text-emerald-600",
                              item.status === "failed" && "text-destructive",
                              ["queued", "parsing", "downloading"].includes(
                                item.status,
                              ) && "text-muted-foreground",
                            )}
                          >
                            {batchStatusLabel(item.status)}
                          </span>
                        </div>
                        <div className="mt-2 flex items-center gap-2">
                          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                            <div
                              className={cn(
                                "h-full rounded-full transition-all duration-300",
                                item.status === "failed"
                                  ? "bg-destructive"
                                  : "bg-primary",
                              )}
                              style={{ width: `${item.progress}%` }}
                            />
                          </div>
                          <span className="w-10 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                            {item.progress}%
                          </span>
                          {item.speed > 0 && (
                            <span className="w-20 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                              {(item.speed / 1024 / 1024).toFixed(1)}MB/s
                            </span>
                          )}
                        </div>
                        {item.error && (
                          <p className="mt-1 truncate text-xs text-destructive">
                            {item.error}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div
          className={cn(
            "flex-col items-center flex-1",
            !showSettings && !showHistory
              ? "flex"
              : "pointer-events-none absolute inset-x-6 top-0 flex opacity-0",
          )}
        >
          <div className="w-full max-w-4xl">
            {/* 输入框 */}
            <div className="sticky top-0 z-30 bg-background/95 py-2 backdrop-blur-md">
              <div className="relative">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground/50" />
                <Input
                  value={downloadUrl}
                  onChange={(e) => handleDownloadUrlChange(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={t(`download.urlPlaceholder.${activeSource}`, {
                    defaultValue: downloadPlaceholder,
                  })}
                  className={cn(
                    "w-full h-14 pl-11 text-base rounded-2xl border border-border bg-background/60 shadow-none focus:ring-0 focus:border-border focus:shadow-none",
                    activeSource === "m3u8" ? "pr-28" : "pr-5",
                  )}
                />
                {activeSource === "m3u8" && (
                  <Button
                    type="button"
                    variant={m3u8CurlHeaderCount > 0 ? "secondary" : "ghost"}
                    size="sm"
                    onClick={() => setIsCurlDialogOpen(true)}
                    title="设置 M3U8 cURL"
                    className="absolute right-2 top-1/2 h-10 -translate-y-1/2 gap-1.5 rounded-xl px-3"
                  >
                    <FileText className="h-4 w-4" />
                    <span className="text-xs">
                      {m3u8CurlHeaderCount > 0 ? m3u8CurlHeaderCount : "cURL"}
                    </span>
                  </Button>
                )}
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

            {parseStatus === "success" &&
              activeSource === "bilibili" &&
              (videoLoginRequired || videoMessage) &&
              videoFormats.length === 0 && (
                <div className="mt-3 rounded-xl border border-border bg-muted/30 p-4 animate-fade-in">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground">
                        {videoKind === "charging_collection"
                          ? "Bilibili 权限内容"
                          : "Bilibili"}
                      </p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {videoMessage ||
                          "该内容需要登录后检查账号是否拥有观看权限。"}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      onClick={() => void handleOpenBilibiliLogin()}
                      className="shrink-0"
                    >
                      扫码登录
                    </Button>
                  </div>
                </div>
              )}

            {parseStatus === "success" &&
              activeSource === "bilibili" &&
              videoItems.length > 0 && (
                <div className="mt-3 animate-fade-in space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">
                        {videoTitle}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {videoKind === "multipart"
                          ? `多 P 视频 · ${videoItems.length} 个分集`
                          : `合集 · ${videoItems.length} 个视频`}
                        {bilibiliStatus?.logged_in
                          ? ` · 已登录 ${bilibiliStatus.username || ""}`
                          : ""}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          setSelectedVideoItems(
                            selectedVideoItems.length === videoItems.length
                              ? []
                              : videoItems.map((item) => item.id),
                          )
                        }
                      >
                        {selectedVideoItems.length === videoItems.length
                          ? "取消全选"
                          : "全选"}
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => void handleStartBilibiliBatchDownload()}
                        disabled={
                          selectedVideoItems.length === 0 ||
                          activeBatchCount > 0
                        }
                      >
                        {activeBatchCount > 0 ? "下载中" : "批量下载"}
                      </Button>
                    </div>
                  </div>
                  <div className="max-h-[calc(100vh-280px)] overflow-y-auto rounded-xl border border-border">
                    {videoItems.map((item, index) => {
                      const checked = selectedVideoItems.includes(item.id);
                      return (
                        <label
                          key={item.id}
                          className="flex cursor-pointer items-center gap-3 border-b border-border px-3 py-2 last:border-b-0 hover:bg-muted/40"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(event) => {
                              setSelectedVideoItems((prev) =>
                                event.target.checked
                                  ? Array.from(new Set([...prev, item.id]))
                                  : prev.filter((id) => id !== item.id),
                              );
                            }}
                            className="h-4 w-4"
                          />
                          <span className="w-8 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                            {index + 1}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-sm">
                            {item.title}
                          </span>
                          {item.duration ? (
                            <span className="shrink-0 text-xs text-muted-foreground">
                              {Math.floor(item.duration / 60)}:
                              {String(item.duration % 60).padStart(2, "0")}
                            </span>
                          ) : null}
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}

            {/* 视频预览 */}
            {parseStatus === "success" && videoFormats.length > 0 && (
              <div className="animate-fade-in space-y-3">
                {/* 视频容器：悬浮时显示下载按钮 */}
                <div className="relative group flex w-full justify-center overflow-hidden rounded-xl bg-black">
                  <video
                    ref={previewVideoRef}
                    key={`${selectedFormatIdx}-${previewVideoUrl}`}
                    src={previewVideoUrl}
                    controls
                    poster={videoCover || undefined}
                    className="h-auto max-h-[calc(100vh-220px)] w-full rounded-xl object-contain"
                  />
                  {/* 悬浮下载按钮 / 进度 */}
                  <div className="absolute top-3 right-3 z-10 opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex flex-col items-end gap-2">
                    {downloadTaskId ? (
                      <Button
                        size="sm"
                        disabled
                        className="bg-black/70 backdrop-blur-sm text-white border-0 gap-1.5 shadow-lg disabled:opacity-100"
                      >
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        下载中
                      </Button>
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
      </main>
    </div>
  );
}

export default App;
