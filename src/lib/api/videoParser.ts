import { invoke } from "@tauri-apps/api/core";

export interface VideoFormat {
  quality: string;
  url: string;
  preview_url?: string;
  audio_url?: string;
  size?: number;
}

export type VideoKind =
  | "video"
  | "multipart"
  | "collection"
  | "charging_collection";

export interface VideoItem {
  id: string;
  title: string;
  url: string;
  bvid?: string;
  cid?: number;
  page?: number;
  duration?: number;
  cover_url?: string;
}

export interface VideoInfo {
  title: string;
  cover_url?: string;
  duration?: number;
  platform: string;
  formats: VideoFormat[];
  kind?: VideoKind;
  items?: VideoItem[];
  login_required?: boolean;
  message?: string;
  uploader?: string;
}

/**
 * 解析视频链接（支持抖音、B站、直链）
 * @param input 视频链接或分享文本
 */
export async function parseVideo(input: string): Promise<VideoInfo> {
  return await invoke<VideoInfo>("parse_video", { input });
}

export interface BilibiliLoginQr {
  url: string;
  qrcode_key: string;
  svg: string;
}

export interface BilibiliLoginPoll {
  status: "waiting" | "scanned" | "confirmed" | "expired" | "error";
  message: string;
  logged_in: boolean;
}

export interface BilibiliLoginStatus {
  logged_in: boolean;
  username?: string;
  avatar_url?: string;
  message?: string;
}

export async function generateBilibiliLoginQr(): Promise<BilibiliLoginQr> {
  return await invoke<BilibiliLoginQr>("bilibili_login_qr_generate");
}

export async function pollBilibiliLoginQr(
  qrcodeKey: string
): Promise<BilibiliLoginPoll> {
  return await invoke<BilibiliLoginPoll>("bilibili_login_qr_poll", {
    qrcodeKey,
  });
}

export async function getBilibiliLoginStatus(): Promise<BilibiliLoginStatus> {
  return await invoke<BilibiliLoginStatus>("bilibili_login_status");
}

export async function logoutBilibili(): Promise<void> {
  return await invoke("bilibili_logout");
}
