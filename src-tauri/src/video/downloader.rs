use super::{hash_map_to_header_map, VideoFormat};
use aes::cipher::{block_padding::Pkcs7, BlockDecryptMut, KeyIvInit};
use futures_util::{stream, StreamExt};
use once_cell::sync::Lazy;
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter};
use tokio::io::AsyncWriteExt;
use tokio::sync::RwLock;
use tokio_util::sync::CancellationToken;

static BATCH_TASKS: Lazy<Mutex<HashSet<String>>> = Lazy::new(|| Mutex::new(HashSet::new()));

fn mark_task_as_batch(task_id: &str) {
    if let Ok(mut tasks) = BATCH_TASKS.lock() {
        tasks.insert(task_id.to_string());
    }
}

fn is_batch_task(task_id: &str) -> bool {
    BATCH_TASKS.lock().map(|tasks| tasks.contains(task_id)).unwrap_or(false)
}

fn remove_batch_task(task_id: &str) {
    if let Ok(mut tasks) = BATCH_TASKS.lock() {
        tasks.remove(task_id);
    }
}

/// 下载进度事件
#[derive(Debug, Clone, serde::Serialize)]
pub struct DownloadProgress {
    pub task_id: String,
    pub downloaded: u64,
    pub total: Option<u64>,
    pub speed: u64,
    pub status: DownloadStatus,
    pub file_path: Option<String>,
    #[serde(default)]
    pub is_batch: Option<bool>,
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
        is_batch: bool,
    ) -> Result<(), String> {
        if is_batch {
            mark_task_as_batch(&task_id);
        }
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

            let is_batch_flag = is_batch_task(&task_id_clone);
            remove_batch_task(&task_id_clone);

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
                            file_path: final_path.to_str().map(str::to_string),
                            is_batch: Some(is_batch_flag),
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
                            file_path: None,
                            is_batch: Some(is_batch_flag),
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
        let concurrency = crate::settings::get_settings()
            .m3u8_concurrency
            .clamp(1, 16) as usize;
        download_hls_concurrently(app, task_id, format, save_path, cancel_token, concurrency)
            .await?;
    } else if let Some(audio_url) = &format.audio_url {
        // DASH 格式：分别下载视频和音频，然后合并
        let video_tmp = save_path.with_extension("video.tmp");
        let audio_tmp = save_path.with_extension("audio.tmp");

        download_stream(
            app,
            task_id,
            &client,
            format,
            &format.url,
            &video_tmp,
            cancel_token,
        )
        .await?;
        download_stream(
            app,
            task_id,
            &client,
            format,
            audio_url,
            &audio_tmp,
            cancel_token,
        )
        .await?;

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
                download_stream(
                    app,
                    task_id,
                    &client,
                    format,
                    &format.url,
                    save_path,
                    cancel_token,
                )
                .await?;
            }
        }
    } else {
        // 单流格式：直接下载
        download_stream(
            app,
            task_id,
            &client,
            format,
            &format.url,
            save_path,
            cancel_token,
        )
        .await?;
    }

    Ok(())
}

#[derive(Debug, Clone)]
struct HlsSegment {
    index: usize,
    url: String,
    key: Option<HlsKey>,
}

#[derive(Debug, Clone, Eq, PartialEq, Hash)]
struct HlsKey {
    uri: String,
    iv: [u8; 16],
}

#[derive(Debug, Clone)]
struct HlsPlaylist {
    segments: Vec<HlsSegment>,
    init_map_url: Option<String>,
}

async fn download_hls_concurrently(
    app: &AppHandle,
    task_id: &str,
    format: &VideoFormat,
    save_path: &PathBuf,
    cancel_token: &CancellationToken,
    concurrency: usize,
) -> Result<(), String> {
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
        .map_err(|e| e.to_string())?;
    let playlist = resolve_hls_media_playlist(&client, &format.url, &format.headers).await?;
    let parsed = parse_hls_segments(&playlist.url, &playlist.text)?;
    let segments = parsed.segments;
    if segments.is_empty() {
        return Err("M3U8 播放列表没有可下载分片".to_string());
    }
    let key_map = Arc::new(fetch_hls_keys(&client, &segments, &format.headers).await?);

    let temp_dir = save_path.with_extension(format!(
        "hls-{}",
        uuid::Uuid::new_v4().to_string().replace('-', "")
    ));
    tokio::fs::create_dir_all(&temp_dir)
        .await
        .map_err(|e| format!("创建 M3U8 临时目录失败: {e}"))?;

    let total_segments = segments.len() as u64;
    let completed = Arc::new(tokio::sync::Mutex::new((0_u64, 0_u64)));
    let last_report = Arc::new(tokio::sync::Mutex::new(tokio::time::Instant::now()));
    let started_at = tokio::time::Instant::now();
    let app_clone = app.clone();
    let task_id_string = task_id.to_string();

    let results = stream::iter(segments.iter().cloned())
        .map(|segment| {
            let client = client.clone();
            let headers = format.headers.clone();
            let key_map = key_map.clone();
            let temp_dir = temp_dir.clone();
            let cancel_token = cancel_token.clone();
            let completed = completed.clone();
            let last_report = last_report.clone();
            let app = app_clone.clone();
            let task_id = task_id_string.clone();
            async move {
                let bytes =
                    download_hls_segment(&client, &segment.url, &headers, &cancel_token).await?;
                let bytes = if let Some(key) = &segment.key {
                    decrypt_hls_segment(bytes, key, &key_map)?
                } else {
                    bytes
                };
                let path = temp_dir.join(format!("{:08}.ts", segment.index));
                tokio::fs::write(&path, &bytes)
                    .await
                    .map_err(|e| format!("写入 M3U8 分片失败: {e}"))?;

                let mut state = completed.lock().await;
                state.0 += 1;
                state.1 += bytes.len() as u64;
                let downloaded_segments = state.0;
                let downloaded_bytes = state.1;
                drop(state);

                let mut report_at = last_report.lock().await;
                let now = tokio::time::Instant::now();
                if now.duration_since(*report_at) >= tokio::time::Duration::from_millis(300)
                    || downloaded_segments == total_segments
                {
                    let elapsed = now.duration_since(started_at).as_secs_f64();
                    let speed = if elapsed > 0.0 {
                        (downloaded_bytes as f64 / elapsed) as u64
                    } else {
                        0
                    };
                    let _ = app.emit(
                        "video-download-progress",
                        DownloadProgress {
                            task_id,
                            downloaded: downloaded_segments,
                            total: Some(total_segments),
                            speed,
                            status: DownloadStatus::Downloading,
                            file_path: None,
                            is_batch: None,
                        },
                    );
                    *report_at = now;
                }

                Ok::<(), String>(())
            }
        })
        .buffer_unordered(concurrency.max(1))
        .collect::<Vec<_>>()
        .await;

    for result in results {
        if let Err(error) = result {
            let _ = tokio::fs::remove_dir_all(&temp_dir).await;
            return Err(error);
        }
    }

    if cancel_token.is_cancelled() {
        let _ = tokio::fs::remove_dir_all(&temp_dir).await;
        let is_batch = is_batch_task(task_id);
        let _ = app.emit(
            "video-download-progress",
            DownloadProgress {
                task_id: task_id.to_string(),
                downloaded: 0,
                total: Some(total_segments),
                speed: 0,
                status: DownloadStatus::Cancelled,
                file_path: None,
                is_batch: Some(is_batch),
            },
        );
        return Err("下载已取消".to_string());
    }

    let joined_ts = temp_dir.join("joined.ts");
    concat_hls_segments(
        &client,
        &format.headers,
        parsed.init_map_url.as_deref(),
        &temp_dir,
        total_segments as usize,
        &joined_ts,
    )
    .await?;
    remux_ts_to_mp4(&joined_ts, save_path).await?;
    let _ = tokio::fs::remove_dir_all(&temp_dir).await;
    Ok(())
}

struct ResolvedPlaylist {
    url: String,
    text: String,
}

async fn resolve_hls_media_playlist(
    client: &reqwest::Client,
    url: &str,
    headers: &HashMap<String, String>,
) -> Result<ResolvedPlaylist, String> {
    let text = request_text(client, url, headers).await?;
    if !text.contains("#EXT-X-STREAM-INF") {
        return Ok(ResolvedPlaylist {
            url: url.to_string(),
            text,
        });
    }

    let variant_url = select_best_variant_url(url, &text)?;
    let variant_text = request_text(client, &variant_url, headers).await?;
    Ok(ResolvedPlaylist {
        url: variant_url,
        text: variant_text,
    })
}

async fn request_text(
    client: &reqwest::Client,
    url: &str,
    headers: &HashMap<String, String>,
) -> Result<String, String> {
    let mut request = client.get(url);
    if !headers.is_empty() {
        request = request.headers(hash_map_to_header_map(headers));
    }
    request
        .send()
        .await
        .map_err(|e| format!("M3U8 请求失败: {e}"))?
        .error_for_status()
        .map_err(|e| format!("M3U8 响应异常: {e}"))?
        .text()
        .await
        .map_err(|e| format!("读取 M3U8 失败: {e}"))
}

async fn download_hls_segment(
    client: &reqwest::Client,
    url: &str,
    headers: &HashMap<String, String>,
    cancel_token: &CancellationToken,
) -> Result<Vec<u8>, String> {
    let mut last_error = String::new();
    for attempt in 1..=3 {
        if cancel_token.is_cancelled() {
            return Err("下载已取消".to_string());
        }
        let mut request = client.get(url);
        if !headers.is_empty() {
            request = request.headers(hash_map_to_header_map(headers));
        }
        match request.send().await {
            Ok(response) => match response.error_for_status() {
                Ok(response) => match response.bytes().await {
                    Ok(bytes) => return Ok(bytes.to_vec()),
                    Err(error) => last_error = error.to_string(),
                },
                Err(error) => last_error = error.to_string(),
            },
            Err(error) => last_error = error.to_string(),
        }
        tokio::time::sleep(tokio::time::Duration::from_millis(250 * attempt)).await;
    }
    Err(format!("下载 M3U8 分片失败: {url}: {last_error}"))
}

fn parse_hls_segments(base_url: &str, playlist: &str) -> Result<HlsPlaylist, String> {
    if !playlist.contains("#EXTM3U") {
        return Err("链接不是有效的 M3U8 播放列表".to_string());
    }

    let base = url::Url::parse(base_url).map_err(|e| format!("M3U8 URL 无效: {e}"))?;
    let mut segments = Vec::new();
    let mut media_sequence = 0_u64;
    let mut current_key: Option<(String, Option<[u8; 16]>)> = None;
    let mut init_map_url: Option<String> = None;

    for line in playlist.lines().map(str::trim) {
        if line.is_empty() {
            continue;
        }
        if let Some(value) = line.strip_prefix("#EXT-X-MEDIA-SEQUENCE:") {
            media_sequence = value.trim().parse::<u64>().unwrap_or(0);
            continue;
        }
        if let Some(attrs) = line.strip_prefix("#EXT-X-MAP:") {
            if let Some(uri) = parse_m3u8_attr(attrs, "URI") {
                init_map_url = Some(
                    base.join(&uri)
                        .map_err(|e| format!("M3U8 init map URL 无效: {e}"))?
                        .to_string(),
                );
            }
            continue;
        }
        if let Some(attrs) = line.strip_prefix("#EXT-X-KEY:") {
            let method = parse_m3u8_attr(attrs, "METHOD").unwrap_or_default();
            if method == "NONE" {
                current_key = None;
                continue;
            }
            if method != "AES-128" {
                return Err(format!("暂不支持的 M3U8 加密方式: {method}"));
            }
            let uri = parse_m3u8_attr(attrs, "URI")
                .ok_or_else(|| "M3U8 AES-128 缺少 key URI".to_string())?;
            let key_url = base
                .join(&uri)
                .map_err(|e| format!("M3U8 key URL 无效: {e}"))?
                .to_string();
            let iv = parse_m3u8_attr(attrs, "IV")
                .map(|value| parse_hls_iv(&value))
                .transpose()?;
            current_key = Some((key_url, iv));
            continue;
        }
        if line.starts_with('#') {
            continue;
        }

        let url = base
            .join(line)
            .map_err(|e| format!("M3U8 分片 URL 无效: {e}"))?
            .to_string();
        let index = segments.len();
        let key = current_key.as_ref().map(|(uri, iv)| HlsKey {
            uri: uri.clone(),
            iv: iv.unwrap_or_else(|| sequence_iv(media_sequence + index as u64)),
        });
        segments.push(HlsSegment { index, url, key });
    }
    Ok(HlsPlaylist {
        segments,
        init_map_url,
    })
}

async fn concat_hls_segments(
    client: &reqwest::Client,
    headers: &HashMap<String, String>,
    init_map_url: Option<&str>,
    temp_dir: &PathBuf,
    segment_count: usize,
    output: &PathBuf,
) -> Result<(), String> {
    let mut output_file = tokio::fs::File::create(output)
        .await
        .map_err(|e| format!("创建 M3U8 合并文件失败: {e}"))?;
    if let Some(init_map_url) = init_map_url {
        let bytes =
            download_hls_segment(client, init_map_url, headers, &CancellationToken::new()).await?;
        output_file
            .write_all(&bytes)
            .await
            .map_err(|e| format!("写入 M3U8 init map 失败: {e}"))?;
    }
    for index in 0..segment_count {
        let path = temp_dir.join(format!("{index:08}.ts"));
        let bytes = tokio::fs::read(&path)
            .await
            .map_err(|e| format!("读取 M3U8 分片失败: {e}"))?;
        output_file
            .write_all(&bytes)
            .await
            .map_err(|e| format!("合并 M3U8 分片失败: {e}"))?;
    }
    output_file
        .flush()
        .await
        .map_err(|e| format!("刷新 M3U8 合并文件失败: {e}"))?;
    Ok(())
}

async fn fetch_hls_keys(
    client: &reqwest::Client,
    segments: &[HlsSegment],
    headers: &HashMap<String, String>,
) -> Result<HashMap<String, Vec<u8>>, String> {
    let mut keys = HashMap::new();
    for segment in segments {
        let Some(key) = &segment.key else {
            continue;
        };
        if keys.contains_key(&key.uri) {
            continue;
        }
        let bytes =
            download_hls_segment(client, &key.uri, headers, &CancellationToken::new()).await?;
        if bytes.len() != 16 {
            return Err(format!("M3U8 AES-128 key 长度异常: {}", key.uri));
        }
        keys.insert(key.uri.clone(), bytes);
    }
    Ok(keys)
}

fn decrypt_hls_segment(
    mut bytes: Vec<u8>,
    key: &HlsKey,
    key_map: &HashMap<String, Vec<u8>>,
) -> Result<Vec<u8>, String> {
    let key_bytes = key_map
        .get(&key.uri)
        .ok_or_else(|| format!("缺少 M3U8 AES-128 key: {}", key.uri))?;
    let decryptor = cbc::Decryptor::<aes::Aes128>::new_from_slices(key_bytes, &key.iv)
        .map_err(|e| format!("初始化 M3U8 AES 解密失败: {e}"))?;
    let decrypted = decryptor
        .decrypt_padded_mut::<Pkcs7>(&mut bytes)
        .map_err(|e| format!("M3U8 AES 分片解密失败: {e}"))?;
    Ok(decrypted.to_vec())
}

fn select_best_variant_url(base_url: &str, playlist: &str) -> Result<String, String> {
    let base = url::Url::parse(base_url).map_err(|e| format!("M3U8 URL 无效: {e}"))?;
    let mut pending_attrs: Option<String> = None;
    let mut variants: Vec<(u64, u64, String)> = Vec::new();

    for line in playlist.lines().map(str::trim) {
        if let Some(attrs) = line.strip_prefix("#EXT-X-STREAM-INF:") {
            pending_attrs = Some(attrs.to_string());
            continue;
        }
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if let Some(attrs) = pending_attrs.take() {
            let pixels = parse_m3u8_attr(&attrs, "RESOLUTION")
                .and_then(|resolution| {
                    let (w, h) = resolution.split_once('x')?;
                    Some(w.parse::<u64>().ok()? * h.parse::<u64>().ok()?)
                })
                .unwrap_or(0);
            let bandwidth = parse_m3u8_attr(&attrs, "BANDWIDTH")
                .and_then(|value| value.parse::<u64>().ok())
                .unwrap_or(0);
            let url = base
                .join(line)
                .map_err(|e| format!("M3U8 variant URL 无效: {e}"))?
                .to_string();
            variants.push((pixels, bandwidth, url));
        }
    }

    variants
        .into_iter()
        .max_by_key(|(pixels, bandwidth, _)| (*pixels, *bandwidth))
        .map(|(_, _, url)| url)
        .ok_or_else(|| "M3U8 master playlist 没有可用 variant".to_string())
}

fn parse_m3u8_attr(attrs: &str, key: &str) -> Option<String> {
    attrs.split(',').find_map(|part| {
        let (name, value) = part.split_once('=')?;
        if name.trim() == key {
            Some(value.trim().trim_matches('"').to_string())
        } else {
            None
        }
    })
}

fn parse_hls_iv(value: &str) -> Result<[u8; 16], String> {
    let hex = value
        .trim()
        .trim_start_matches("0x")
        .trim_start_matches("0X");
    if hex.len() > 32 {
        return Err("M3U8 IV 长度异常".to_string());
    }
    let padded = format!("{hex:0>32}");
    let mut iv = [0_u8; 16];
    for index in 0..16 {
        iv[index] = u8::from_str_radix(&padded[index * 2..index * 2 + 2], 16)
            .map_err(|_| "M3U8 IV 格式异常".to_string())?;
    }
    Ok(iv)
}

fn sequence_iv(sequence: u64) -> [u8; 16] {
    let mut iv = [0_u8; 16];
    iv[8..].copy_from_slice(&sequence.to_be_bytes());
    iv
}

async fn remux_ts_to_mp4(input: &PathBuf, output: &PathBuf) -> Result<(), String> {
    let output_result = tokio::process::Command::new("ffmpeg")
        .args([
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            input.to_str().unwrap_or_default(),
            "-c",
            "copy",
            "-bsf:a",
            "aac_adtstoasc",
            "-movflags",
            "+faststart",
            output.to_str().unwrap_or_default(),
        ])
        .output()
        .await
        .map_err(|e| format!("启动 ffmpeg 转封装失败: {e}"))?;

    if output_result.status.success() {
        Ok(())
    } else {
        let detail = String::from_utf8_lossy(&output_result.stderr);
        Err(format!("ffmpeg 转封装 M3U8 失败: {}", detail.trim()))
    }
}

async fn download_stream(
    app: &AppHandle,
    task_id: &str,
    _client: &reqwest::Client,
    format: &VideoFormat,
    url: &str,
    save_path: &PathBuf,
    cancel_token: &CancellationToken,
) -> Result<(), String> {
    let is_bilibili = url.contains("bilibili.com") || url.contains("bilivideo.");

    let extra_referer = format
        .headers
        .get("referer")
        .or_else(|| format.headers.get("Referer"))
        .map(|s| s.as_str());

    let (final_url, referer) = if is_bilibili {
        (url.to_string(), Some("https://www.bilibili.com/"))
    } else {
        // 非B站URL：手动解析302获取CDN直链，并透传用户提供的Referer
        let resolved = resolve_cdn_url(url, extra_referer)
            .await
            .unwrap_or_else(|_| url.to_string());
        (resolved, extra_referer)
    };

    let dl_client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
        .map_err(|e| e.to_string())?;

    let mut req = dl_client.get(&final_url);
    if !format.headers.is_empty() {
        req = req.headers(hash_map_to_header_map(&format.headers));
    }
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
                let is_batch = is_batch_task(task_id);
                let _ = app.emit(
                    "video-download-progress",
                    DownloadProgress {
                        task_id: task_id.to_string(),
                        downloaded,
                        total,
                        speed: 0,
                        status: DownloadStatus::Cancelled,
                        file_path: None,
                        is_batch: Some(is_batch),
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
                                    file_path: None,
                                    is_batch: None,
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

fn is_m3u8_url(url: &str) -> bool {
    url.contains(".m3u8")
}

/// 预解析URL的302重定向，获取最终CDN直链
async fn resolve_cdn_url(url: &str, referer: Option<&str>) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| e.to_string())?;

    let mut req = client.get(url);
    if let Some(r) = referer {
        req = req.header("Referer", r);
    }
    let resp = req
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
    let mut result: String = name
        .chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            c if c.is_control() => '_',
            _ => c,
        })
        .collect();
    result = result.trim().to_string();
    if result == "." || result == ".." {
        result = "_".to_string();
    }
    let lower = result.to_ascii_lowercase();
    if matches!(
        lower.as_str(),
        "con" | "prn" | "aux" | "nul"
            | "com1" | "com2" | "com3" | "com4" | "com5" | "com6" | "com7" | "com8" | "com9"
            | "lpt1" | "lpt2" | "lpt3" | "lpt4" | "lpt5" | "lpt6" | "lpt7" | "lpt8" | "lpt9"
    ) {
        result.push_str("_video");
    }
    if result.is_empty() {
        result = "video".to_string();
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_hls_segments_with_relative_urls() {
        let playlist = r#"#EXTM3U
#EXT-X-TARGETDURATION:4
#EXTINF:4.0,
video0.jpeg
#EXTINF:4.0,
nested/video1.ts
"#;

        let segments =
            parse_hls_segments("https://example.com/path/video.m3u8", playlist).expect("segments");
        assert_eq!(segments.segments.len(), 2);
        assert_eq!(
            segments.segments[0].url,
            "https://example.com/path/video0.jpeg"
        );
        assert_eq!(
            segments.segments[1].url,
            "https://example.com/path/nested/video1.ts"
        );
    }

    #[test]
    fn parses_aes_128_hls() {
        let playlist = r#"#EXTM3U
#EXT-X-KEY:METHOD=AES-128,URI="key.key"
#EXTINF:4.0,
video0.ts
"#;

        let segments =
            parse_hls_segments("https://example.com/video.m3u8", playlist).expect("segments");
        let key = segments.segments[0].key.as_ref().expect("key");
        assert_eq!(key.uri, "https://example.com/key.key");
        assert_eq!(key.iv, sequence_iv(0));
    }
}
