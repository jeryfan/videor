import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { VideoFormat } from "./videoParser";

export interface DownloadProgress {
  task_id: string;
  downloaded: number;
  total: number | null;
  speed: number;
  status: "downloading" | "completed" | "failed" | "cancelled";
}

export type DownloadStatus = DownloadProgress["status"];

export interface DownloadTask {
  taskId: string;
  title: string;
  status: DownloadStatus;
  progress: number;
  speed: number;
  total: number | null;
  error?: string;
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
  saveDir: string
): Promise<string> {
  return await invoke<string>("start_video_download", {
    title,
    format,
    saveDir,
  });
}

/**
 * 取消下载任务
 * @param taskId 任务ID
 */
export async function cancelVideoDownload(taskId: string): Promise<void> {
  return await invoke("cancel_video_download", { taskId });
}

/**
 * 监听下载进度事件
 * @param callback 进度回调
 * @returns 取消监听的函数
 */
export async function listenDownloadProgress(
  callback: (progress: DownloadProgress) => void
): Promise<UnlistenFn> {
  return listen<DownloadProgress>("video-download-progress", (event) => {
    callback(event.payload);
  });
}
