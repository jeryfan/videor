// 应用设置类型（用于设置对话框与 Tauri API）
// 与后端 src-tauri/src/settings.rs::AppSettings 一一对应
export interface Settings {
  showInTray?: boolean;
  minimizeToTrayOnClose?: boolean;
  useAppWindowControls?: boolean;
  launchOnStartup?: boolean;
  silentStartup?: boolean;
  language?: "en" | "zh";
  downloadDirectory?: string;
  downloadConcurrency?: number;
  downloadSpeedLimit?: number;
  autoOpenAfterDownload?: "none" | "open" | "reveal";
  autoClassifyDownloads?: boolean;
  m3u8Concurrency?: number;
  batchParseIntervalMs?: number;
}
