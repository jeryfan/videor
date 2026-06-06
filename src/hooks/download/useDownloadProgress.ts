import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { listenDownloadProgress } from "@/lib/api/download";
import {
  type BatchDownloadStatus,
  type DownloadHistoryTask,
  calculateBatchTaskState,
} from "@/types/download";

function toFrontendStatus(status: string): BatchDownloadStatus {
  if (status === "completed") return "completed";
  if (status === "failed") return "failed";
  if (status === "cancelled") return "cancelled";
  if (status === "remuxing") return "remuxing";
  if (status === "queued") return "queued";
  return "downloading";
}

export function useDownloadProgress(
  setDownloadHistoryTasks: React.Dispatch<
    React.SetStateAction<DownloadHistoryTask[]>
  >,
  downloadTaskResourceKeysRef: React.MutableRefObject<
    Map<string, string[]>
  >,
  activeDownloadResourceKeysRef: React.MutableRefObject<Set<string>>,
  setDownloadTaskId: React.Dispatch<React.SetStateAction<string | null>>,
  setDownloadError: React.Dispatch<React.SetStateAction<string | null>>,
) {
  const { t } = useTranslation();
  const tRef = useRef(t);
  tRef.current = t;

  useEffect(() => {
    let unlisten: (() => void) | undefined;

    const setup = async () => {
      unlisten = await listenDownloadProgress((progress) => {
        const t = tRef.current;
        const nextStatus = toFrontendStatus(progress.status);
        const now = Date.now();

        // 计算进度百分比
        const calcPercent = (current: number) =>
          progress.total && progress.total > 0
            ? Math.round((progress.downloaded / progress.total) * 100)
            : current;

        // 判断是否为最终状态
        const isFinal =
          progress.status === "completed" ||
          progress.status === "failed" ||
          progress.status === "cancelled";

        let batchCompletionToast: {
          message: string;
          type: "success" | "info";
        } | null = null;

        // ---- 高性能更新：findIndex + slice 替代 map ----
        setDownloadHistoryTasks((tasks) => {
          // 1. 尝试匹配 single 任务
          const singleIdx = tasks.findIndex(
            (task) =>
              task.type === "single" && task.id === progress.task_id,
          );
          if (singleIdx !== -1) {
            const newTasks = tasks.slice();
            const task = newTasks[singleIdx];
            newTasks[singleIdx] = {
              ...task,
              status: nextStatus,
              progress: nextStatus === "completed" ? 100 : calcPercent(task.progress),
              speed: progress.speed,
              error:
                progress.status === "failed"
                  ? t("video.downloadFailed")
                  : task.error,
              filePath: progress.file_path || task.filePath,
              updatedAt: now,
            };
            return newTasks;
          }

          // 2. 尝试匹配 batch 子项
          const batchIdx = tasks.findIndex(
            (task) =>
              task.type === "batch" &&
              task.items?.some((item) => item.taskId === progress.task_id),
          );
          if (batchIdx === -1) return tasks;

          const task = tasks[batchIdx];
          let changed = false;
          const items = task.items!.map((item) => {
            if (item.taskId !== progress.task_id) return item;
            changed = true;
            return {
              ...item,
              status: nextStatus,
              progress: nextStatus === "completed" ? 100 : calcPercent(item.progress),
              speed: progress.speed,
              error:
                progress.status === "failed"
                  ? t("video.downloadFailed")
                  : item.error,
              filePath: progress.file_path || item.filePath,
            };
          });
          if (!changed) return tasks;

          const prevStatus = task.status;
          const state = calculateBatchTaskState(items);
          const nextTask = {
            ...task,
            ...state,
            items,
            updatedAt: now,
          };

          const wasActive = ["queued", "downloading", "remuxing"].includes(
            prevStatus,
          );
          const isNowFinal = !["queued", "downloading", "remuxing"].includes(
            nextTask.status,
          );
          if (wasActive && isNowFinal) {
            const completedCount = items.filter(
              (i) => i.status === "completed",
            ).length;
            const total = items.length;
            if (completedCount > 0) {
              batchCompletionToast = {
                message: t("video.bilibili.batchComplete", {
                  completed: completedCount,
                  total,
                }),
                type: "success",
              };
            } else {
              batchCompletionToast = {
                message: t("video.bilibili.batchEnded"),
                type: "info",
              };
            }
          }

          const newTasks = tasks.slice();
          newTasks[batchIdx] = nextTask;
          return newTasks;
        });

        if (batchCompletionToast) {
          const { type, message } = batchCompletionToast;
          if (type === "success") {
            toast.success(message);
          } else {
            toast.info(message);
          }
        }

        if (!isFinal) return;

        // ---- 任务结束后的清理 ----
        if (progress.status === "failed") {
          setDownloadError((prev) => prev || t("video.downloadFailed"));
        }
        if (progress.is_batch === false) {
          if (progress.status === "failed") {
            toast.error(t("video.downloadFailed"));
          } else if (progress.status === "cancelled") {
            toast.info(t("video.downloadCancelled"));
          } else if (progress.status === "completed") {
            toast.success(t("video.downloadComplete"));
          }
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
      });
    };

    void setup();
    return () => {
      unlisten?.();
    };
  }, [
    setDownloadHistoryTasks,
    downloadTaskResourceKeysRef,
    activeDownloadResourceKeysRef,
    setDownloadTaskId,
    setDownloadError,
  ]);
}
