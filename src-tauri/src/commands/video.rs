use crate::video::bilibili;
use crate::video::downloader::DownloadManager;
use crate::video::m3u8;
use crate::video::{parse_video_url, parse_video_url_with_curl, VideoFormat, VideoInfo};
use crate::AppState;
use std::path::PathBuf;
use tauri::AppHandle;
use tauri::Manager;
use tauri::State;
use tauri_plugin_opener::OpenerExt;

use crate::database::DownloadHistoryState;

#[derive(Debug, serde::Serialize)]
pub struct FfmpegStatus {
    pub installed: bool,
    pub path: Option<String>,
    pub version: Option<String>,
}

/// 解析视频链接（支持抖音、B站、直链）
///
/// 自动从分享文本中提取 URL，分发给对应平台的解析器
#[tauri::command]
pub async fn parse_video(input: String) -> Result<VideoInfo, String> {
    log::info!(
        "[VideoCommand] Parsing: {}",
        crate::redact_url_for_log(&input)
    );
    parse_video_url(&input).await
}

#[tauri::command]
pub async fn parse_video_with_curl(input: String, raw_curl: String) -> Result<VideoInfo, String> {
    log::info!(
        "[VideoCommand] Parsing with cURL: {}",
        crate::redact_url_for_log(&input)
    );
    parse_video_url_with_curl(&input, &raw_curl).await
}

#[tauri::command]
pub async fn parse_m3u8(input: String, raw_curl: Option<String>) -> Result<VideoInfo, String> {
    log::info!(
        "[VideoCommand] Parsing M3U8: {}",
        crate::redact_url_for_log(&input)
    );
    let client = crate::video::create_http_client();
    let headers = raw_curl
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .map(crate::video::parse_curl_headers)
        .transpose()?
        .filter(|headers| !headers.is_empty());
    m3u8::parse_m3u8_input(&input, &client, headers.as_ref()).await
}

#[tauri::command]
pub async fn bilibili_login_qr_generate() -> Result<bilibili::BilibiliLoginQr, String> {
    let client = crate::video::create_http_client();
    bilibili::generate_login_qr(&client).await
}

#[tauri::command]
pub async fn bilibili_login_qr_poll(
    qrcode_key: String,
) -> Result<bilibili::BilibiliLoginPoll, String> {
    let client = crate::video::create_http_client();
    bilibili::poll_login_qr(&client, &qrcode_key).await
}

#[tauri::command]
pub async fn bilibili_login_status() -> Result<bilibili::BilibiliLoginStatus, String> {
    let client = crate::video::create_http_client();
    bilibili::login_status(&client).await
}

#[tauri::command]
pub async fn bilibili_logout() -> Result<(), String> {
    let client = crate::video::create_http_client();
    bilibili::logout(&client).await
}

#[tauri::command]
pub async fn get_ffmpeg_status() -> Result<FfmpegStatus, String> {
    let output = tokio::process::Command::new("ffmpeg")
        .arg("-version")
        .output()
        .await;

    let Ok(output) = output else {
        return Ok(FfmpegStatus {
            installed: false,
            path: None,
            version: None,
        });
    };

    if !output.status.success() {
        return Ok(FfmpegStatus {
            installed: false,
            path: None,
            version: None,
        });
    }

    let version = String::from_utf8_lossy(&output.stdout)
        .lines()
        .next()
        .map(str::to_string);
    let path = tokio::process::Command::new("which")
        .arg("ffmpeg")
        .output()
        .await
        .ok()
        .and_then(|output| {
            if output.status.success() {
                Some(String::from_utf8_lossy(&output.stdout).trim().to_string())
            } else {
                None
            }
        })
        .filter(|path| !path.is_empty());

    Ok(FfmpegStatus {
        installed: true,
        path,
        version,
    })
}

#[tauri::command]
pub async fn open_ffmpeg_install_page(app: AppHandle) -> Result<(), String> {
    app.opener()
        .open_url("https://ffmpeg.org/download.html", None::<String>)
        .map_err(|e| format!("打开 ffmpeg 安装页面失败: {e}"))
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
    is_batch: bool,
) -> Result<String, String> {
    let task_id = format!(
        "dl_{}",
        uuid::Uuid::new_v4()
            .to_string()
            .replace("-", "")
            .get(0..16)
            .unwrap_or("")
    );
    let save_path = PathBuf::from(save_dir);

    log::info!(
        "[VideoCommand] Starting download: task_id={}, title={}, save_dir={:?}, is_batch={}, url={}",
        task_id,
        title,
        save_path,
        is_batch,
        crate::redact_url_for_log(&format.url)
    );

    let app_clone = app.clone();
    let manager = app.state::<DownloadManager>();
    manager
        .start_download(
            app_clone,
            task_id.clone(),
            title,
            format,
            save_path,
            is_batch,
        )
        .await?;

    Ok(task_id)
}

/// 取消下载任务
#[tauri::command]
pub async fn cancel_video_download(app: AppHandle, task_id: String) -> Result<(), String> {
    log::info!("[VideoCommand] Cancelling download: task_id={}", task_id);

    let manager = app.state::<DownloadManager>();
    manager.cancel_download(&task_id).await
}

#[tauri::command]
pub async fn get_download_history(
    state: State<'_, AppState>,
) -> Result<DownloadHistoryState, String> {
    state
        .db
        .get_download_history()
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn save_download_history(
    state: State<'_, AppState>,
    history: DownloadHistoryState,
) -> Result<(), String> {
    state
        .db
        .save_download_history(&history)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn clear_download_history(state: State<'_, AppState>) -> Result<(), String> {
    state
        .db
        .clear_download_history()
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_download_task(
    state: State<'_, AppState>,
    task_id: String,
) -> Result<(), String> {
    log::info!("[VideoCommand] Deleting download task: task_id={}", task_id);
    state
        .db
        .delete_download_task(&task_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn open_download_file(app: AppHandle, file_path: String) -> Result<(), String> {
    let path = PathBuf::from(file_path);
    if !path.is_file() {
        return Err("文件不存在".to_string());
    }
    let path = path
        .to_str()
        .ok_or_else(|| "文件路径包含无效字符".to_string())?
        .to_string();
    app.opener()
        .open_path(path, None::<String>)
        .map_err(|e| format!("打开文件失败: {e}"))
}

#[tauri::command]
pub async fn reveal_download_file(app: AppHandle, file_path: String) -> Result<(), String> {
    let path = PathBuf::from(file_path);
    if !path.exists() {
        return Err("文件不存在".to_string());
    }
    app.opener()
        .reveal_item_in_dir(path)
        .map_err(|e| format!("在文件夹中显示失败: {e}"))
}

#[tauri::command]
pub async fn open_directory(app: AppHandle, dir_path: String) -> Result<(), String> {
    let path = PathBuf::from(dir_path);
    if !path.is_dir() {
        return Err("目录不存在".to_string());
    }
    let path = path
        .to_str()
        .ok_or_else(|| "目录路径包含无效字符".to_string())?
        .to_string();
    app.opener()
        .open_path(path, None::<String>)
        .map_err(|e| format!("打开目录失败: {e}"))
}

/// 删除下载任务的 .part 临时文件（用于清理未完成的下载碎片）
#[tauri::command]
pub async fn remove_download_part_file(
    dir: String,
    title: String,
) -> Result<(), String> {
    let sanitized = crate::video::downloader::sanitize_filename(&title);
    let part = PathBuf::from(&dir).join(format!("{}.mp4.part", sanitized));
    if part.exists() {
        tokio::fs::remove_file(&part)
            .await
            .map_err(|e| format!("删除临时文件失败: {e}"))?;
    }
    Ok(())
}
