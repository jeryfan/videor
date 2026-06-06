import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Search,
  Download,
  X,
  Play,
  FolderOpen,
  RotateCcw,
  ChevronDown,
  ChevronRight,
  Trash2,
  FileVideo,
  ListVideo,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { VIDEO_SOURCES } from "@/components/SourceSwitcher";
import { CircularProgress } from "@/components/download/CircularProgress";
import {
  type BatchDownloadItem,
  type DownloadHistoryTask,
  formatDownloadSpeed,
} from "@/types/download";
import { downloadStatusBadgeClass } from "@/utils/downloadUtils";

import type { VideoSource } from "@/types/download";

interface DownloadHistoryPanelProps {
  historySearch: string;
  setHistorySearch: (value: string) => void;
  historySourceFilter: VideoSource | "all";
  setHistorySourceFilter: (value: VideoSource | "all") => void;
  historyStatusFilter: "all" | "active" | "completed" | "failed";
  setHistoryStatusFilter: (value: "all" | "active" | "completed" | "failed") => void;
  filteredHistoryTasks: DownloadHistoryTask[];
  hasDownloadTasks: boolean;
  onClearHistory: () => void;
  onCancelVideoDownload: (taskId: string) => void;
  onCancelBatchDownloads: (task: DownloadHistoryTask) => void;
  onRetryBatchItem: (task: DownloadHistoryTask, item: BatchDownloadItem) => void;
  onRetryAllFailedBatchItems: (task: DownloadHistoryTask) => void;
  onOpenDownloadedFile: (filePath: string) => void;
  onRevealDownloadedFile: (filePath: string) => void;
  onOpenBatchDirectory: (task: DownloadHistoryTask) => void;
  onToggleTaskExpanded: (taskId: string) => void;
  onDeleteTask: (taskId: string) => void;
}

const STATUS_TABS: Array<{ key: "all" | "active" | "completed" | "failed" }> = [
  { key: "all" },
  { key: "active" },
  { key: "completed" },
  { key: "failed" },
];

function TaskIcon({ type, status }: { type: "single" | "batch"; status: DownloadHistoryTask["status"] }) {
  const Icon = type === "batch" ? ListVideo : FileVideo;
  const colorClass =
    status === "completed"
      ? "text-green-500"
      : status === "failed"
        ? "text-destructive"
        : status === "cancelled"
          ? "text-muted-foreground"
          : "text-primary";
  return (
    <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border bg-background", colorClass)}>
      <Icon className="h-4 w-4" />
    </div>
  );
}

function ProgressBar({ progress, status }: { progress: number; status: DownloadHistoryTask["status"] }) {
  const isActive = ["queued", "downloading", "remuxing"].includes(status);
  if (!isActive && status !== "failed" && progress === 0) return null;
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
      <div
        className={cn(
          "h-full rounded-full transition-all duration-300",
          status === "failed" ? "bg-destructive" : status === "completed" ? "bg-green-500" : "bg-primary",
        )}
        style={{ width: `${Math.max(0, Math.min(100, progress))}%` }}
      />
    </div>
  );
}

export function DownloadHistoryPanel({
  historySearch,
  setHistorySearch,
  historySourceFilter,
  setHistorySourceFilter,
  historyStatusFilter,
  setHistoryStatusFilter,
  filteredHistoryTasks,
  hasDownloadTasks,
  onClearHistory,
  onCancelVideoDownload,
  onCancelBatchDownloads,
  onRetryBatchItem,
  onRetryAllFailedBatchItems,
  onOpenDownloadedFile,
  onRevealDownloadedFile,
  onOpenBatchDirectory,
  onToggleTaskExpanded,
  onDeleteTask,
}: DownloadHistoryPanelProps) {
  const { t } = useTranslation();
  const [hoveredTaskId, setHoveredTaskId] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-3">
      {/* Toolbar */}
      {hasDownloadTasks && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <div className="relative min-w-0 flex-1 max-w-xs">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/50" />
              <Input
                value={historySearch}
                onChange={(e) => setHistorySearch(e.target.value)}
                placeholder={t("download.searchPlaceholder")}
                className="h-8 pl-8 text-xs"
              />
            </div>

            <div className="flex items-center rounded-md border bg-muted/40 p-0.5">
              {STATUS_TABS.map(({ key }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setHistoryStatusFilter(key)}
                  className={cn(
                    "h-6 rounded px-2.5 text-xs font-medium transition-colors",
                    historyStatusFilter === key
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {key === "all" ? t("common.all") : t(`download.status.${key}`)}
                </button>
              ))}
            </div>

            <div className="hidden sm:flex items-center gap-0.5">
              <button
                type="button"
                onClick={() => setHistorySourceFilter("all")}
                className={cn(
                  "h-7 rounded px-2 text-xs transition-colors",
                  historySourceFilter === "all" ? "bg-secondary text-secondary-foreground" : "text-muted-foreground hover:bg-muted",
                )}
              >
                {t("common.all")}
              </button>
              {VIDEO_SOURCES.map(({ id, icon: Icon }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setHistorySourceFilter(id)}
                  className={cn(
                    "flex h-7 w-7 items-center justify-center rounded text-xs transition-colors",
                    historySourceFilter === id ? "bg-secondary text-secondary-foreground" : "text-muted-foreground hover:bg-muted",
                  )}
                  aria-label={id}
                >
                  <Icon className="h-3.5 w-3.5" />
                </button>
              ))}
            </div>

            <Button
              variant="ghost"
              size="sm"
              onClick={() => void onClearHistory()}
              className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="mr-1 h-3 w-3" />
              {t("download.clearHistory")}
            </Button>
          </div>
        </div>
      )}

      {/* Empty states */}
      {!hasDownloadTasks && (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-muted/10 py-12 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            <Download className="h-5 w-5 text-muted-foreground" />
          </div>
          <p className="mt-3 text-sm font-medium text-muted-foreground">{t("download.emptyTitle")}</p>
          <p className="mt-0.5 text-xs text-muted-foreground/60">{t("download.emptyHint")}</p>
        </div>
      )}
      {hasDownloadTasks && filteredHistoryTasks.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-muted/10 py-10 text-center">
          <Search className="h-6 w-6 text-muted-foreground/40" />
          <p className="mt-2 text-sm text-muted-foreground">{t("download.noFilterResult")}</p>
          <p className="mt-0.5 text-xs text-muted-foreground/60">{t("download.noFilterResultHint")}</p>
        </div>
      )}

      {/* Task list */}
      <div className="flex flex-col gap-2">
        {filteredHistoryTasks.map((task) => {
          const items = task.items || [];
          const completedCount = items.filter((i) => i.status === "completed").length;
          const failedCount = items.filter((i) => i.status === "failed").length;
          const isActive = ["queued", "downloading", "remuxing"].includes(task.status);
          const isHovered = hoveredTaskId === task.id;

          return (
            <div
              key={task.id}
              className="group overflow-hidden rounded-xl border border-border bg-background transition-colors hover:border-border/80 hover:bg-muted/20"
              onMouseEnter={() => setHoveredTaskId(task.id)}
              onMouseLeave={() => setHoveredTaskId(null)}
            >
              {/* Main row */}
              <div className="flex items-center gap-3 px-3 py-2.5">
                {/* Icon / expand */}
                <div className="shrink-0">
                  {task.type === "batch" ? (
                    <button
                      type="button"
                      onClick={() => onToggleTaskExpanded(task.id)}
                      className="flex h-9 w-9 items-center justify-center rounded-lg border bg-background transition-colors hover:bg-muted"
                    >
                      {task.expanded ? (
                        <ChevronDown className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      )}
                    </button>
                  ) : (
                    <TaskIcon type="single" status={task.status} />
                  )}
                </div>

                {/* Info */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-medium">{task.title}</p>
                    <span
                      className={cn(
                        "shrink-0 rounded-full border px-1.5 py-px text-[10px] font-medium leading-none",
                        downloadStatusBadgeClass(task.status),
                      )}
                    >
                      {t(`download.status.${task.status}`)}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                    <span>{VIDEO_SOURCES.find((s) => s.id === task.source)?.label || t("download.unknownSource")}</span>
                    {task.type === "batch" && (
                      <>
                        <span>·</span>
                        <span>
                          {completedCount}/{items.length} {t("download.completed", { defaultValue: "完成" })}
                        </span>
                        {failedCount > 0 && (
                          <span className="text-destructive">
                            · {failedCount} {t("download.failed", { defaultValue: "失败" })}
                          </span>
                        )}
                      </>
                    )}
                    {task.error && <span className="text-destructive truncate">· {task.error}</span>}
                  </div>
                  <div className="mt-1.5">
                    <ProgressBar progress={task.progress} status={task.status} />
                  </div>
                </div>

                {/* Right side */}
                <div className="shrink-0 flex items-center gap-2">
                  <span className="hidden sm:block w-16 text-right text-xs tabular-nums text-muted-foreground">
                    {formatDownloadSpeed(task.status === "downloading" ? task.speed : 0)}
                  </span>
                  {task.status !== "completed" ? (
                    <CircularProgress progress={task.progress} size={28} status={task.status} />
                  ) : (
                    <span className="w-7" />
                  )}

                  {/* Actions - hover only */}
                  <div className={cn("flex items-center gap-0.5 transition-opacity duration-150", isHovered ? "opacity-100" : "opacity-0")}>
                    {isActive && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() =>
                          task.type === "single"
                            ? void onCancelVideoDownload(task.id)
                            : void onCancelBatchDownloads(task)
                        }
                        aria-label={t("download.action.cancel")}
                        className="h-7 w-7 text-muted-foreground hover:text-destructive"
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    {task.type === "single" && task.status === "completed" && task.filePath && (
                      <>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => void onOpenDownloadedFile(task.filePath as string)}
                          aria-label={t("download.action.play")}
                          className="h-7 w-7 text-muted-foreground hover:text-foreground"
                        >
                          <Play className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => void onRevealDownloadedFile(task.filePath as string)}
                          aria-label={t("download.action.reveal")}
                          className="h-7 w-7 text-muted-foreground hover:text-foreground"
                        >
                          <FolderOpen className="h-3.5 w-3.5" />
                        </Button>
                      </>
                    )}
                    {task.type === "batch" && !isActive && failedCount > 0 && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => void onRetryAllFailedBatchItems(task)}
                        aria-label={t("download.action.retryAll")}
                        className="h-7 w-7 text-muted-foreground hover:text-foreground"
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    {task.type === "batch" && !isActive && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => void onOpenBatchDirectory(task)}
                        aria-label={t("download.action.openFolder")}
                        className="h-7 w-7 text-muted-foreground hover:text-foreground"
                      >
                        <FolderOpen className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => void onDeleteTask(task.id)}
                      aria-label={t("download.action.delete", { defaultValue: "删除记录" })}
                      className="h-7 w-7 text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </div>

              {/* Batch items */}
              {task.type === "batch" && task.expanded && (
                <div className="border-t border-border bg-muted/20">
                  {items.map((item, index) => (
                    <div
                      key={item.id}
                      className="flex items-center gap-2 px-3 py-2 border-b border-border/50 last:border-b-0 transition-colors hover:bg-muted/30"
                    >
                      <span className="shrink-0 w-6 text-right text-[10px] tabular-nums text-muted-foreground">
                        {index + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs">{item.title}</p>
                        {item.error && (
                          <p className="truncate text-[10px] text-destructive">{item.error}</p>
                        )}
                      </div>
                      <span
                        className={cn(
                          "shrink-0 rounded-full border px-1.5 py-px text-[10px] font-medium leading-none",
                          downloadStatusBadgeClass(item.status),
                        )}
                      >
                        {t(`download.status.${item.status}`)}
                      </span>
                      {item.status !== "completed" && (
                        <CircularProgress progress={item.progress} size={20} status={item.status} />
                      )}
                      <div className={cn("flex items-center gap-0.5 transition-opacity", isHovered ? "opacity-100" : "opacity-0")}>
                        {["failed", "cancelled"].includes(item.status) && (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => void onRetryBatchItem(task, item)}
                            aria-label={t("download.action.retry")}
                            className="h-6 w-6 text-muted-foreground hover:text-foreground"
                          >
                            <RotateCcw className="h-3 w-3" />
                          </Button>
                        )}
                        {item.status === "completed" && item.filePath && (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => void onOpenDownloadedFile(item.filePath as string)}
                            aria-label={t("download.action.play")}
                            className="h-6 w-6 text-muted-foreground hover:text-foreground"
                          >
                            <Play className="h-3 w-3" />
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
