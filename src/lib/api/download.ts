import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { VideoFormat } from "./videoParser";
import type {
  DownloadHistoryTask,
} from "@/types/download";

export interface DownloadProgress {
  task_id: string;
  downloaded: number;
  total: number | null;
  speed: number;
  status: DownloadStatus;
  file_path?: string | null;
  is_batch?: boolean;
  error?: string | null;
}

export type DownloadStatus =
  | "queued"
  | "downloading"
  | "remuxing"
  | "completed"
  | "failed"
  | "cancelled";

export interface DownloadHistoryState {
  tasks: DownloadHistoryTask[];
  updated_at: number;
}

/**
 * 开始下载视频
 * @param title 视频标题（用于文件名）
 * @param format 选择的视频格式
 * @param saveDir 保存目录路径
 * @returns 任务ID
 */
export async function startVideoDownload(
  title: string,
  format: VideoFormat,
  saveDir: string,
  isBatch: boolean = false,
): Promise<string> {
  return await invoke<string>("start_video_download", {
    title,
    format,
    saveDir,
    isBatch,
  });
}

/**
 * 取消下载任务
 * @param taskId 任务ID
 */
export async function cancelVideoDownload(taskId: string): Promise<void> {
  return await invoke("cancel_video_download", { taskId });
}

export async function getDownloadHistory(): Promise<DownloadHistoryState> {
  return await invoke<DownloadHistoryState>("get_download_history");
}

export async function saveDownloadHistory(
  history: DownloadHistoryState,
): Promise<void> {
  return await invoke("save_download_history", { history });
}

export async function clearDownloadHistory(): Promise<void> {
  return await invoke("clear_download_history");
}

export async function deleteDownloadTask(taskId: string): Promise<void> {
  return await invoke("delete_download_task", { taskId });
}

export async function openDownloadFile(filePath: string): Promise<void> {
  return await invoke("open_download_file", { filePath });
}

export async function revealDownloadFile(filePath: string): Promise<void> {
  return await invoke("reveal_download_file", { filePath });
}

export async function openDirectory(dirPath: string): Promise<void> {
  return await invoke("open_directory", { dirPath });
}

/**
 * 监听下载进度事件
 * @param callback 进度回调
 * @returns 取消监听的函数
 */
export async function listenDownloadProgress(
  callback: (progress: DownloadProgress) => void,
): Promise<UnlistenFn> {
  return listen<DownloadProgress>("video-download-progress", (event) => {
    callback(event.payload);
  });
}
