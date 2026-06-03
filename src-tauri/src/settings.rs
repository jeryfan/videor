use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::PathBuf;
use std::sync::{OnceLock, RwLock};

use crate::error::AppError;

/// 应用设置结构
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    #[serde(default = "default_show_in_tray")]
    pub show_in_tray: bool,
    #[serde(default = "default_minimize_to_tray_on_close")]
    pub minimize_to_tray_on_close: bool,
    #[serde(default)]
    pub use_app_window_controls: bool,
    #[serde(default)]
    pub launch_on_startup: bool,
    #[serde(default)]
    pub silent_startup: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub language: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub download_directory: Option<String>,
    #[serde(default = "default_m3u8_concurrency")]
    pub m3u8_concurrency: u8,
    #[serde(default = "default_download_concurrency")]
    pub download_concurrency: u8,
    #[serde(default)]
    pub download_speed_limit: u32,
    #[serde(default)]
    pub auto_open_after_download: Option<String>,
}

fn default_show_in_tray() -> bool {
    true
}

fn default_minimize_to_tray_on_close() -> bool {
    true
}

fn default_m3u8_concurrency() -> u8 {
    8
}

fn default_download_concurrency() -> u8 {
    3
}

fn default_auto_open() -> Option<String> {
    Some("none".to_string())
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            show_in_tray: true,
            minimize_to_tray_on_close: true,
            use_app_window_controls: false,
            launch_on_startup: false,
            silent_startup: false,
            language: None,
            download_directory: dirs::download_dir().map(|p| p.to_string_lossy().to_string()),
            m3u8_concurrency: default_m3u8_concurrency(),
            download_concurrency: default_download_concurrency(),
            download_speed_limit: 0,
            auto_open_after_download: default_auto_open(),
        }
    }
}

impl AppSettings {
    fn settings_path() -> Option<PathBuf> {
        Some(
            crate::config::get_home_dir()
                .join(".videor")
                .join("settings.json"),
        )
    }

    fn normalize_paths(&mut self) {
        self.language = self
            .language
            .as_ref()
            .map(|s| s.trim())
            .filter(|s| matches!(*s, "en" | "zh"))
            .map(|s| s.to_string());
        self.download_directory = self
            .download_directory
            .as_ref()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());
        self.m3u8_concurrency = self.m3u8_concurrency.clamp(1, 16);
        self.download_concurrency = self.download_concurrency.clamp(1, 16);
        self.auto_open_after_download = self
            .auto_open_after_download
            .as_ref()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .or_else(default_auto_open);
    }

    fn load_from_file() -> Self {
        let Some(path) = Self::settings_path() else {
            return Self::default();
        };
        if let Ok(content) = fs::read_to_string(&path) {
            match serde_json::from_str::<AppSettings>(&content) {
                Ok(mut settings) => {
                    settings.normalize_paths();
                    settings
                }
                Err(err) => {
                    log::warn!(
                        "解析设置文件失败，将使用默认设置。路径: {}, 错误: {}",
                        path.display(),
                        err
                    );
                    Self::default()
                }
            }
        } else {
            Self::default()
        }
    }
}

fn save_settings_file(settings: &AppSettings) -> Result<(), AppError> {
    let mut normalized = settings.clone();
    normalized.normalize_paths();
    let Some(path) = AppSettings::settings_path() else {
        return Err(AppError::Config("无法获取用户主目录".to_string()));
    };

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| AppError::io(parent, e))?;
    }

    let json = serde_json::to_string_pretty(&normalized)
        .map_err(|e| AppError::JsonSerialize { source: e })?;
    #[cfg(unix)]
    {
        use std::fs::OpenOptions;
        use std::os::unix::fs::OpenOptionsExt;

        let mut file = OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .mode(0o600)
            .open(&path)
            .map_err(|e| AppError::io(&path, e))?;
        file.write_all(json.as_bytes())
            .map_err(|e| AppError::io(&path, e))?;
    }

    #[cfg(not(unix))]
    {
        fs::write(&path, json).map_err(|e| AppError::io(&path, e))?;
    }

    Ok(())
}

fn settings_store() -> &'static RwLock<AppSettings> {
    static STORE: OnceLock<RwLock<AppSettings>> = OnceLock::new();
    STORE.get_or_init(|| RwLock::new(AppSettings::load_from_file()))
}

/// 获取当前设置（从内存缓存读取）
pub fn get_settings() -> AppSettings {
    settings_store()
        .read()
        .unwrap_or_else(|e| {
            log::warn!("设置锁已毒化，使用恢复值: {e}");
            e.into_inner()
        })
        .clone()
}

/// 获取设置（供前端使用）
pub fn get_settings_for_frontend() -> AppSettings {
    get_settings()
}

/// 更新设置
pub fn update_settings(new_settings: AppSettings) -> Result<(), AppError> {
    save_settings_file(&new_settings)?;

    let mut guard = settings_store().write().unwrap_or_else(|e| {
        log::warn!("设置锁已毒化，使用恢复值: {e}");
        e.into_inner()
    });
    *guard = new_settings;
    Ok(())
}
