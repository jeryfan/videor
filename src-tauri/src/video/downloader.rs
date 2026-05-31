use super::VideoFormat;
use futures_util::StreamExt;
use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::sync::RwLock;
use tokio_util::sync::CancellationToken;

/// 下载进度事件
#[derive(Debug, Clone, serde::Serialize)]
pub struct DownloadProgress {
    pub task_id: String,
    pub downloaded: u64,
    pub total: Option<u64>,
    pub speed: u64,
    pub status: DownloadStatus,
}

/// 下载状态
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum DownloadStatus {
    Downloading,
    Completed,
    Failed(String),
    Cancelled,
}

struct ActiveTask {
    cancel_token: CancellationToken,
    #[allow(dead_code)]
    title: String,
}

#[derive(Clone)]
pub struct DownloadManager {
    tasks: Arc<RwLock<HashMap<String, ActiveTask>>>,
}

impl DownloadManager {
    pub fn new() -> Self {
        Self {
            tasks: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    pub async fn start_download(
        &self,
        app: AppHandle,
        task_id: String,
        title: String,
        format: VideoFormat,
        save_path: PathBuf,
    ) -> Result<(), String> {
        let sanitized_title = sanitize_filename(&title);
        let final_path = if format.audio_url.is_some() {
            // DASH 格式：先下载到临时文件再合并
            save_path.join(format!("{}.mp4", sanitized_title))
        } else {
            save_path.join(format!("{}.mp4", sanitized_title))
        };

        // 确保目录存在
        tokio::fs::create_dir_all(&save_path)
            .await
            .map_err(|e| format!("创建保存目录失败: {}", e))?;

        let cancel_token = CancellationToken::new();

        {
            let mut tasks = self.tasks.write().await;
            tasks.insert(
                task_id.clone(),
                ActiveTask {
                    cancel_token: cancel_token.clone(),
                    title: title.clone(),
                },
            );
        }

        let tasks_ref = self.tasks.clone();
        let task_id_clone = task_id.clone();

        tokio::spawn(async move {
            let result =
                do_download(&app, &task_id_clone, &format, &final_path, &cancel_token).await;

            // 清理任务
            {
                let mut tasks = tasks_ref.write().await;
                tasks.remove(&task_id_clone);
            }

            match result {
                Ok(()) => {
                    let _ = app.emit(
                        "video-download-progress",
                        DownloadProgress {
                            task_id: task_id_clone,
                            downloaded: 0,
                            total: None,
                            speed: 0,
                            status: DownloadStatus::Completed,
                        },
                    );
                }
                Err(e) => {
                    let _ = app.emit(
                        "video-download-progress",
                        DownloadProgress {
                            task_id: task_id_clone,
                            downloaded: 0,
                            total: None,
                            speed: 0,
                            status: DownloadStatus::Failed(e),
                        },
                    );
                }
            }
        });

        Ok(())
    }

    pub async fn cancel_download(&self, task_id: &str) -> Result<(), String> {
        let tasks = self.tasks.read().await;
        if let Some(task) = tasks.get(task_id) {
            task.cancel_token.cancel();
            Ok(())
        } else {
            Err("下载任务不存在".to_string())
        }
    }
}

async fn do_download(
    app: &AppHandle,
    task_id: &str,
    format: &VideoFormat,
    save_path: &PathBuf,
    cancel_token: &CancellationToken,
) -> Result<(), String> {
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
        .map_err(|e| e.to_string())?;

    if is_m3u8_url(&format.url) {
        download_hls_with_ffmpeg(app, task_id, &format.url, save_path, cancel_token).await?;
    } else if let Some(audio_url) = &format.audio_url {
        // DASH 格式：分别下载视频和音频，然后合并
        let video_tmp = save_path.with_extension("video.tmp");
        let audio_tmp = save_path.with_extension("audio.tmp");

        download_stream(app, task_id, &client, &format.url, &video_tmp, cancel_token).await?;
        download_stream(app, task_id, &client, audio_url, &audio_tmp, cancel_token).await?;

        // 尝试用 ffmpeg 合并
        let mux_result = tokio::process::Command::new("ffmpeg")
            .args([
                "-y",
                "-i",
                video_tmp.to_str().unwrap_or_default(),
                "-i",
                audio_tmp.to_str().unwrap_or_default(),
                "-c",
                "copy",
                "-movflags",
                "+faststart",
                save_path.to_str().unwrap_or_default(),
            ])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .await;

        let _ = tokio::fs::remove_file(&video_tmp).await;
        let _ = tokio::fs::remove_file(&audio_tmp).await;

        match mux_result {
            Ok(status) if status.success() => {}
            _ => {
                // ffmpeg 不可用或失败：只保留视频流
                download_stream(app, task_id, &client, &format.url, save_path, cancel_token)
                    .await?;
            }
        }
    } else {
        // 单流格式：直接下载
        download_stream(app, task_id, &client, &format.url, save_path, cancel_token).await?;
    }

    Ok(())
}

async fn download_stream(
    app: &AppHandle,
    task_id: &str,
    _client: &reqwest::Client,
    url: &str,
    save_path: &PathBuf,
    cancel_token: &CancellationToken,
) -> Result<(), String> {
    let is_bilibili = url.contains("bilibili.com") || url.contains("bilivideo.");

    let (final_url, referer) = if is_bilibili {
        (url.to_string(), Some("https://www.bilibili.com/"))
    } else {
        // 抖音等非B站URL：手动解析302获取CDN直链
        let resolved = resolve_cdn_url(url)
            .await
            .unwrap_or_else(|_| url.to_string());
        (resolved, None)
    };

    let dl_client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
        .map_err(|e| e.to_string())?;

    let mut req = dl_client.get(&final_url);
    if let Some(r) = referer {
        req = req.header("Referer", r);
    }
    let resp = req.send().await.map_err(|e| e.to_string())?;

    let total = resp.content_length();
    let mut stream = resp.bytes_stream();

    let mut file = tokio::fs::File::create(save_path)
        .await
        .map_err(|e| format!("创建文件失败: {}", e))?;

    let mut downloaded: u64 = 0;
    let mut last_report = tokio::time::Instant::now();
    let mut last_downloaded: u64 = 0;
    let report_interval = tokio::time::Duration::from_millis(200);

    loop {
        tokio::select! {
            _ = cancel_token.cancelled() => {
                drop(file);
                let _ = tokio::fs::remove_file(save_path).await;
                let _ = app.emit(
                    "video-download-progress",
                    DownloadProgress {
                        task_id: task_id.to_string(),
                        downloaded,
                        total,
                        speed: 0,
                        status: DownloadStatus::Cancelled,
                    },
                );
                return Err("下载已取消".to_string());
            }
            chunk = stream.next() => {
                match chunk {
                    Some(Ok(bytes)) => {
                        file.write_all(&bytes)
                            .await
                            .map_err(|e| format!("写入文件失败: {}", e))?;

                        downloaded += bytes.len() as u64;

                        let now = tokio::time::Instant::now();
                        if now.duration_since(last_report) >= report_interval {
                            let elapsed = now.duration_since(last_report).as_secs_f64();
                            let speed = if elapsed > 0.0 {
                                ((downloaded - last_downloaded) as f64 / elapsed) as u64
                            } else {
                                0
                            };

                            let _ = app.emit(
                                "video-download-progress",
                                DownloadProgress {
                                    task_id: task_id.to_string(),
                                    downloaded,
                                    total,
                                    speed,
                                    status: DownloadStatus::Downloading,
                                },
                            );

                            last_report = now;
                            last_downloaded = downloaded;
                        }
                    }
                    Some(Err(e)) => {
                        drop(file);
                        let _ = tokio::fs::remove_file(save_path).await;
                        return Err(format!("下载出错: {}", e));
                    }
                    None => {
                        file.flush()
                            .await
                            .map_err(|e| format!("刷新文件失败: {}", e))?;
                        break;
                    }
                }
            }
        }
    }

    Ok(())
}

async fn download_hls_with_ffmpeg(
    app: &AppHandle,
    task_id: &str,
    url: &str,
    save_path: &PathBuf,
    cancel_token: &CancellationToken,
) -> Result<(), String> {
    let total_duration_us = probe_hls_duration_us(url).await;
    let mut child = tokio::process::Command::new("ffmpeg")
        .args([
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            "-user_agent",
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
            "-protocol_whitelist",
            "file,http,https,tcp,tls,crypto",
            "-i",
            url,
            "-c",
            "copy",
            "-bsf:a",
            "aac_adtstoasc",
            "-movflags",
            "+faststart",
            "-progress",
            "pipe:1",
            "-nostats",
            save_path.to_str().unwrap_or_default(),
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("启动 ffmpeg 下载 M3U8 失败: {e}"))?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "无法读取 ffmpeg 进度输出".to_string())?;
    let mut lines = BufReader::new(stdout).lines();
    let mut last_out_us = 0_u64;
    let mut last_report = tokio::time::Instant::now();

    loop {
        tokio::select! {
            _ = cancel_token.cancelled() => {
                let _ = child.kill().await;
                let _ = tokio::fs::remove_file(save_path).await;
                let _ = app.emit(
                    "video-download-progress",
                    DownloadProgress {
                        task_id: task_id.to_string(),
                        downloaded: last_out_us,
                        total: total_duration_us,
                        speed: 0,
                        status: DownloadStatus::Cancelled,
                    },
                );
                return Err("下载已取消".to_string());
            }
            line = lines.next_line() => {
                match line {
                    Ok(Some(line)) => {
                        if let Some(value) = line.strip_prefix("out_time_ms=") {
                            if let Ok(out_us) = value.parse::<u64>() {
                                last_out_us = out_us;
                                let now = tokio::time::Instant::now();
                                if now.duration_since(last_report) >= tokio::time::Duration::from_millis(500) {
                                    let _ = app.emit(
                                        "video-download-progress",
                                        DownloadProgress {
                                            task_id: task_id.to_string(),
                                            downloaded: out_us,
                                            total: total_duration_us,
                                            speed: 0,
                                            status: DownloadStatus::Downloading,
                                        },
                                    );
                                    last_report = now;
                                }
                            }
                        }
                    }
                    Ok(None) => break,
                    Err(error) => return Err(format!("读取 ffmpeg 进度失败: {error}")),
                }
            }
        }
    }

    let status = child
        .wait()
        .await
        .map_err(|e| format!("等待 ffmpeg 下载完成失败: {e}"))?;

    if status.success() {
        Ok(())
    } else {
        let _ = tokio::fs::remove_file(save_path).await;
        Err("ffmpeg 下载 M3U8 失败".to_string())
    }
}

async fn probe_hls_duration_us(url: &str) -> Option<u64> {
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
        .ok()?;
    let playlist = client.get(url).send().await.ok()?.text().await.ok()?;
    let seconds = playlist
        .lines()
        .filter_map(|line| line.trim().strip_prefix("#EXTINF:"))
        .filter_map(|value| value.split(',').next())
        .filter_map(|value| value.parse::<f64>().ok())
        .sum::<f64>();

    if seconds > 0.0 {
        Some((seconds * 1_000_000.0) as u64)
    } else {
        None
    }
}

fn is_m3u8_url(url: &str) -> bool {
    url.contains(".m3u8")
}

/// 预解析URL的302重定向，获取最终CDN直链
async fn resolve_cdn_url(url: &str) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| e.to_string())?;

    let resp = client
        .get(url)
        .header("Referer", "https://www.douyin.com/")
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if resp.status().is_redirection() {
        if let Some(location) = resp.headers().get("location") {
            let loc = location.to_str().map_err(|e| e.to_string())?;
            return Ok(loc.to_string());
        }
    }

    Ok(url.to_string())
}

fn sanitize_filename(name: &str) -> String {
    name.chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            _ => c,
        })
        .collect::<String>()
        .trim()
        .to_string()
}
