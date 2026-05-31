// 应用设置类型（用于设置对话框与 Tauri API）
// 存储在本地 ~/.videor/settings.json，不随数据库同步
export interface Settings {
  // ===== 设备级 UI 设置 =====
  // 是否在系统托盘（macOS 菜单栏）显示图标
  showInTray?: boolean;
  // 点击关闭按钮时是否最小化到托盘而不是关闭应用
  minimizeToTrayOnClose?: boolean;
  // 是否启用应用级窗口控制按钮（最小化/最大化/关闭）
  useAppWindowControls?: boolean;
  // 是否开机自启
  launchOnStartup?: boolean;
  // 静默启动（程序启动时不显示主窗口）
  silentStartup?: boolean;
  // 首选语言（可选，默认中文）
  language?: "en" | "zh";
  // 主题
  theme?: "light" | "dark" | "system";
  // 窗口行为
  windowBehavior?: "normal" | "minimize" | "tray";
  // 全局代理
  globalProxy?: string;
  // 默认下载目录
  downloadDirectory?: string;
  // M3U8 分片并发下载数
  m3u8Concurrency?: number;

  // Backend may send additional fields; accept them silently
  [key: string]: any;
}
