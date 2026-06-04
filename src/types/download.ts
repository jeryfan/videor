import type { TFunction } from "i18next";

export type VideoSource = "douyin" | "bilibili" | "m3u8" | "other";

export type BatchDownloadStatus =
  | "queued"
  | "downloading"
  | "remuxing"
  | "completed"
  | "failed"
  | "cancelled";

export interface BatchDownloadItem {
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

export interface SingleDownloadTask {
  id: string;
  title: string;
  source: VideoSource;
  status: BatchDownloadStatus;
  progress: number;
  speed: number;
  error?: string;
  filePath?: string;
}

export interface DownloadHistoryTask {
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

export interface PersistedDownloadHistory {
  tasks: unknown[];
  updatedAt?: number;
}

export function isBatchDownloadStatus(value: unknown): value is BatchDownloadStatus {
  return (
    typeof value === "string" &&
    [
      "queued",
      "downloading",
      "remuxing",
      "completed",
      "failed",
      "cancelled",
    ].includes(value)
  );
}

export function normalizePersistedStatus(
  status: BatchDownloadStatus,
): BatchDownloadStatus {
  return ["queued", "downloading", "remuxing"].includes(status)
    ? "cancelled"
    : status;
}

export function downloadResourceKey(source: VideoSource, url: string): string {
  return `${source}:${url.trim()}`;
}

export function hasActiveDownloadForResource(
  tasks: DownloadHistoryTask[],
  resourceKeys: string[],
): boolean {
  const keySet = new Set(resourceKeys.filter(Boolean));
  return tasks.some((task) => {
    if (!["queued", "downloading", "remuxing"].includes(task.status)) {
      return false;
    }
    if (task.resourceKey && keySet.has(task.resourceKey)) return true;
    return (task.items || []).some((item) =>
      keySet.has(downloadResourceKey(task.source, item.url)),
    );
  });
}

export function calculateBatchTaskState(
  items: BatchDownloadItem[],
): Pick<DownloadHistoryTask, "status" | "progress" | "speed"> {
  if (items.length === 0) {
    return { status: "queued", progress: 0, speed: 0 };
  }
  const activeCount = items.filter((item) =>
    ["queued", "downloading", "remuxing"].includes(item.status),
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

export function updateBatchItem(
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

export function cancelQueuedBatchItems(
  tasks: DownloadHistoryTask[],
  taskId: string,
): DownloadHistoryTask[] {
  const now = Date.now();
  return tasks.map((task) => {
    if (task.id !== taskId || task.type !== "batch" || !task.items) {
      return task;
    }
    const items = task.items.map((item) =>
      ["queued"].includes(item.status)
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

export function restoreSingleDownloadTask(
  value: unknown,
  t: TFunction,
): SingleDownloadTask | null {
  if (!value || typeof value !== "object") return null;
  const task = value as Partial<SingleDownloadTask>;
  if (
    typeof task.id !== "string" ||
    typeof task.title !== "string" ||
    !task.source ||
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
        ? t("download.sessionInterrupted")
        : typeof task.error === "string"
          ? task.error
          : undefined,
    filePath: typeof task.filePath === "string" ? task.filePath : undefined,
  };
}

export function restoreBatchDownloadItems(
  value: unknown,
  t: TFunction,
): BatchDownloadItem[] {
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
            ? t("download.sessionInterrupted")
            : typeof task.error === "string"
              ? task.error
              : undefined,
        filePath: typeof task.filePath === "string" ? task.filePath : undefined,
      },
    ];
  });
}

const VIDEO_SOURCES: VideoSource[] = ["douyin", "bilibili", "m3u8", "other"];

export function restoreDownloadHistoryTasks(
  history: PersistedDownloadHistory | null | undefined,
  t: TFunction,
): DownloadHistoryTask[] {
  const now = Date.now();
  if (Array.isArray(history?.tasks)) {
    return history!.tasks.flatMap((task: unknown, index: number): DownloadHistoryTask[] => {
      if (
        !task ||
        typeof task !== "object" ||
        typeof (task as Record<string, unknown>).id !== "string" ||
        typeof (task as Record<string, unknown>).title !== "string" ||
        !VIDEO_SOURCES.includes((task as Record<string, unknown>).source as VideoSource) ||
        ((task as Record<string, unknown>).type !== "single" && (task as Record<string, unknown>).type !== "batch") ||
        !isBatchDownloadStatus((task as Record<string, unknown>).status)
      ) {
        return [];
      }

      const typedTask = task as Partial<DownloadHistoryTask>;

      if (typedTask.type === "batch") {
        const items = restoreBatchDownloadItems(typedTask.items, t);
        const state = calculateBatchTaskState(items);
        return [
          {
            id: typedTask.id!,
            type: "batch",
            title: typedTask.title!,
            source: typedTask.source!,
            resourceKey:
              typeof typedTask.resourceKey === "string"
                ? typedTask.resourceKey
                : undefined,
            ...state,
            directoryPath:
              typeof typedTask.directoryPath === "string"
                ? typedTask.directoryPath
                : undefined,
            items,
            expanded: Boolean(typedTask.expanded),
            createdAt:
              typeof typedTask.createdAt === "number" ? typedTask.createdAt : now - index,
            updatedAt:
              typeof typedTask.updatedAt === "number" ? typedTask.updatedAt : now - index,
          },
        ];
      }

      const restored = restoreSingleDownloadTask(typedTask, t);
      if (!restored) return [];
      return [
        {
          ...restored,
          type: "single" as const,
          resourceKey:
            typeof typedTask.resourceKey === "string" ? typedTask.resourceKey : undefined,
          createdAt:
            typeof typedTask.createdAt === "number" ? typedTask.createdAt : now - index,
          updatedAt:
            typeof typedTask.updatedAt === "number" ? typedTask.updatedAt : now - index,
        },
      ];
    });
  }

  const tasks: DownloadHistoryTask[] = [];
  const single = restoreSingleDownloadTask(
    (history as Record<string, unknown> | undefined)?.singleDownloadTask,
    t,
  );
  if (single) {
    tasks.push({
      ...single,
      type: "single",
      resourceKey: undefined,
      createdAt: now - 1,
      updatedAt: now - 1,
    });
  }
  const items = restoreBatchDownloadItems(
    (history as Record<string, unknown> | undefined)?.batchDownloadItems,
    t,
  );
  if (items.length > 0) {
    tasks.push({
      id: `batch_${now}`,
      type: "batch",
      title:
        ((history as Record<string, unknown> | undefined)?.batchDownloadTitle as string) ||
        "Bilibili 批量下载",
      source: "bilibili",
      resourceKey: undefined,
      ...calculateBatchTaskState(items),
      items,
      expanded: Boolean(
        (history as Record<string, unknown> | undefined)?.isBatchHistoryExpanded,
      ),
      createdAt: now - 2,
      updatedAt: now - 2,
    });
  }
  return tasks;
}

export function sanitizePathSegment(value: string): string {
  return (
    value
      .replace(/[\\/:*?"<>|]/g, "_")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120) || "Bilibili合集"
  );
}

export function formatBatchItemTitle(index: number, title: string): string {
  const prefix = String(index + 1).padStart(2, "0");
  return `${prefix}.${sanitizePathSegment(title || "Bilibili视频")}`;
}

export function formatDownloadSpeed(speed: number): string {
  if (speed <= 0) return "-";
  return `${(speed / 1024 / 1024).toFixed(1)}MB/s`;
}
