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
  FolderOpen,
  Play,
  RotateCcw,
} from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { join, dirname } from "@tauri-apps/api/path";
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
  getMatchedCurlEntry,
  loadCurlImports,
  saveCurlImports,
  type CurlImportEntry,
} from "@/lib/curlImport";
import { CurlImportDialog } from "@/components/CurlImportDialog";
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
  getDownloadHistory,
  saveDownloadHistory,
  clearDownloadHistory,
  openDownloadFile,
  revealDownloadFile,
  openDirectory,
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
  | "remuxing"
  | "completed"
  | "failed"
  | "cancelled";

interface BatchDownloadItem {
  id: string;
  title: string;
  url: string;
  order: number;
  taskId?: string;
  status: BatchDownloadStatus;
  progress: number;
  speed: number;
  error?: string;
  filePath?: string;
}

interface SingleDownloadTask {
  id: string;
  title: string;
  source: VideoSource;
  status: BatchDownloadStatus;
  progress: number;
  speed: number;
  error?: string;
  filePath?: string;
}

interface DownloadHistoryTask {
  id: string;
  type: "single" | "batch";
  title: string;
  source: VideoSource;
  resourceKey?: string;
  status: BatchDownloadStatus;
  progress: number;
  speed: number;
  error?: string;
  filePath?: string;
  directoryPath?: string;
  items?: BatchDownloadItem[];
  expanded?: boolean;
  createdAt: number;
  updatedAt: number;
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

function batchStatusLabel(status: BatchDownloadStatus): string {
  switch (status) {
    case "queued":
      return "等待";
    case "parsing":
      return "解析中";
    case "downloading":
      return "下载中";
    case "remuxing":
      return "合并中";
    case "completed":
      return "完成";
    case "failed":
      return "失败";
    case "cancelled":
      return "已取消";
  }
}

function downloadStatusBadgeClass(status: BatchDownloadStatus): string {
  switch (status) {
    case "completed":
      return "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400 border-emerald-200 dark:border-emerald-900";
    case "failed":
      return "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-400 border-red-200 dark:border-red-900";
    case "cancelled":
      return "bg-gray-50 text-gray-600 dark:bg-gray-900/40 dark:text-gray-400 border-gray-200 dark:border-gray-800";
    case "remuxing":
      return "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400 border-amber-200 dark:border-amber-900";
    case "downloading":
      return "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400 border-blue-200 dark:border-blue-900";
    case "parsing":
      return "bg-purple-50 text-purple-700 dark:bg-purple-950/40 dark:text-purple-400 border-purple-200 dark:border-purple-900";
    default:
      return "bg-gray-50 text-gray-600 dark:bg-gray-900/40 dark:text-gray-400 border-gray-200 dark:border-gray-800";
  }
}

function CircularProgress({
  progress,
  size = 32,
  status,
}: {
  progress: number;
  size?: number;
  status?: BatchDownloadStatus;
}) {
  const stroke = 3;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c - (progress / 100) * c;
  const colorClass =
    status === "failed" ? "text-destructive" : "text-primary";
  return (
    <svg width={size} height={size} className="shrink-0 -rotate-90">
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth={stroke}
        className="text-muted/30"
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={offset}
        className={cn("transition-all duration-500", colorClass)}
      />
    </svg>
  );
}

function formatDownloadSpeed(speed: number): string {
  if (speed <= 0) return "-";
  return `${(speed / 1024 / 1024).toFixed(1)}MB/s`;
}

function downloadResourceKey(source: VideoSource, url: string): string {
  return `${source}:${url.trim()}`;
}

function hasActiveDownloadForResource(
  tasks: DownloadHistoryTask[],
  resourceKeys: string[],
): boolean {
  const keySet = new Set(resourceKeys.filter(Boolean));
  return tasks.some((task) => {
    if (!["queued", "parsing", "downloading", "remuxing"].includes(task.status)) {
      return false;
    }
    if (task.resourceKey && keySet.has(task.resourceKey)) return true;
    return (task.items || []).some((item) =>
      keySet.has(downloadResourceKey(task.source, item.url)),
    );
  });
}

function normalizePersistedStatus(
  status: BatchDownloadStatus,
): BatchDownloadStatus {
  return ["queued", "parsing", "downloading", "remuxing"].includes(status)
    ? "cancelled"
    : status;
}

function isBatchDownloadStatus(value: unknown): value is BatchDownloadStatus {
  return (
    typeof value === "string" &&
    [
      "queued",
      "parsing",
      "downloading",
      "remuxing",
      "completed",
      "failed",
      "cancelled",
    ].includes(value)
  );
}

function restoreSingleDownloadTask(value: unknown): SingleDownloadTask | null {
  if (!value || typeof value !== "object") return null;
  const task = value as Partial<SingleDownloadTask>;
  if (
    typeof task.id !== "string" ||
    typeof task.title !== "string" ||
    !task.source ||
    !VIDEO_SOURCES.some((source) => source.id === task.source) ||
    !isBatchDownloadStatus(task.status)
  ) {
    return null;
  }

  const status = normalizePersistedStatus(task.status);
  return {
    id: task.id,
    title: task.title,
    source: task.source,
    status,
    progress:
      typeof task.progress === "number" && Number.isFinite(task.progress)
        ? task.progress
        : status === "completed"
          ? 100
          : 0,
    speed: 0,
    error:
      status === "cancelled" && task.status !== "cancelled"
        ? "应用已退出，任务已停止"
        : typeof task.error === "string"
          ? task.error
          : undefined,
    filePath: typeof task.filePath === "string" ? task.filePath : undefined,
  };
}

function restoreBatchDownloadItems(value: unknown): BatchDownloadItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item, index) => {
    if (!item || typeof item !== "object") return [];
    const task = item as Partial<BatchDownloadItem>;
    if (
      typeof task.id !== "string" ||
      typeof task.title !== "string" ||
      typeof task.url !== "string" ||
      !isBatchDownloadStatus(task.status)
    ) {
      return [];
    }
    const status = normalizePersistedStatus(task.status);
    return [
      {
        id: task.id,
        title: task.title,
        url: task.url,
        order:
          typeof task.order === "number" && Number.isFinite(task.order)
            ? task.order
            : index,
        taskId:
          status === "cancelled" && task.status !== "cancelled"
            ? undefined
            : typeof task.taskId === "string"
              ? task.taskId
              : undefined,
        status,
        progress:
          typeof task.progress === "number" && Number.isFinite(task.progress)
            ? task.progress
            : status === "completed"
              ? 100
              : 0,
        speed: 0,
        error:
          status === "cancelled" && task.status !== "cancelled"
            ? "应用已退出，任务已停止"
            : typeof task.error === "string"
              ? task.error
              : undefined,
        filePath: typeof task.filePath === "string" ? task.filePath : undefined,
      },
    ];
  });
}

function calculateBatchTaskState(
  items: BatchDownloadItem[],
): Pick<DownloadHistoryTask, "status" | "progress" | "speed"> {
  if (items.length === 0) {
    return { status: "queued", progress: 0, speed: 0 };
  }
  const activeCount = items.filter((item) =>
    ["queued", "parsing", "downloading", "remuxing"].includes(item.status),
  ).length;
  const completedCount = items.filter(
    (item) => item.status === "completed",
  ).length;
  const failedCount = items.filter((item) => item.status === "failed").length;
  const cancelledCount = items.filter(
    (item) => item.status === "cancelled",
  ).length;
  const progress = Math.round(
    items.reduce((sum, item) => sum + item.progress, 0) / items.length,
  );
  const speed = items
    .filter((item) => item.status === "downloading")
    .reduce((sum, item) => sum + item.speed, 0);

  if (activeCount > 0) {
    return {
      status:
        completedCount + failedCount + cancelledCount === 0
          ? "queued"
          : "downloading",
      progress,
      speed,
    };
  }
  if (failedCount > 0) return { status: "failed", progress, speed };
  if (completedCount === items.length) {
    return { status: "completed", progress: 100, speed };
  }
  if (cancelledCount > 0) return { status: "cancelled", progress, speed };
  return { status: "queued", progress, speed };
}

function updateBatchItem(
  tasks: DownloadHistoryTask[],
  taskId: string,
  itemId: string,
  patch: Partial<BatchDownloadItem>,
): DownloadHistoryTask[] {
  const now = Date.now();
  return tasks.map((task) => {
    if (task.id !== taskId || task.type !== "batch" || !task.items) {
      return task;
    }
    const items = task.items.map((item) =>
      item.id === itemId ? { ...item, ...patch } : item,
    );
    return {
      ...task,
      ...calculateBatchTaskState(items),
      items,
      updatedAt: now,
    };
  });
}

function cancelQueuedBatchItems(
  tasks: DownloadHistoryTask[],
  taskId: string,
): DownloadHistoryTask[] {
  const now = Date.now();
  return tasks.map((task) => {
    if (task.id !== taskId || task.type !== "batch" || !task.items) {
      return task;
    }
    const items = task.items.map((item) =>
      ["queued", "parsing"].includes(item.status)
        ? {
            ...item,
            status: "cancelled" as BatchDownloadStatus,
            error: undefined,
          }
        : item,
    );
    return {
      ...task,
      ...calculateBatchTaskState(items),
      items,
      updatedAt: now,
    };
  });
}

function restoreDownloadHistoryTasks(history: any): DownloadHistoryTask[] {
  const now = Date.now();
  if (Array.isArray(history?.tasks)) {
    return history.tasks.flatMap((task: any, index: number) => {
      if (
        !task ||
        typeof task !== "object" ||
        typeof task.id !== "string" ||
        typeof task.title !== "string" ||
        !VIDEO_SOURCES.some((source) => source.id === task.source) ||
        (task.type !== "single" && task.type !== "batch") ||
        !isBatchDownloadStatus(task.status)
      ) {
        return [];
      }

      if (task.type === "batch") {
        const items = restoreBatchDownloadItems(task.items);
        const state = calculateBatchTaskState(items);
        return [
          {
            id: task.id,
            type: "batch",
            title: task.title,
            source: task.source,
            resourceKey:
              typeof task.resourceKey === "string"
                ? task.resourceKey
                : undefined,
            ...state,
            directoryPath:
              typeof task.directoryPath === "string"
                ? task.directoryPath
                : undefined,
            items,
            expanded: Boolean(task.expanded),
            createdAt:
              typeof task.createdAt === "number" ? task.createdAt : now - index,
            updatedAt:
              typeof task.updatedAt === "number" ? task.updatedAt : now - index,
          },
        ];
      }

      const restored = restoreSingleDownloadTask(task);
      if (!restored) return [];
      return [
        {
          ...restored,
          type: "single",
          resourceKey:
            typeof task.resourceKey === "string" ? task.resourceKey : undefined,
          createdAt:
            typeof task.createdAt === "number" ? task.createdAt : now - index,
          updatedAt:
            typeof task.updatedAt === "number" ? task.updatedAt : now - index,
        },
      ];
    });
  }

  const tasks: DownloadHistoryTask[] = [];
  const single = restoreSingleDownloadTask(history?.singleDownloadTask);
  if (single) {
    tasks.push({
      ...single,
      type: "single",
      resourceKey: undefined,
      createdAt: now - 1,
      updatedAt: now - 1,
    });
  }
  const items = restoreBatchDownloadItems(history?.batchDownloadItems);
  if (items.length > 0) {
    tasks.push({
      id: `batch_${now}`,
      type: "batch",
      title: history?.batchDownloadTitle || "Bilibili 批量下载",
      source: "bilibili",
      resourceKey: undefined,
      ...calculateBatchTaskState(items),
      items,
      expanded: Boolean(history?.isBatchHistoryExpanded),
      createdAt: now - 2,
      updatedAt: now - 2,
    });
  }
  return tasks;
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
  const [curlImports, setCurlImports] = useState<CurlImportEntry[]>(loadCurlImports);
  const [isCurlDialogOpen, setIsCurlDialogOpen] = useState(false);
  const inputWrapRef = useRef<HTMLDivElement>(null);
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
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [downloadHistoryTasks, setDownloadHistoryTasks] = useState<
    DownloadHistoryTask[]
  >([]);
  const [isDownloadHistoryLoaded, setIsDownloadHistoryLoaded] = useState(false);
  const previewVideoRef = useRef<HTMLVideoElement | null>(null);
  const batchRunIdRef = useRef(0);
  const activeDownloadResourceKeysRef = useRef<Set<string>>(new Set());
  const downloadTaskResourceKeysRef = useRef<Map<string, string[]>>(new Map());

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
          ? "粘贴网页或 M3U8 播放列表链接，按 Enter 开始解析..."
          : "粘贴视频链接，按 Enter 开始解析...";
  const activeDownloadCount = downloadHistoryTasks.filter((task) =>
    ["queued", "parsing", "downloading"].includes(task.status),
  ).length;
  const activeBatchCount = downloadHistoryTasks.filter(
    (task) =>
      task.type === "batch" &&
      ["queued", "parsing", "downloading"].includes(task.status),
  ).length;
  const hasDownloadTasks = downloadHistoryTasks.length > 0;
  const matchedCurlEntry = getMatchedCurlEntry(downloadUrl, curlImports);

  useEffect(() => {
    let cancelled = false;

    const loadHistory = async () => {
      try {
        const history = await getDownloadHistory();
        if (cancelled || !history) return;

        setDownloadHistoryTasks(restoreDownloadHistoryTasks(history));
      } catch (error) {
        console.error("[DownloadHistory] Failed to load:", error);
      } finally {
        if (!cancelled) {
          setIsDownloadHistoryLoaded(true);
        }
      }
    };

    void loadHistory();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isDownloadHistoryLoaded) return;

    const handle = window.setTimeout(() => {
      void saveDownloadHistory({
        tasks: downloadHistoryTasks,
        updatedAt: Date.now(),
      }).catch((error) => {
        console.error("[DownloadHistory] Failed to save:", error);
      });
    }, 300);

    return () => window.clearTimeout(handle);
  }, [downloadHistoryTasks, isDownloadHistoryLoaded]);

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

  useEffect(() => {
    saveCurlImports(curlImports);
  }, [curlImports]);

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
      setDownloadUrl("");
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

    try {
      const matchedCurl = getMatchedCurlEntry(rawInput, curlImports)?.rawCurl;
      const info = await parseVideo(rawInput, matchedCurl, activeSource);
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
  }, [activeSource, downloadUrl, curlImports, t]);

  const handleSelectM3u8Candidate = useCallback(
    async (url: string) => {
      setDownloadUrl(url);
      setParseStatus("parsing");
      setVideoFormats([]);
      setVideoItems([]);
      setVideoMessage("");
      try {
        const matchedCurl = getMatchedCurlEntry(url, curlImports)?.rawCurl;
        const info = await parseVideo(url, matchedCurl, "m3u8");
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
        console.error("[VideoParser] Failed to parse M3U8 candidate:", error);
        toast.error(extractErrorMessage(error) || "视频解析失败");
        setParseStatus("error");
      }
    },
    [curlImports],
  );

  // 监听下载进度
  useEffect(() => {
    let unlisten: (() => void) | undefined;

    const setup = async () => {
      unlisten = await listenDownloadProgress((progress) => {
        let batchCompletionToast: { message: string; type: "success" | "info" } | null = null;

        setDownloadHistoryTasks((tasks) => {
          const now = Date.now();

          return tasks.map((task) => {
            const nextStatus: BatchDownloadStatus =
              progress.status === "completed"
                ? "completed"
                : progress.status === "failed"
                  ? "failed"
                  : progress.status === "cancelled"
                    ? "cancelled"
                    : progress.status === "remuxing"
                      ? "remuxing"
                      : "downloading";

            if (task.type === "single" && task.id === progress.task_id) {
              const percent =
                progress.total && progress.total > 0
                  ? Math.round((progress.downloaded / progress.total) * 100)
                  : task.progress;
              return {
                ...task,
                status: nextStatus,
                progress: nextStatus === "completed" ? 100 : percent,
                speed: progress.speed,
                error: progress.status === "failed" ? "下载失败" : task.error,
                filePath: progress.file_path || task.filePath,
                updatedAt: now,
              };
            }

            if (task.type !== "batch" || !task.items) return task;
            let changed = false;
            const items = task.items.map((item) => {
              if (item.taskId !== progress.task_id) return item;
              changed = true;
              const percent =
                progress.total && progress.total > 0
                  ? Math.round((progress.downloaded / progress.total) * 100)
                  : item.progress;
              return {
                ...item,
                status: nextStatus,
                progress: nextStatus === "completed" ? 100 : percent,
                speed: progress.speed,
                error: progress.status === "failed" ? "下载失败" : item.error,
                filePath: progress.file_path || item.filePath,
              };
            });
            if (!changed) return task;
            const prevStatus = task.status;
            const state = calculateBatchTaskState(items);
            const nextTask = {
              ...task,
              ...state,
              items,
              updatedAt: now,
            };
            const wasActive = ["queued", "parsing", "downloading", "remuxing"].includes(prevStatus);
            const isFinal = !["queued", "parsing", "downloading", "remuxing"].includes(nextTask.status);
            if (wasActive && isFinal) {
              const completedCount = items.filter((i) => i.status === "completed").length;
              const total = items.length;
              if (completedCount > 0) {
                batchCompletionToast = {
                  message: `批量下载完成：${completedCount}/${total} 个视频`,
                  type: "success",
                };
              } else {
                batchCompletionToast = { message: "批量下载已结束", type: "info" };
              }
            }
            return nextTask;
          });
        });

        if (batchCompletionToast) {
          const { type, message } = batchCompletionToast;
          if (type === "success") {
            toast.success(message);
          } else {
            toast.info(message);
          }
        }

        if (progress.status === "completed") {
          if (progress.is_batch !== true) {
            toast.success("下载完成");
          }
          const keys = downloadTaskResourceKeysRef.current.get(
            progress.task_id,
          );
          keys?.forEach((key) =>
            activeDownloadResourceKeysRef.current.delete(key),
          );
          downloadTaskResourceKeysRef.current.delete(progress.task_id);
          setDownloadTaskId((taskId) =>
            taskId === progress.task_id ? null : taskId,
          );
        } else if (progress.status === "failed") {
          setDownloadError("下载失败");
          if (progress.is_batch !== true) {
            toast.error("下载失败");
          }
          const keys = downloadTaskResourceKeysRef.current.get(
            progress.task_id,
          );
          keys?.forEach((key) =>
            activeDownloadResourceKeysRef.current.delete(key),
          );
          downloadTaskResourceKeysRef.current.delete(progress.task_id);
          setDownloadTaskId((taskId) =>
            taskId === progress.task_id ? null : taskId,
          );
        } else if (progress.status === "cancelled") {
          if (progress.is_batch !== true) {
            toast.info("下载已取消");
          }
          const keys = downloadTaskResourceKeysRef.current.get(
            progress.task_id,
          );
          keys?.forEach((key) =>
            activeDownloadResourceKeysRef.current.delete(key),
          );
          downloadTaskResourceKeysRef.current.delete(progress.task_id);
          setDownloadTaskId((taskId) =>
            taskId === progress.task_id ? null : taskId,
          );
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
      const format = videoFormats[selectedFormatIdx];
      const resourceKeys = Array.from(
        new Set(
          [format.url, downloadUrl.trim()]
            .filter(Boolean)
            .map((url) => downloadResourceKey(activeSource, url)),
        ),
      );
      const resourceKey = resourceKeys[0];
      if (
        hasActiveDownloadForResource(downloadHistoryTasks, resourceKeys) ||
        resourceKeys.some((key) =>
          activeDownloadResourceKeysRef.current.has(key),
        )
      ) {
        toast.info("该视频正在下载中");
        return;
      }
      resourceKeys.forEach((key) =>
        activeDownloadResourceKeysRef.current.add(key),
      );
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

      toast.info(`开始下载: ${videoTitle}`);
      const taskId = await startVideoDownload(videoTitle, format, dir, false);
      downloadTaskResourceKeysRef.current.set(taskId, resourceKeys);
      setDownloadTaskId(taskId);
      const now = Date.now();
      setDownloadHistoryTasks((tasks) => [
        {
          id: taskId,
          type: "single",
          title: videoTitle,
          source: activeSource,
          resourceKey,
          status: "downloading",
          progress: 0,
          speed: 0,
          filePath: undefined,
          createdAt: now,
          updatedAt: now,
        },
        ...tasks,
      ]);
    } catch (error) {
      const format = videoFormats[0];
      [format?.url, downloadUrl.trim()]
        .filter(Boolean)
        .map((url) => downloadResourceKey(activeSource, url as string))
        .forEach((key) => activeDownloadResourceKeysRef.current.delete(key));
      console.error("[Download] Failed to start:", error);
      toast.error(extractErrorMessage(error) || "启动下载失败");
    }
  }, [
    activeSource,
    downloadHistoryTasks,
    downloadUrl,
    videoFormats,
    videoTitle,
    settingsData,
  ]);

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

    const activeResourceKeys = new Set(
      downloadHistoryTasks.flatMap((task) => {
        if (!["queued", "parsing", "downloading", "remuxing"].includes(task.status)) {
          return [];
        }
        return [
          ...(task.resourceKey ? [task.resourceKey] : []),
          ...(task.items || []).map((item) =>
            downloadResourceKey(task.source, item.url),
          ),
        ];
      }),
    );
    const downloadableItems = selectedItems.filter(
      (item) =>
        !activeResourceKeys.has(downloadResourceKey("bilibili", item.url)),
    );
    const skippedCount = selectedItems.length - downloadableItems.length;
    if (downloadableItems.length === 0) {
      toast.info("选中的视频都在下载中");
      return;
    }

    const dir = await ensureDownloadDirectory();
    if (!dir) return;

    const collectionTitle = videoTitle || "Bilibili 批量下载";
    const collectionDir = await join(dir, sanitizePathSegment(collectionTitle));
    const runId = batchRunIdRef.current + 1;
    batchRunIdRef.current = runId;
    const historyTaskId = `batch_${crypto.randomUUID()}`;
    const now = Date.now();
    const initialItems = downloadableItems.map((item, index) => ({
      id: item.id,
      title: item.title,
      url: item.url,
      order: index,
      status: "queued" as BatchDownloadStatus,
      progress: 0,
      speed: 0,
    }));
    setDownloadHistoryTasks((tasks) => [
      {
        id: historyTaskId,
        type: "batch",
        title: videoTitle || "Bilibili 批量下载",
        source: "bilibili",
        ...calculateBatchTaskState(initialItems),
        directoryPath: collectionDir,
        items: initialItems,
        expanded: true,
        createdAt: now,
        updatedAt: now,
      },
      ...tasks,
    ]);
    toast.info(
      `已开始批量解析 ${downloadableItems.length} 个 Bilibili 视频，保存到合集目录${
        skippedCount > 0 ? `，已跳过 ${skippedCount} 个正在下载的视频` : ""
      }`,
    );

    for (const [idx, item] of downloadableItems.entries()) {
      try {
        if (batchRunIdRef.current !== runId) break;
        // 保守节奏：逐条解析并启动，避免短时间大量请求 B 站接口。
        if (idx > 0) {
          await new Promise((resolve) => window.setTimeout(resolve, 1500));
          if (batchRunIdRef.current !== runId) break;
        }
        setDownloadHistoryTasks((tasks) =>
          updateBatchItem(tasks, historyTaskId, item.id, {
            status: "parsing",
            error: undefined,
          }),
        );
        const info = await parseVideo(item.url);
        if (batchRunIdRef.current !== runId) {
          setDownloadHistoryTasks((tasks) =>
            updateBatchItem(tasks, historyTaskId, item.id, {
              status: "cancelled",
              error: undefined,
            }),
          );
          break;
        }
        const format = info.formats[0];
        if (!format) {
          setDownloadHistoryTasks((tasks) =>
            updateBatchItem(tasks, historyTaskId, item.id, {
              status: "failed",
              error: "未找到可下载清晰度",
            }),
          );
          toast.error(`未找到可下载清晰度：${item.title}`);
          continue;
        }
        if (batchRunIdRef.current !== runId) break;
        const taskId = await startVideoDownload(
          formatBatchItemTitle(idx, item.title || info.title),
          format,
          collectionDir,
          true,
        );
        setDownloadHistoryTasks((tasks) =>
          updateBatchItem(tasks, historyTaskId, item.id, {
            taskId,
            status: "downloading",
            progress: 0,
            speed: 0,
            filePath: undefined,
          }),
        );
      } catch (error) {
        const message = extractErrorMessage(error);
        setDownloadHistoryTasks((tasks) =>
          updateBatchItem(tasks, historyTaskId, item.id, {
            status: "failed",
            error: message,
          }),
        );
        toast.error(`${item.title}: ${message}`);
      }
    }

    if (batchRunIdRef.current !== runId) {
      setDownloadHistoryTasks((tasks) =>
        cancelQueuedBatchItems(tasks, historyTaskId),
      );
    }
  }, [
    downloadHistoryTasks,
    ensureDownloadDirectory,
    selectedVideoItems,
    videoItems,
    videoTitle,
  ]);

  const handleCancelBatchDownloads = useCallback(
    async (task: DownloadHistoryTask) => {
      batchRunIdRef.current += 1;
      const runningTaskIds = (task.items || [])
        .filter((item) => item.taskId && ["downloading", "remuxing"].includes(item.status))
        .map((item) => item.taskId as string);

      setDownloadHistoryTasks((tasks) => {
        const now = Date.now();
        return tasks.map((historyTask) => {
          if (historyTask.id !== task.id || historyTask.type !== "batch") {
            return historyTask;
          }
          const items = (historyTask.items || []).map((item) =>
            ["queued", "parsing", "downloading", "remuxing"].includes(item.status)
              ? {
                  ...item,
                  status: "cancelled" as BatchDownloadStatus,
                  error: undefined,
                }
              : item,
          );
          return {
            ...historyTask,
            ...calculateBatchTaskState(items),
            items,
            updatedAt: now,
          };
        });
      });

      await Promise.allSettled(runningTaskIds.map(cancelVideoDownload));
    },
    [],
  );

  const handleRetryBatchItem = useCallback(
    async (task: DownloadHistoryTask, item: BatchDownloadItem) => {
      const dir = await ensureDownloadDirectory();
      if (!dir) return;

      const collectionTitle = task.title || videoTitle || "Bilibili批量下载";
      const collectionDir = await join(
        dir,
        sanitizePathSegment(collectionTitle),
      );

      setDownloadHistoryTasks((tasks) =>
        updateBatchItem(tasks, task.id, item.id, {
          taskId: undefined,
          status: "parsing",
          progress: 0,
          speed: 0,
          error: undefined,
          filePath: undefined,
        }),
      );

      try {
        const info = await parseVideo(item.url);
        const format = info.formats[0];
        if (!format) {
          throw new Error("未找到可下载清晰度");
        }
        const taskId = await startVideoDownload(
          formatBatchItemTitle(item.order, item.title || info.title),
          format,
          collectionDir,
          true,
        );
        setDownloadHistoryTasks((tasks) =>
          updateBatchItem(tasks, task.id, item.id, {
            taskId,
            status: "downloading",
            progress: 0,
            speed: 0,
            error: undefined,
            filePath: undefined,
          }),
        );
      } catch (error) {
        const message = extractErrorMessage(error);
        setDownloadHistoryTasks((tasks) =>
          updateBatchItem(tasks, task.id, item.id, {
            status: "failed",
            error: message,
          }),
        );
        toast.error(`${item.title}: ${message}`);
      }
    },
    [ensureDownloadDirectory, videoTitle],
  );

  const handleClearDownloadHistory = useCallback(async () => {
    if (activeDownloadCount > 0 || downloadTaskId) {
      toast.error("仍有下载任务进行中，无法清空历史");
      return;
    }

    setDownloadHistoryTasks([]);

    try {
      await clearDownloadHistory();
    } catch (error) {
      console.error("[DownloadHistory] Failed to clear:", error);
      toast.error(extractErrorMessage(error) || "清空下载历史失败");
    }
  }, [activeDownloadCount, downloadTaskId]);

  const handleOpenDownloadedFile = useCallback(async (filePath: string) => {
    try {
      await openDownloadFile(filePath);
    } catch (error) {
      toast.error(extractErrorMessage(error) || "播放文件失败");
    }
  }, []);

  const handleRevealDownloadedFile = useCallback(async (filePath: string) => {
    try {
      await revealDownloadFile(filePath);
    } catch (error) {
      toast.error(extractErrorMessage(error) || "打开文件夹失败");
    }
  }, []);

  const handleOpenBatchDirectory = useCallback(
    async (task: DownloadHistoryTask) => {
      let dirPath = task.directoryPath;
      if (!dirPath) {
        const firstCompleted = task.items?.find(
          (item) => item.status === "completed" && item.filePath,
        );
        if (firstCompleted?.filePath) {
          dirPath = await dirname(firstCompleted.filePath);
        }
      }
      if (!dirPath) {
        toast.error("未找到合集目录");
        return;
      }
      try {
        await openDirectory(dirPath);
      } catch (error) {
        toast.error(extractErrorMessage(error) || "打开目录失败");
      }
    },
    [],
  );

  const handleBackToMain = useCallback(() => {
    setShowSettings(false);
    setShowHistory(false);
  }, []);

  const handleDownloadUrlChange = useCallback((value: string) => {
    setDownloadUrl(value);
  }, []);

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
        <DialogContent zIndex="top" className="sm:max-w-sm md:max-w-md">
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
            "mx-auto w-full max-w-full sm:max-w-3xl md:max-w-4xl lg:max-w-5xl xl:max-w-6xl flex-col gap-3 py-4",
            showHistory ? "flex" : "hidden",
          )}
        >
          {hasDownloadTasks && (
            <div className="flex items-center justify-end">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void handleClearDownloadHistory()}
                disabled={activeDownloadCount > 0 || Boolean(downloadTaskId)}
                className="h-8 px-3 text-xs text-muted-foreground"
              >
                清空记录
              </Button>
            </div>
          )}

          {!hasDownloadTasks && (
            <div className="rounded-xl border border-dashed border-border bg-muted/10 p-8 text-center">
              <Download className="mx-auto h-8 w-8 text-muted-foreground/40 mb-3" />
              <p className="text-sm text-muted-foreground">暂无下载任务</p>
              <p className="mt-1 text-xs text-muted-foreground/60">解析视频后即可开始下载</p>
            </div>
          )}

          {downloadHistoryTasks.map((task) => {
            const items = task.items || [];
            const completedCount = items.filter(
              (item) => item.status === "completed",
            ).length;
            const failedCount = items.filter(
              (item) => item.status === "failed",
            ).length;
            const cancelledCount = items.filter(
              (item) => item.status === "cancelled",
            ).length;
            const isActive = ["queued", "parsing", "downloading", "remuxing"].includes(
              task.status,
            );

            return (
              <div
                key={task.id}
                className="overflow-hidden rounded-xl border border-border bg-background shadow-sm transition-shadow hover:shadow-md"
              >
                <div className="flex items-center gap-3 px-4 py-3.5 text-left">
                  <div className="shrink-0 w-7 flex items-center justify-center">
                    {task.type === "batch" ? (
                      <button
                        type="button"
                        onClick={() =>
                          setDownloadHistoryTasks((tasks) =>
                            tasks.map((historyTask) =>
                              historyTask.id === task.id
                                ? {
                                    ...historyTask,
                                    expanded: !historyTask.expanded,
                                    updatedAt: Date.now(),
                                  }
                                : historyTask,
                            ),
                          )
                        }
                        className="flex h-7 w-7 items-center justify-center rounded-md hover:bg-muted transition-colors"
                        aria-label={task.expanded ? "收起" : "展开"}
                      >
                        {task.expanded ? (
                          <ChevronDown className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        )}
                      </button>
                    ) : null}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{task.title}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {task.type === "batch"
                        ? `批量任务 · 共 ${items.length} 个 · 完成 ${completedCount} 个`
                        : "单视频"}
                      {task.type === "batch" && failedCount > 0
                        ? ` · 失败 ${failedCount} 个`
                        : ""}
                      {task.type === "batch" && cancelledCount > 0
                        ? ` · 取消 ${cancelledCount} 个`
                        : ""}
                      {" · "}
                      {VIDEO_SOURCES.find((source) => source.id === task.source)
                        ?.label || "其他"}
                    </p>
                    {task.error && (
                      <p className="mt-0.5 truncate text-xs text-destructive">
                        {task.error}
                      </p>
                    )}
                  </div>
                  <div className="shrink-0 flex items-center gap-2">
                    <span
                      className={cn(
                        "hidden sm:inline-block w-11 text-center rounded-full border px-1 py-0.5 text-[10px] font-medium leading-none",
                        downloadStatusBadgeClass(task.status),
                      )}
                    >
                      {batchStatusLabel(task.status)}
                    </span>
                    <span className="hidden sm:block w-16 text-right text-xs tabular-nums text-muted-foreground">
                      {formatDownloadSpeed(
                        task.status === "downloading" ? task.speed : 0,
                      )}
                    </span>
                    {task.status !== "completed" ? (
                      <CircularProgress
                        progress={task.progress}
                        size={32}
                        status={task.status}
                      />
                    ) : (
                      <span className="w-8" />
                    )}
                    <div className="w-14 flex items-center justify-end gap-1">
                      {isActive && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() =>
                            task.type === "single"
                              ? void cancelVideoDownload(task.id)
                              : void handleCancelBatchDownloads(task)
                          }
                          aria-label="取消"
                          className="h-7 w-7 text-muted-foreground hover:text-destructive"
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      {task.type === "single" &&
                        task.status === "completed" &&
                        task.filePath && (
                          <>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() =>
                                void handleOpenDownloadedFile(
                                  task.filePath as string,
                                )
                              }
                              aria-label="播放"
                              className="h-7 w-7 text-muted-foreground hover:text-foreground"
                            >
                              <Play className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() =>
                                void handleRevealDownloadedFile(
                                  task.filePath as string,
                                )
                              }
                              aria-label="在文件夹中显示"
                              className="h-7 w-7 text-muted-foreground hover:text-foreground"
                            >
                              <FolderOpen className="h-3.5 w-3.5" />
                            </Button>
                          </>
                        )}
                      {task.type === "batch" && !isActive && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => void handleOpenBatchDirectory(task)}
                          aria-label="打开合集目录"
                          className="h-7 w-7 text-muted-foreground hover:text-foreground"
                        >
                          <FolderOpen className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
                {task.type === "batch" && task.expanded && (
                  <div className="border-t border-border bg-muted/30">
                    {items.map((item, index) => (
                      <div
                        key={item.id}
                        className="flex items-center gap-2 px-4 py-2.5 border-b border-border last:border-b-0 transition-colors hover:bg-muted/40"
                      >
                        <span className="shrink-0 w-7 text-right text-xs tabular-nums text-muted-foreground">
                          {index + 1}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm">{item.title}</p>
                          {item.error && (
                            <p className="truncate text-xs text-destructive">
                              {item.error}
                            </p>
                          )}
                        </div>
                        <div className="shrink-0 flex items-center gap-2">
                          <span
                            className={cn(
                              "w-11 text-center rounded-full border px-1 py-0.5 text-[10px] font-medium leading-none",
                              downloadStatusBadgeClass(item.status),
                            )}
                          >
                            {batchStatusLabel(item.status)}
                          </span>
                          {item.status !== "completed" ? (
                            <CircularProgress
                              progress={item.progress}
                              size={28}
                              status={item.status}
                            />
                          ) : (
                            <span className="w-7" />
                          )}
                          <div className="w-14 flex items-center justify-end gap-1">
                            {["failed", "cancelled"].includes(item.status) && (
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() =>
                                  void handleRetryBatchItem(task, item)
                                }
                                aria-label="重试"
                                className="h-7 w-7 text-muted-foreground hover:text-foreground"
                              >
                                <RotateCcw className="h-3.5 w-3.5" />
                              </Button>
                            )}
                            {item.status === "completed" && item.filePath && (
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() =>
                                  void handleOpenDownloadedFile(
                                    item.filePath as string,
                                  )
                                }
                                aria-label="播放"
                                className="h-7 w-7 text-muted-foreground hover:text-foreground"
                              >
                                <Play className="h-3.5 w-3.5" />
                              </Button>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div
          className={cn(
            "flex-col items-center flex-1",
            !showSettings && !showHistory
              ? "flex"
              : "pointer-events-none absolute inset-x-6 top-0 flex opacity-0",
          )}
        >
          <div className="w-full max-w-full sm:max-w-3xl md:max-w-4xl lg:max-w-5xl xl:max-w-6xl">
            {/* 输入框 */}
            <div ref={inputWrapRef} className="sticky top-0 z-30 bg-background/95 py-2 backdrop-blur-md">
              <div className="relative">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground/50" />
                <Input
                  value={downloadUrl}
                  onChange={(e) => handleDownloadUrlChange(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={t(`download.urlPlaceholder.${activeSource}`, {
                    defaultValue: downloadPlaceholder,
                  })}
                  className="w-full h-14 pl-11 pr-12 text-base rounded-2xl border border-border bg-background/60 shadow-none focus:ring-0 focus:border-border focus:shadow-none"
                />
                <button
                  type="button"
                  onClick={() => setIsCurlDialogOpen((v) => !v)}
                  title={
                    matchedCurlEntry
                      ? `将使用 ${matchedCurlEntry.domain} 的 ${matchedCurlEntry.headerCount} 个 header`
                      : "cURL Headers"
                  }
                  className={cn(
                    "absolute right-3 top-1/2 h-8 w-8 -translate-y-1/2 flex items-center justify-center rounded-lg transition-colors",
                    isCurlDialogOpen
                      ? "bg-muted text-foreground"
                      : matchedCurlEntry
                        ? "text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
                  )}
                >
                  <ChevronDown
                    className={cn(
                      "h-4 w-4 transition-transform",
                      isCurlDialogOpen && "rotate-180",
                    )}
                  />
                  {matchedCurlEntry && (
                    <span className="absolute -top-0.5 -right-0.5 h-3.5 min-w-[14px] px-0.5 rounded-full bg-emerald-500 text-white text-[9px] font-bold flex items-center justify-center">
                      {matchedCurlEntry.headerCount}
                    </span>
                  )}
                </button>

              </div>
            </div>

            <CurlImportDialog
              open={isCurlDialogOpen}
              onOpenChange={setIsCurlDialogOpen}
              curlImports={curlImports}
              onCurlImportsChange={setCurlImports}
              downloadUrl={downloadUrl}
              onFillUrl={(url) => setDownloadUrl(url)}
            />

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
                  <div className="max-h-[calc(100vh-280px)] lg:max-h-[calc(100vh-240px)] overflow-y-auto rounded-xl border border-border">
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

            {parseStatus === "success" &&
              activeSource === "m3u8" &&
              videoItems.length > 0 &&
              videoFormats.length === 0 && (
                <div className="mt-3 animate-fade-in space-y-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">
                      {videoTitle || "发现多个 M3U8 地址"}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {videoMessage || `共 ${videoItems.length} 个候选地址`}
                    </p>
                  </div>
                  <div className="max-h-[calc(100vh-280px)] lg:max-h-[calc(100vh-240px)] overflow-y-auto rounded-xl border border-border">
                    {videoItems.map((item, index) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => void handleSelectM3u8Candidate(item.url)}
                        className="flex w-full items-center gap-3 border-b border-border px-3 py-2 text-left last:border-b-0 hover:bg-muted/40"
                      >
                        <span className="w-8 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                          {index + 1}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm">
                            {item.title}
                          </span>
                          <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                            {item.url}
                          </span>
                        </span>
                      </button>
                    ))}
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
                    className="h-auto max-h-[calc(100vh-220px)] lg:max-h-[calc(100vh-180px)] w-full rounded-xl object-contain"
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
