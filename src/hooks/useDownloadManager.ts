import { useState, useEffect, useRef, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { getDownloadHistory, saveDownloadHistory } from "@/lib/api/download";
import { restoreDownloadHistoryTasks } from "@/types/download";
import type { Settings } from "@/types";
import type { VideoSource, DownloadHistoryTask } from "@/types/download";
import { useDownloadProgress } from "@/hooks/download/useDownloadProgress";
import { useDownloadActions } from "@/hooks/download/useDownloadActions";

export function useDownloadManager(settingsData: Settings | undefined) {
  const { t } = useTranslation();

  const [downloadHistoryTasks, setDownloadHistoryTasks] = useState<
    DownloadHistoryTask[]
  >([]);
  const [isDownloadHistoryLoaded, setIsDownloadHistoryLoaded] =
    useState(false);
  const [downloadTaskId, setDownloadTaskId] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const [historySearch, setHistorySearch] = useState("");
  const [historySourceFilter, setHistorySourceFilter] = useState<
    VideoSource | "all"
  >("all");
  const [historyStatusFilter, setHistoryStatusFilter] = useState<
    "all" | "active" | "completed" | "failed"
  >("all");

  const activeDownloadResourceKeysRef = useRef<Set<string>>(new Set());
  const downloadTaskResourceKeysRef = useRef<Map<string, string[]>>(
    new Map(),
  );

  // Load history on mount
  useEffect(() => {
    let cancelled = false;

    const loadHistory = async () => {
      try {
        const history = await getDownloadHistory();
        if (cancelled) return;
        setDownloadHistoryTasks(restoreDownloadHistoryTasks(history, t));
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

  // Auto-save history
  useEffect(() => {
    if (!isDownloadHistoryLoaded) return;

    const handle = window.setTimeout(() => {
      void saveDownloadHistory({
        tasks: downloadHistoryTasks,
        updated_at: Date.now(),
      }).catch((error) => {
        console.error("[DownloadHistory] Failed to save:", error);
      });
    }, 300);

    return () => window.clearTimeout(handle);
  }, [downloadHistoryTasks, isDownloadHistoryLoaded]);

  useDownloadProgress(
    setDownloadHistoryTasks,
    downloadTaskResourceKeysRef,
    activeDownloadResourceKeysRef,
    setDownloadTaskId,
    setDownloadError,
  );

  const actions = useDownloadActions(
    settingsData,
    downloadHistoryTasks,
    setDownloadHistoryTasks,
    activeDownloadResourceKeysRef,
    downloadTaskResourceKeysRef,
    setDownloadTaskId,
    setDownloadError,
  );

  const activeDownloadCount = downloadHistoryTasks.filter((task) =>
    ["queued", "downloading", "remuxing"].includes(task.status),
  ).length;

  const activeBatchCount = downloadHistoryTasks.filter(
    (task) =>
      task.type === "batch" &&
      ["queued", "downloading", "remuxing"].includes(task.status),
  ).length;

  const hasDownloadTasks = downloadHistoryTasks.length > 0;

  const filteredHistoryTasks = useMemo(() => {
    const query = historySearch.trim().toLowerCase();
    return downloadHistoryTasks.filter((task) => {
      if (
        historySourceFilter !== "all" &&
        task.source !== historySourceFilter
      )
        return false;
      if (historyStatusFilter !== "all") {
        if (historyStatusFilter === "active") {
          if (
            !["queued", "downloading", "remuxing"].includes(task.status)
          )
            return false;
        } else if (historyStatusFilter === "completed") {
          if (task.status !== "completed") return false;
        } else if (historyStatusFilter === "failed") {
          if (task.status !== "failed") return false;
        }
      }
      if (query) {
        if (task.title.toLowerCase().includes(query)) return true;
        if (
          task.type === "batch" &&
          task.items?.some((item) =>
            item.title.toLowerCase().includes(query),
          )
        ) {
          return true;
        }
        return false;
      }
      return true;
    });
  }, [
    downloadHistoryTasks,
    historySourceFilter,
    historyStatusFilter,
    historySearch,
  ]);

  return {
    downloadHistoryTasks,
    setDownloadHistoryTasks,
    isDownloadHistoryLoaded,
    downloadTaskId,
    setDownloadTaskId,
    downloadError,
    setDownloadError,
    historySearch,
    setHistorySearch,
    historySourceFilter,
    setHistorySourceFilter,
    historyStatusFilter,
    setHistoryStatusFilter,
    activeDownloadCount,
    activeBatchCount,
    hasDownloadTasks,
    filteredHistoryTasks,
    ...actions,
  };
}
