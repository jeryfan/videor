import type { BatchDownloadStatus } from "@/types/download";

export function downloadStatusBadgeClass(status: BatchDownloadStatus): string {
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
    default:
      return "bg-gray-50 text-gray-600 dark:bg-gray-900/40 dark:text-gray-400 border-gray-200 dark:border-gray-800";
  }
}
