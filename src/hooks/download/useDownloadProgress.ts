import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { listenDownloadProgress } from "@/lib/api/download";
import {
  type BatchDownloadStatus,
  type DownloadHistoryTask,
  calculateBatchTaskState,
} from "@/types/download";

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
        let batchCompletionToast: {
          message: string;
          type: "success" | "info";
        } | null = null;

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
                      : progress.status === "queued"
                        ? "queued"
                        : "downloading";

            if (task.type === "single" && task.id === progress.task_id) {
              const percent =
                progress.total && progress.total > 0
                  ? Math.round(
                      (progress.downloaded / progress.total) * 100,
                    )
                  : task.progress;
              return {
                ...task,
                status: nextStatus,
                progress: nextStatus === "completed" ? 100 : percent,
                speed: progress.speed,
                error:
                  progress.status === "failed"
                    ? t("video.downloadFailed")
                    : task.error,
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
                  ? Math.round(
                      (progress.downloaded / progress.total) * 100,
                    )
                  : item.progress;
              return {
                ...item,
                status: nextStatus,
                progress: nextStatus === "completed" ? 100 : percent,
                speed: progress.speed,
                error:
                  progress.status === "failed"
                    ? t("video.downloadFailed")
                    : item.error,
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
            const wasActive = ["queued", "downloading", "remuxing"].includes(
              prevStatus,
            );
            const isFinal = !["queued", "downloading", "remuxing"].includes(
              nextTask.status,
            );
            if (wasActive && isFinal) {
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

        const cleanupTask = (status: "completed" | "failed" | "cancelled") => {
          if (status === "failed") {
            setDownloadError(t("video.downloadFailed"));
          }
          if (status !== "completed" && progress.is_batch !== true) {
            if (status === "failed") {
              toast.error(t("video.downloadFailed"));
            } else {
              toast.info(t("video.downloadCancelled"));
            }
          } else if (status === "completed" && progress.is_batch !== true) {
            toast.success(t("video.downloadComplete"));
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
        };

        if (
          progress.status === "completed" ||
          progress.status === "failed" ||
          progress.status === "cancelled"
        ) {
          cleanupTask(progress.status);
        }
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
