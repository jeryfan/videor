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

  return (
    <>
      {hasDownloadTasks && (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[180px]">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/50" />
              <Input
                value={historySearch}
                onChange={(e) => setHistorySearch(e.target.value)}
                placeholder={t("download.searchPlaceholder")}
                className="h-9 pl-8 text-sm"
              />
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant={
                  historySourceFilter === "all" ? "secondary" : "ghost"
                }
                size="sm"
                onClick={() => setHistorySourceFilter("all")}
                className="h-8 px-2 text-xs"
              >
                {t("common.all")}
              </Button>
              {VIDEO_SOURCES.map(({ id, label, icon: Icon }) => (
                <Button
                  key={id}
                  variant={
                    historySourceFilter === id ? "secondary" : "ghost"
                  }
                  size="icon"
                  onClick={() => setHistorySourceFilter(id)}
                  aria-label={label}
                  className="h-8 w-8"
                >
                  <Icon className="h-3.5 w-3.5" />
                </Button>
              ))}
            </div>
            <div className="flex items-center gap-1">
              {[
                { key: "all" as const, label: t("common.clear") },
                {
                  key: "active" as const,
                  label: t("download.status.active", { defaultValue: "进行中" }),
                },
                {
                  key: "completed" as const,
                  label: t("download.status.completed"),
                },
                {
                  key: "failed" as const,
                  label: t("download.status.failed"),
                },
              ].map(({ key, label }) => (
                <Button
                  key={key}
                  variant={
                    historyStatusFilter === key ? "secondary" : "ghost"
                  }
                  size="sm"
                  onClick={() => setHistoryStatusFilter(key)}
                  className="h-8 px-2 text-xs"
                >
                  {label}
                </Button>
              ))}
            </div>
          </div>
          <div className="flex items-center justify-end">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void onClearHistory()}
              className="h-8 px-3 text-xs text-muted-foreground"
            >
              {t("download.clearHistory")}
            </Button>
          </div>
        </div>
      )}

      {!hasDownloadTasks && (
        <div className="rounded-xl border border-dashed border-border bg-muted/10 p-8 text-center">
          <Download className="mx-auto h-8 w-8 text-muted-foreground/40 mb-3" />
          <p className="text-sm text-muted-foreground">
            {t("download.emptyTitle")}
          </p>
          <p className="mt-1 text-xs text-muted-foreground/60">
            {t("download.emptyHint")}
          </p>
        </div>
      )}

      {hasDownloadTasks && filteredHistoryTasks.length === 0 && (
        <div className="rounded-xl border border-dashed border-border bg-muted/10 p-8 text-center">
          <Search className="mx-auto h-8 w-8 text-muted-foreground/40 mb-3" />
          <p className="text-sm text-muted-foreground">
            {t("download.noFilterResult")}
          </p>
          <p className="mt-1 text-xs text-muted-foreground/60">
            {t("download.noFilterResultHint")}
          </p>
        </div>
      )}

      {filteredHistoryTasks.map((task) => {
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
        const isActive = ["queued", "downloading", "remuxing"].includes(
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
                    onClick={() => onToggleTaskExpanded(task.id)}
                    className="flex h-7 w-7 items-center justify-center rounded-md hover:bg-muted transition-colors"
                    aria-label={task.expanded ? t("download.action.collapse") : t("download.action.expand")}
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
                    ? t("download.batchSummary", {
                        count: items.length,
                        completed: completedCount,
                      })
                    : t("download.singleTask")}
                  {task.type === "batch" && failedCount > 0
                    ? ` · ${t("download.batchFailed", { count: failedCount })}`
                    : ""}
                  {task.type === "batch" && cancelledCount > 0
                    ? ` · ${t("download.batchCancelled", { count: cancelledCount })}`
                    : ""}
                  {" · "}
                  {VIDEO_SOURCES.find((source) => source.id === task.source)
                    ?.label || t("download.unknownSource")}
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
                  {t(`download.status.${task.status}`)}
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
                <div className="flex items-center justify-end gap-1">
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
                  {task.type === "single" &&
                    task.status === "completed" &&
                    task.filePath && (
                      <>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() =>
                            void onOpenDownloadedFile(
                              task.filePath as string,
                            )
                          }
                          aria-label={t("download.action.play")}
                          className="h-7 w-7 text-muted-foreground hover:text-foreground"
                        >
                          <Play className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() =>
                            void onRevealDownloadedFile(
                              task.filePath as string,
                            )
                          }
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
                        {t(`download.status.${item.status}`)}
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
                      <div className="flex items-center justify-end gap-1">
                        {["failed", "cancelled"].includes(item.status) && (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() =>
                              void onRetryBatchItem(task, item)
                            }
                            aria-label={t("download.action.retry")}
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
                              void onOpenDownloadedFile(
                                item.filePath as string,
                              )
                            }
                            aria-label={t("download.action.play")}
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
    </>
  );
}
