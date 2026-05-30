import { invoke } from "@tauri-apps/api/core";

export interface VideoFormat {
  quality: string;
  url: string;
  audio_url?: string;
  size?: number;
}

export interface VideoInfo {
  title: string;
  cover_url?: string;
  duration?: number;
  platform: string;
  formats: VideoFormat[];
}

/**
 * 解析视频链接（支持抖音、B站、直链）
 * @param input 视频链接或分享文本
 */
export async function parseVideo(input: string): Promise<VideoInfo> {
  return await invoke<VideoInfo>("parse_video", { input });
}
