import { useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { join, dirname } from "@tauri-apps/api/path";
import { invoke } from "@tauri-apps/api/core";
import { settingsApi } from "@/lib/api";
import {
  startVideoDownload,
  cancelVideoDownload,
  clearDownloadHistory,
  deleteDownloadTask,
  removeDownloadPartFile,
  openDownloadFile,
  revealDownloadFile,
  openDirectory,
} from "@/lib/api/download";
import { parseVideo } from "@/lib/api/videoParser";
import { extractErrorMessage } from "@/utils/errorUtils";
import type { Settings } from "@/types";
import type { VideoSource } from "@/types/download";
import {
  type BatchDownloadItem,
  type BatchDownloadStatus,
  type DownloadHistoryTask,
  calculateBatchTaskState,
  cancelQueuedBatchItems,
  downloadResourceKey,
  formatBatchItemTitle,
  hasActiveDownloadForResource,
  sanitizePathSegment,
  updateBatchItem,
} from "@/types/download";

export function useDownloadActions(
  settingsData: Settings | undefined,
  downloadHistoryTasks: DownloadHistoryTask[],
  setDownloadHistoryTasks: React.Dispatch<
    React.SetStateAction<DownloadHistoryTask[]>
  >,
  activeDownloadResourceKeysRef: React.MutableRefObject<Set<string>>,
  downloadTaskResourceKeysRef: React.MutableRefObject<
    Map<string, string[]>
  >,
  setDownloadTaskId: React.Dispatch<React.SetStateAction<string | null>>,
  setDownloadError: React.Dispatch<React.SetStateAction<string | null>>,
) {
  const { t } = useTranslation();
  const batchRunIdRef = useRef(0);

  const ensureDownloadDirectory = useCallback(async () => {
    let dir: string | null = settingsData?.downloadDirectory ?? null;
    if (!dir) {
      dir = await invoke<string | null>("pick_directory", {});
      if (!dir) {
        toast.info(t("video.noSaveDir"));
        return null;
      }
      try {
        await settingsApi.save({
          ...settingsData,
          downloadDirectory: dir,
        } as Settings);
      } catch (e) {
        console.warn("[Download] Failed to save default directory:", e);
      }
    }
    return dir;
  }, [settingsData, t]);

  const startSingleDownload = useCallback(
    async (options: {
      title: string;
      format: { url: string };
      source: VideoSource;
      url: string;
    }) => {
      const { title, format, source, url } = options;

      const resourceKeys = Array.from(
        new Set(
          [format.url, url.trim()]
            .filter(Boolean)
            .map((u) => downloadResourceKey(source, u)),
        ),
      );
      const resourceKey = resourceKeys[0];
      if (
        hasActiveDownloadForResource(downloadHistoryTasks, resourceKeys) ||
        resourceKeys.some((key) =>
          activeDownloadResourceKeysRef.current.has(key),
        )
      ) {
        toast.info(t("video.alreadyDownloading"));
        return null;
      }
      // 检查是否已有相同视频的历史任务（避免 completed/failed 后重复创建脏数据）
      const existingTask = downloadHistoryTasks.find(
        (task) =>
          task.type === "single" &&
          task.resourceKey === resourceKey,
      );
      if (existingTask) {
        toast.info(t("video.alreadyInHistory", { defaultValue: "该视频已在历史记录中" }));
        return null;
      }
      resourceKeys.forEach((key) =>
        activeDownloadResourceKeysRef.current.add(key),
      );

      const dir = await ensureDownloadDirectory();
      if (!dir) {
        resourceKeys.forEach((key) =>
          activeDownloadResourceKeysRef.current.delete(key),
        );
        return null;
      }

      setDownloadError(null);

      let finalDir = dir;
      if (settingsData?.autoClassifyDownloads) {
        const today = new Date().toISOString().slice(0, 10);
        const platformDir = await join(dir, source);
        finalDir = await join(platformDir, today);
      }

      try {
        toast.info(t("video.startDownload", { title }));
        const taskId = await startVideoDownload(
          title,
          format as any,
          finalDir,
          false,
        );
        downloadTaskResourceKeysRef.current.set(taskId, resourceKeys);
        setDownloadTaskId(taskId);
        const now = Date.now();
        setDownloadHistoryTasks((tasks) => [
          {
            id: taskId,
            type: "single",
            title,
            source,
            resourceKey,
            status: "queued",
            progress: 0,
            speed: 0,
            filePath: undefined,
            directoryPath: finalDir,
            createdAt: now,
            updatedAt: now,
          },
          ...tasks,
        ]);
        return taskId;
      } catch (error) {
        resourceKeys.forEach((key) =>
          activeDownloadResourceKeysRef.current.delete(key),
        );
        console.error("[Download] Failed to start:", error);
        toast.error(extractErrorMessage(error) || t("video.startDownloadFailed"));
        return null;
      }
    },
    [downloadHistoryTasks, ensureDownloadDirectory, settingsData, t],
  );

  const startBatchDownload = useCallback(
    async (options: {
      items: Array<{ id: string; title: string; url: string }>;
      selectedItemIds: string[];
      title: string;
      parseIntervalMs: number;
    }) => {
      const { items, selectedItemIds, title, parseIntervalMs } = options;
      const selectedItems = items.filter((item) =>
        selectedItemIds.includes(item.id),
      );
      if (selectedItems.length === 0) {
        toast.error(t("download.selectVideos"));
        return;
      }

      const activeResourceKeys = new Set(
        downloadHistoryTasks.flatMap((task) => {
          if (
            !["queued", "downloading", "remuxing"].includes(task.status)
          ) {
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
          !activeResourceKeys.has(
            downloadResourceKey("bilibili", item.url),
          ),
      );
      const skippedCount = selectedItems.length - downloadableItems.length;
      if (downloadableItems.length === 0) {
        toast.info(t("download.allDownloading"));
        return;
      }

      const dir = await ensureDownloadDirectory();
      if (!dir) return;

      const collectionTitle = title || t("video.bilibili.batchTitle");
      const collectionDir = await join(
        dir,
        sanitizePathSegment(collectionTitle),
      );
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
          title: title || t("video.bilibili.batchTitle"),
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
        t("video.bilibili.batchStarted", {
          count: downloadableItems.length,
          suffix:
            skippedCount > 0
              ? t("video.bilibili.batchSkipped", {
                  count: skippedCount,
                })
              : "",
        }),
      );

      for (const [idx, item] of downloadableItems.entries()) {
        try {
          if (batchRunIdRef.current !== runId) break;
          if (idx > 0) {
            await new Promise((resolve) =>
              window.setTimeout(resolve, parseIntervalMs),
            );
            if (batchRunIdRef.current !== runId) break;
          }
          setDownloadHistoryTasks((tasks) =>
            updateBatchItem(tasks, historyTaskId, item.id, {
              status: "queued",
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
                error: t("video.notFoundQuality"),
              }),
            );
            toast.error(
              t("video.bilibili.notFoundForItem", { title: item.title }),
            );
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
    },
    [downloadHistoryTasks, ensureDownloadDirectory, t],
  );

  const handleCancelBatchDownloads = useCallback(
    async (task: DownloadHistoryTask) => {
      batchRunIdRef.current += 1;
      const runningTaskIds = (task.items || [])
        .filter(
          (item) =>
            item.taskId &&
            ["downloading", "remuxing"].includes(item.status),
        )
        .map((item) => item.taskId as string);

      setDownloadHistoryTasks((tasks) => {
        const idx = tasks.findIndex(
          (t) => t.id === task.id && t.type === "batch",
        );
        if (idx === -1) return tasks;
        const now = Date.now();
        const historyTask = tasks[idx];
        const items = (historyTask.items || []).map((item) =>
          ["queued", "downloading", "remuxing"].includes(item.status)
            ? {
                ...item,
                status: "cancelled" as BatchDownloadStatus,
                error: undefined,
              }
            : item,
        );
        const newTasks = tasks.slice();
        newTasks[idx] = {
          ...historyTask,
          ...calculateBatchTaskState(items),
          items,
          updatedAt: now,
        };
        return newTasks;
      });

      await Promise.allSettled(runningTaskIds.map(cancelVideoDownload));
    },
    [setDownloadHistoryTasks],
  );

  const handleRetryBatchItem = useCallback(
    async (
      task: DownloadHistoryTask,
      item: BatchDownloadItem,
      fallbackTitle?: string,
    ) => {
      const dir = await ensureDownloadDirectory();
      if (!dir) return;

      const collectionTitle =
        task.title || fallbackTitle || t("video.bilibili.batchTitle");
      const collectionDir = await join(
        dir,
        sanitizePathSegment(collectionTitle),
      );

      setDownloadHistoryTasks((tasks) =>
        updateBatchItem(tasks, task.id, item.id, {
          taskId: undefined,
          status: "queued",
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
          throw new Error(t("video.notFoundQuality"));
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
    [ensureDownloadDirectory, t],
  );

  const handleRetryAllFailedBatchItems = useCallback(
    async (
      task: DownloadHistoryTask,
      fallbackTitle?: string,
      parseIntervalMs?: number,
    ) => {
      if (task.type !== "batch" || !task.items) return;
      const failedItems = task.items.filter(
        (item) => item.status === "failed",
      );
      if (failedItems.length === 0) return;

      const dir = await ensureDownloadDirectory();
      if (!dir) return;

      const collectionTitle =
        task.title || fallbackTitle || t("video.bilibili.batchTitle");
      const collectionDir = await join(
        dir,
        sanitizePathSegment(collectionTitle),
      );

      setDownloadHistoryTasks((tasks) => {
        const idx = tasks.findIndex(
          (t) => t.id === task.id && t.type === "batch",
        );
        if (idx === -1) return tasks;
        const t = tasks[idx];
        const items = (t.items || []).map((item) =>
          item.status === "failed"
            ? {
                ...item,
                status: "queued" as BatchDownloadStatus,
                progress: 0,
                speed: 0,
                error: undefined,
                filePath: undefined,
              }
            : item,
        );
        const newTasks = tasks.slice();
        newTasks[idx] = {
          ...t,
          ...calculateBatchTaskState(items),
          items,
          updatedAt: Date.now(),
        };
        return newTasks;
      });

      for (const [idx, item] of failedItems.entries()) {
        if (idx > 0) {
          await new Promise((resolve) =>
            window.setTimeout(
              resolve,
              parseIntervalMs ?? 1500,
            ),
          );
        }
        try {
          const info = await parseVideo(item.url);
          const format = info.formats[0];
          if (!format) {
            throw new Error(t("video.notFoundQuality"));
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
      }
    },
    [ensureDownloadDirectory, t],
  );

  const handleClearDownloadHistory = useCallback(async () => {
    setDownloadHistoryTasks([]);
    activeDownloadResourceKeysRef.current.clear();
    downloadTaskResourceKeysRef.current.clear();
    setDownloadTaskId(null);

    try {
      await clearDownloadHistory();
    } catch (error) {
      console.error("[DownloadHistory] Failed to clear:", error);
      toast.error(extractErrorMessage(error) || t("download.clearFailed"));
    }
  }, [setDownloadHistoryTasks, setDownloadTaskId]);

  const handleDeleteDownloadTask = useCallback(
    async (taskId: string) => {
      const taskToDelete = downloadHistoryTasks.find((t) => t.id === taskId);

      // 清理未完成的 .part 临时文件
      if (taskToDelete) {
        const shouldCleanPart = ["downloading", "failed", "cancelled"].includes(
          taskToDelete.status,
        );
        if (shouldCleanPart) {
          if (taskToDelete.type === "single" && taskToDelete.directoryPath) {
            removeDownloadPartFile(taskToDelete.directoryPath, taskToDelete.title).catch(
              () => {
                /* 忽略清理失败 */
              },
            );
          } else if (taskToDelete.type === "batch" && taskToDelete.directoryPath) {
            (taskToDelete.items || [])
              .filter((item) =>
                ["downloading", "failed", "cancelled"].includes(item.status),
              )
              .forEach((item) => {
                removeDownloadPartFile(
                  taskToDelete.directoryPath!,
                  formatBatchItemTitle(item.order, item.title),
                ).catch(() => {
                  /* 忽略清理失败 */
                });
              });
          }
        }
      }

      setDownloadHistoryTasks((tasks) =>
        tasks.filter((task) => task.id !== taskId),
      );
      const keys = downloadTaskResourceKeysRef.current.get(taskId);
      keys?.forEach((key) => activeDownloadResourceKeysRef.current.delete(key));
      downloadTaskResourceKeysRef.current.delete(taskId);
      setDownloadTaskId((id) => (id === taskId ? null : id));

      try {
        // 先尝试取消后端任务（如果它还在运行），再删除历史记录
        await cancelVideoDownload(taskId).catch(() => {
          /* 任务可能已不存在，忽略取消失败 */
        });
        await deleteDownloadTask(taskId);
      } catch (error) {
        console.error("[DownloadHistory] Failed to delete task:", error);
        toast.error(
          extractErrorMessage(error) ||
            t("download.deleteFailed", { defaultValue: "删除任务失败" }),
        );
      }
    },
    [downloadHistoryTasks, setDownloadHistoryTasks, setDownloadTaskId],
  );

  const handleCancelVideoDownload = useCallback(
    async (taskId: string) => {
      try {
        await cancelVideoDownload(taskId);
      } catch (error) {
        console.error("[Download] Failed to cancel:", error);
      }
      // 无论后端是否成功，前端都同步清理状态，防止后端任务丢失导致 UI 卡死
      setDownloadHistoryTasks((tasks) => {
        const idx = tasks.findIndex(
          (task) => task.id === taskId && task.type === "single",
        );
        if (idx === -1) return tasks;
        const newTasks = tasks.slice();
        newTasks[idx] = {
          ...newTasks[idx],
          status: "cancelled" as BatchDownloadStatus,
          error: undefined,
          updatedAt: Date.now(),
        };
        return newTasks;
      });
      const keys = downloadTaskResourceKeysRef.current.get(taskId);
      keys?.forEach((key) => activeDownloadResourceKeysRef.current.delete(key));
      downloadTaskResourceKeysRef.current.delete(taskId);
      setDownloadTaskId((id) => (id === taskId ? null : id));
    },
    [
      setDownloadHistoryTasks,
      setDownloadTaskId,
      downloadTaskResourceKeysRef,
      activeDownloadResourceKeysRef,
    ],
  );

  const handleOpenDownloadedFile = useCallback(
    async (filePath: string) => {
      try {
        await openDownloadFile(filePath);
      } catch (error) {
        toast.error(extractErrorMessage(error) || t("video.openFileFailed"));
      }
    },
    [t],
  );

  const handleRevealDownloadedFile = useCallback(
    async (filePath: string) => {
      try {
        await revealDownloadFile(filePath);
      } catch (error) {
        toast.error(
          extractErrorMessage(error) || t("video.revealFileFailed"),
        );
      }
    },
    [t],
  );

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
        toast.error(t("video.dirNotFound"));
        return;
      }
      try {
        await openDirectory(dirPath);
      } catch (error) {
        toast.error(extractErrorMessage(error) || t("video.openDirFailed"));
      }
    },
    [t],
  );

  return {
    batchRunIdRef,
    startSingleDownload,
    startBatchDownload,
    handleCancelVideoDownload,
    handleCancelBatchDownloads,
    handleRetryBatchItem,
    handleRetryAllFailedBatchItems,
    handleClearDownloadHistory,
    handleDeleteDownloadTask,
    handleOpenDownloadedFile,
    handleRevealDownloadedFile,
    handleOpenBatchDirectory,
  };
}
