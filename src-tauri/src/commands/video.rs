use crate::video::downloader::DownloadManager;
use crate::video::{parse_video_url, VideoFormat, VideoInfo};
use std::path::PathBuf;
use tauri::AppHandle;
use tauri::Manager;

/// 解析视频链接（支持抖音、B站、直链）
///
/// 自动从分享文本中提取 URL，分发给对应平台的解析器
#[tauri::command]
pub async fn parse_video(input: String) -> Result<VideoInfo, String> {
    log::info!("[VideoCommand] Parsing: {}", input.chars().take(100).collect::<String>());
    parse_video_url(&input).await
}

/// 开始下载视频
///
/// 返回任务ID，前端通过监听 `video-download-progress` 事件获取进度
#[tauri::command]
pub async fn start_video_download(
    app: AppHandle,
    title: String,
    format: VideoFormat,
    save_dir: String,
) -> Result<String, String> {
    let task_id = format!("dl_{}", uuid::Uuid::new_v4().to_string().replace("-", "").get(0..16).unwrap_or(""));
    let save_path = PathBuf::from(save_dir);

    log::info!("[VideoCommand] Starting download: task_id={}, title={}, save_dir={:?}", task_id, title, save_path);

    let app_clone = app.clone();
    let manager = app.state::<DownloadManager>();
    manager
        .start_download(app_clone, task_id.clone(), title, format, save_path)
        .await?;

    Ok(task_id)
}

/// 取消下载任务
#[tauri::command]
pub async fn cancel_video_download(
    app: AppHandle,
    task_id: String,
) -> Result<(), String> {
    log::info!("[VideoCommand] Cancelling download: task_id={}", task_id);

    let manager = app.state::<DownloadManager>();
    manager.cancel_download(&task_id).await
}
