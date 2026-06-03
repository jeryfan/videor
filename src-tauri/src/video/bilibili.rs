use super::{VideoFormat, VideoInfo, VideoItem, VideoKind, VideoParser};
use crate::config::{atomic_write, get_app_config_dir};
use crate::video::stream_proxy;
use qrcode::render::svg;
use qrcode::QrCode;
use regex::Regex;
use reqwest::header::{HeaderMap, HeaderValue, COOKIE, REFERER, SET_COOKIE, USER_AGENT};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::cmp::Reverse;
use std::collections::HashSet;
use std::path::PathBuf;

pub const BILI_REFERER: &str = "https://www.bilibili.com/";
pub const BILI_UA: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BilibiliLoginQr {
    pub url: String,
    pub qrcode_key: String,
    pub svg: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BilibiliLoginPoll {
    pub status: String,
    pub message: String,
    pub logged_in: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BilibiliLoginStatus {
    pub logged_in: bool,
    pub username: Option<String>,
    pub avatar_url: Option<String>,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct BilibiliCookieStore {
    cookies: Vec<StoredCookie>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct StoredCookie {
    name: String,
    value: String,
}

pub struct BilibiliParser;

#[async_trait::async_trait]
impl VideoParser for BilibiliParser {
    fn can_handle(&self, url: &str) -> bool {
        url.contains("bilibili.com") || url.contains("b23.tv")
    }

    async fn parse(&self, url: &str, client: &reqwest::Client) -> Result<VideoInfo, String> {
        let cookie = load_cookie_header().unwrap_or_default();
        Self::parse_with_cookie(url, client, &cookie).await
    }

    async fn parse_with_headers(
        &self,
        url: &str,
        client: &reqwest::Client,
        headers: Option<&HeaderMap>,
    ) -> Result<VideoInfo, String> {
        let local_cookie = load_cookie_header().unwrap_or_default();
        let merged_cookie = merge_cookies(headers, &local_cookie);
        Self::parse_with_cookie(url, client, &merged_cookie).await
    }
}

impl BilibiliParser {
    async fn parse_with_cookie(
        url: &str,
        client: &reqwest::Client,
        cookie: &str,
    ) -> Result<VideoInfo, String> {
        let resolved_url = if url.contains("b23.tv") {
            resolve_short_url(client, url).await?
        } else {
            url.to_string()
        };

        if let Some((mid, sid, is_series)) = extract_space_list_ids(&resolved_url) {
            return parse_space_list(client, &resolved_url, &mid, &sid, is_series, cookie).await;
        }

        parse_video(client, &resolved_url, cookie).await
    }
}

pub async fn generate_login_qr(client: &reqwest::Client) -> Result<BilibiliLoginQr, String> {
    let resp: serde_json::Value = client
        .get("https://passport.bilibili.com/x/passport-login/web/qrcode/generate")
        .headers(default_headers(""))
        .send()
        .await
        .map_err(|e| format!("获取 Bilibili 登录二维码失败: {e}"))?
        .json()
        .await
        .map_err(|e| format!("解析 Bilibili 登录二维码失败: {e}"))?;

    ensure_code_ok(&resp)?;
    let data = resp
        .get("data")
        .ok_or_else(|| "Bilibili 登录二维码响应缺少 data".to_string())?;

    let url = data
        .get("url")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "Bilibili 登录二维码响应缺少 url".to_string())?
        .to_string();
    let svg = QrCode::new(url.as_bytes())
        .map_err(|e| format!("生成 Bilibili 登录二维码失败: {e}"))?
        .render::<svg::Color>()
        .min_dimensions(220, 220)
        .dark_color(svg::Color("#111111"))
        .light_color(svg::Color("#ffffff"))
        .build();

    Ok(BilibiliLoginQr {
        url,
        qrcode_key: data
            .get("qrcode_key")
            .and_then(|v| v.as_str())
            .ok_or_else(|| "Bilibili 登录二维码响应缺少 qrcode_key".to_string())?
            .to_string(),
        svg: format!("data:image/svg+xml;utf8,{}", encode_svg_data_url(&svg)),
    })
}

pub async fn poll_login_qr(
    client: &reqwest::Client,
    qrcode_key: &str,
) -> Result<BilibiliLoginPoll, String> {
    let resp = client
        .get("https://passport.bilibili.com/x/passport-login/web/qrcode/poll")
        .headers(default_headers(""))
        .query(&[("qrcode_key", qrcode_key)])
        .send()
        .await
        .map_err(|e| format!("检查 Bilibili 登录二维码失败: {e}"))?;

    let headers = resp.headers().clone();
    let body: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("解析 Bilibili 登录二维码状态失败: {e}"))?;

    ensure_code_ok(&body)?;
    let data = body
        .get("data")
        .ok_or_else(|| "Bilibili 登录二维码状态响应缺少 data".to_string())?;
    let code = data.get("code").and_then(|v| v.as_i64()).unwrap_or(-1);
    let message = data
        .get("message")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    match code {
        0 => {
            save_cookies_from_headers(&headers)?;
            Ok(BilibiliLoginPoll {
                status: "confirmed".to_string(),
                message: "登录成功".to_string(),
                logged_in: true,
            })
        }
        86090 => Ok(BilibiliLoginPoll {
            status: "scanned".to_string(),
            message: "已扫码，请在 Bilibili App 中确认".to_string(),
            logged_in: false,
        }),
        86101 => Ok(BilibiliLoginPoll {
            status: "waiting".to_string(),
            message: "等待扫码".to_string(),
            logged_in: false,
        }),
        86038 => Ok(BilibiliLoginPoll {
            status: "expired".to_string(),
            message: "二维码已过期".to_string(),
            logged_in: false,
        }),
        _ => Ok(BilibiliLoginPoll {
            status: "error".to_string(),
            message,
            logged_in: false,
        }),
    }
}

pub async fn login_status(client: &reqwest::Client) -> Result<BilibiliLoginStatus, String> {
    let cookie = load_cookie_header().unwrap_or_default();
    if cookie.is_empty() {
        return Ok(BilibiliLoginStatus {
            logged_in: false,
            username: None,
            avatar_url: None,
            message: Some("未登录".to_string()),
        });
    }

    let resp: serde_json::Value = client
        .get("https://api.bilibili.com/x/web-interface/nav")
        .headers(default_headers(&cookie))
        .send()
        .await
        .map_err(|e| format!("检查 Bilibili 登录状态失败: {e}"))?
        .json()
        .await
        .map_err(|e| format!("解析 Bilibili 登录状态失败: {e}"))?;

    let code = resp.get("code").and_then(|v| v.as_i64()).unwrap_or(-1);
    let data = resp.get("data");
    let is_login = data
        .and_then(|v| v.get("isLogin"))
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    if code == 0 && is_login {
        Ok(BilibiliLoginStatus {
            logged_in: true,
            username: data
                .and_then(|v| v.get("uname"))
                .and_then(|v| v.as_str())
                .map(|s| s.to_string()),
            avatar_url: data
                .and_then(|v| v.get("face"))
                .and_then(|v| v.as_str())
                .map(|s| s.to_string()),
            message: None,
        })
    } else {
        Ok(BilibiliLoginStatus {
            logged_in: false,
            username: None,
            avatar_url: None,
            message: resp
                .get("message")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
                .or_else(|| Some("登录已失效".to_string())),
        })
    }
}

pub async fn logout(client: &reqwest::Client) -> Result<(), String> {
    let server_result = logout_server_session(client).await;
    remove_cookie_store()?;
    server_result
}

async fn logout_server_session(client: &reqwest::Client) -> Result<(), String> {
    let cookie = load_cookie_header().unwrap_or_default();
    if cookie.is_empty() {
        return Ok(());
    }

    let csrf = load_cookie_value("bili_jct")?;
    let Some(csrf) = csrf else {
        return Ok(());
    };

    let resp: serde_json::Value = client
        .post("https://passport.bilibili.com/login/exit/v2")
        .headers(default_headers(&cookie))
        .form(&[("biliCSRF", csrf.as_str())])
        .send()
        .await
        .map_err(|e| format!("Bilibili 服务端退出登录失败: {e}"))?
        .json()
        .await
        .map_err(|e| format!("解析 Bilibili 服务端退出响应失败: {e}"))?;

    ensure_code_ok(&resp)
}

fn remove_cookie_store() -> Result<(), String> {
    let path = cookie_store_path();
    if path.exists() {
        std::fs::remove_file(&path).map_err(|e| format!("清除 Bilibili 登录信息失败: {e}"))?;
    }
    Ok(())
}

async fn parse_video(
    client: &reqwest::Client,
    url: &str,
    cookie: &str,
) -> Result<VideoInfo, String> {
    let bvid = extract_bvid(url)?;
    let selected_page = extract_page(url).unwrap_or(1);

    let view_url = format!("https://api.bilibili.com/x/web-interface/view?bvid={bvid}");
    let view_resp: serde_json::Value = client
        .get(&view_url)
        .headers(default_headers(cookie))
        .send()
        .await
        .map_err(|e| format!("Bilibili view API request failed: {e}"))?
        .json()
        .await
        .map_err(|e| format!("Failed to parse Bilibili view response: {e}"))?;

    let code = view_resp.get("code").and_then(|v| v.as_i64()).unwrap_or(-1);
    if code == -101 {
        return login_required_info("Bilibili 视频需要登录后解析");
    }
    ensure_code_ok(&view_resp)?;

    let data = view_resp
        .get("data")
        .ok_or_else(|| "Failed to get video info from Bilibili API".to_string())?;

    let title = data
        .get("title")
        .and_then(|v| v.as_str())
        .unwrap_or("B站视频")
        .to_string();
    let cover_url = data.get("pic").and_then(|v| v.as_str()).map(str::to_string);
    let duration = data.get("duration").and_then(|v| v.as_u64());
    let uploader = data
        .pointer("/owner/name")
        .and_then(|v| v.as_str())
        .map(str::to_string);
    let pages = data.get("pages").and_then(|v| v.as_array());
    let selected_idx = selected_page.saturating_sub(1) as usize;
    let selected_page_data = pages
        .and_then(|p| p.get(selected_idx))
        .or_else(|| pages.and_then(|p| p.first()))
        .unwrap_or(data);
    let cid = selected_page_data
        .get("cid")
        .and_then(|v| v.as_u64())
        .or_else(|| data.get("cid").and_then(|v| v.as_u64()))
        .ok_or_else(|| "Failed to get cid from Bilibili video info".to_string())?;

    let formats = fetch_play_formats(client, &bvid, cid, cookie).await?;
    let items: Vec<VideoItem> = pages
        .map(|pages| {
            pages
                .iter()
                .enumerate()
                .map(|(idx, page)| {
                    let page_no = page
                        .get("page")
                        .and_then(|v| v.as_u64())
                        .unwrap_or((idx + 1) as u64);
                    let part = page
                        .get("part")
                        .and_then(|v| v.as_str())
                        .unwrap_or(&title)
                        .to_string();
                    VideoItem {
                        id: format!("{bvid}_p{page_no}"),
                        title: if pages.len() > 1 {
                            format!("P{page_no} {part}")
                        } else {
                            title.clone()
                        },
                        url: format!("https://www.bilibili.com/video/{bvid}?p={page_no}"),
                        bvid: Some(bvid.clone()),
                        cid: page.get("cid").and_then(|v| v.as_u64()),
                        page: Some(page_no),
                        duration: page.get("duration").and_then(|v| v.as_u64()),
                        cover_url: cover_url.clone(),
                    }
                })
                .collect()
        })
        .unwrap_or_default();

    Ok(VideoInfo {
        title,
        cover_url,
        duration,
        platform: "bilibili".to_string(),
        formats,
        kind: if items.len() > 1 {
            VideoKind::Multipart
        } else {
            VideoKind::Video
        },
        items,
        login_required: false,
        message: None,
        uploader,
    })
}

async fn parse_space_list(
    client: &reqwest::Client,
    _url: &str,
    mid: &str,
    sid: &str,
    is_series: bool,
    cookie: &str,
) -> Result<VideoInfo, String> {
    let mut items = Vec::new();
    let mut title = if is_series {
        "Bilibili 视频列表"
    } else {
        "Bilibili 合集"
    }
    .to_string();
    let mut uploader = None;
    let mut page = 1_u64;
    let page_size = 30_u64;

    loop {
        let api_url = if is_series {
            "https://api.bilibili.com/x/series/archives"
        } else {
            "https://api.bilibili.com/x/polymer/web-space/seasons_archives_list"
        };
        let mut req = client.get(api_url).headers(default_headers(cookie));
        req = if is_series {
            req.query(&[
                ("mid", mid),
                ("series_id", sid),
                ("pn", &page.to_string()),
                ("ps", &page_size.to_string()),
            ])
        } else {
            req.query(&[
                ("mid", mid),
                ("season_id", sid),
                ("page_num", &page.to_string()),
                ("page_size", &page_size.to_string()),
            ])
        };

        let value: serde_json::Value = req
            .send()
            .await
            .map_err(|e| format!("Bilibili 合集 API 请求失败: {e}"))?
            .json()
            .await
            .map_err(|e| format!("解析 Bilibili 合集响应失败: {e}"))?;

        let code = value.get("code").and_then(|v| v.as_i64()).unwrap_or(-1);
        if code == -101 {
            return login_required_info("该 Bilibili 合集需要登录后解析");
        }
        if code != 0 {
            let msg = value
                .get("message")
                .and_then(|v| v.as_str())
                .unwrap_or("Bilibili 合集解析失败");
            if msg.contains("权限") || msg.contains("充电") || msg.contains("未购买") {
                return Ok(VideoInfo {
                    title,
                    cover_url: None,
                    duration: None,
                    platform: "bilibili".to_string(),
                    formats: Vec::new(),
                    kind: VideoKind::ChargingCollection,
                    items: Vec::new(),
                    login_required: false,
                    message: Some(msg.to_string()),
                    uploader,
                });
            }
            return Err(msg.to_string());
        }

        let data = value
            .get("data")
            .ok_or_else(|| "Bilibili 合集响应缺少 data".to_string())?;
        if page == 1 {
            if is_series {
                title = data
                    .pointer("/meta/name")
                    .and_then(|v| v.as_str())
                    .unwrap_or(&title)
                    .to_string();
            } else {
                title = data
                    .pointer("/meta/name")
                    .or_else(|| data.pointer("/season/title"))
                    .and_then(|v| v.as_str())
                    .unwrap_or(&title)
                    .to_string();
            }
            uploader = data
                .pointer("/meta/upper/name")
                .or_else(|| data.pointer("/season/upper/name"))
                .and_then(|v| v.as_str())
                .map(str::to_string);
        }

        let archives = data
            .get("archives")
            .or_else(|| data.pointer("/archives"))
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        if archives.is_empty() {
            break;
        }

        for (idx, archive) in archives.iter().enumerate() {
            if let Some(bvid) = archive.get("bvid").and_then(|v| v.as_str()) {
                let item_title = archive
                    .get("title")
                    .and_then(|v| v.as_str())
                    .unwrap_or("Bilibili 视频")
                    .to_string();
                items.push(VideoItem {
                    id: format!("{bvid}_{}", items.len() + idx),
                    title: item_title,
                    url: format!("https://www.bilibili.com/video/{bvid}"),
                    bvid: Some(bvid.to_string()),
                    cid: archive.get("cid").and_then(|v| v.as_u64()),
                    page: None,
                    duration: archive
                        .get("duration")
                        .or_else(|| archive.get("duration_text"))
                        .and_then(|v| v.as_u64()),
                    cover_url: archive
                        .get("pic")
                        .or_else(|| archive.get("cover"))
                        .and_then(|v| v.as_str())
                        .map(str::to_string),
                });
            }
        }

        if archives.len() < page_size as usize || page >= 20 {
            break;
        }
        page += 1;
        tokio::time::sleep(std::time::Duration::from_millis(250)).await;
    }

    Ok(VideoInfo {
        title,
        cover_url: items.first().and_then(|i| i.cover_url.clone()),
        duration: None,
        platform: "bilibili".to_string(),
        formats: Vec::new(),
        kind: VideoKind::Collection,
        items,
        login_required: false,
        message: None,
        uploader,
    })
}

async fn fetch_play_formats(
    client: &reqwest::Client,
    bvid: &str,
    cid: u64,
    cookie: &str,
) -> Result<Vec<VideoFormat>, String> {
    let play_url = format!(
        "https://api.bilibili.com/x/player/playurl?bvid={bvid}&cid={cid}&fnval=4048&fourk=1"
    );
    let play_resp: serde_json::Value = client
        .get(&play_url)
        .headers(default_headers(cookie))
        .send()
        .await
        .map_err(|e| format!("Bilibili playurl API request failed: {e}"))?
        .json()
        .await
        .map_err(|e| format!("Failed to parse Bilibili playurl response: {e}"))?;

    let code = play_resp.get("code").and_then(|v| v.as_i64()).unwrap_or(-1);
    if code == -101 {
        return Err("该视频需要登录后解析".to_string());
    }
    ensure_code_ok(&play_resp)?;

    let play_data = play_resp
        .get("data")
        .ok_or_else(|| "Failed to get play URL data from Bilibili API".to_string())?;
    let preview_url = match fetch_progressive_preview_url(client, bvid, cid, cookie).await {
        Some(url) => stream_proxy::proxy_url_for(&url).await.ok(),
        None => None,
    };
    let mut formats = Vec::new();

    if let Some(dash) = play_data.get("dash") {
        let audio_url = dash
            .pointer("/audio/0/baseUrl")
            .or_else(|| dash.pointer("/audio/0/base_url"))
            .and_then(|v| v.as_str())
            .map(str::to_string);

        if let Some(videos) = dash.get("video").and_then(|v| v.as_array()) {
            let mut seen_qualities = HashSet::new();
            for video in videos {
                let quality_id = video.get("id").and_then(|v| v.as_u64()).unwrap_or(0);
                if !seen_qualities.insert(quality_id) {
                    continue;
                }
                let Some(best_video) = select_best_dash_video(videos, quality_id) else {
                    continue;
                };
                let Some(base_url) = dash_video_url(best_video) else {
                    continue;
                };
                let codec = best_video
                    .get("codecs")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                let quality = if codec.starts_with("avc1") {
                    quality_label(quality_id)
                } else {
                    format!("{} ({})", quality_label(quality_id), codec_label(codec))
                };

                formats.push(VideoFormat {
                    quality,
                    url: base_url.to_string(),
                    preview_url: preview_url.clone(),
                    audio_url: audio_url.clone(),
                    size: best_video.get("size").and_then(|v| v.as_u64()),
                    headers: Default::default(),
                });
            }
        }
    }

    if formats.is_empty() {
        if let Some(durls) = play_data.get("durl").and_then(|v| v.as_array()) {
            for durl in durls {
                if let Some(url) = durl.get("url").and_then(|v| v.as_str()) {
                    formats.push(VideoFormat {
                        quality: "default".to_string(),
                        url: url.to_string(),
                        preview_url: Some(url.to_string()),
                        audio_url: None,
                        size: durl.get("size").and_then(|v| v.as_u64()),
                        headers: Default::default(),
                    });
                }
            }
        }
    }

    if formats.is_empty() {
        return Err("No playable video formats found".to_string());
    }
    formats.sort_by_key(|format| Reverse(format_quality_rank(&format.quality)));
    Ok(formats)
}

async fn fetch_progressive_preview_url(
    client: &reqwest::Client,
    bvid: &str,
    cid: u64,
    cookie: &str,
) -> Option<String> {
    for qn in [80_u64, 64, 32, 16] {
        let play_url = format!(
            "https://api.bilibili.com/x/player/playurl?bvid={bvid}&cid={cid}&qn={qn}&fnval=0&platform=html5&high_quality=1"
        );
        let Ok(resp) = client
            .get(&play_url)
            .headers(default_headers(cookie))
            .send()
            .await
        else {
            continue;
        };
        let Ok(play_resp) = resp.json::<serde_json::Value>().await else {
            continue;
        };

        if play_resp.get("code").and_then(|v| v.as_i64()) != Some(0) {
            continue;
        }

        if let Some(url) = play_resp
            .pointer("/data/durl/0/url")
            .and_then(|v| v.as_str())
            .map(str::to_string)
        {
            return Some(url);
        }
    }

    None
}

fn select_best_dash_video(videos: &[Value], quality_id: u64) -> Option<&Value> {
    videos
        .iter()
        .filter(|video| video.get("id").and_then(|v| v.as_u64()) == Some(quality_id))
        .filter(|video| dash_video_url(video).is_some())
        .min_by_key(|video| {
            let codecs = video.get("codecs").and_then(|v| v.as_str()).unwrap_or("");
            let bandwidth = video
                .get("bandwidth")
                .or_else(|| video.get("size"))
                .and_then(|v| v.as_u64())
                .unwrap_or(0);
            (codec_rank(codecs), Reverse(bandwidth))
        })
}

fn dash_video_url(video: &Value) -> Option<&str> {
    video
        .get("baseUrl")
        .or_else(|| video.get("base_url"))
        .and_then(|v| v.as_str())
}

fn codec_rank(codecs: &str) -> u8 {
    if codecs.starts_with("avc1") {
        0
    } else if codecs.contains("avc") {
        1
    } else if codecs.starts_with("hvc1") || codecs.starts_with("hev1") {
        2
    } else if codecs.starts_with("av01") {
        3
    } else {
        4
    }
}

fn codec_label(codecs: &str) -> &'static str {
    if codecs.starts_with("hvc1") || codecs.starts_with("hev1") {
        "HEVC"
    } else if codecs.starts_with("av01") {
        "AV1"
    } else {
        "兼容性未知"
    }
}

async fn resolve_short_url(client: &reqwest::Client, url: &str) -> Result<String, String> {
    let resp = client
        .get(url)
        .headers(default_headers(""))
        .send()
        .await
        .map_err(|e| format!("Failed to resolve Bilibili short URL: {e}"))?;
    Ok(resp.url().to_string())
}

fn default_headers(cookie: &str) -> HeaderMap {
    let mut headers = HeaderMap::new();
    headers.insert(USER_AGENT, HeaderValue::from_static(BILI_UA));
    headers.insert(REFERER, HeaderValue::from_static(BILI_REFERER));
    if !cookie.is_empty() {
        if let Ok(value) = HeaderValue::from_str(cookie) {
            headers.insert(COOKIE, value);
        }
    }
    headers
}

fn merge_cookies(headers: Option<&HeaderMap>, local_cookie: &str) -> String {
    let Some(headers) = headers else {
        return local_cookie.to_string();
    };
    let Some(ext_cookie) = headers.get(COOKIE).and_then(|v| v.to_str().ok()) else {
        return local_cookie.to_string();
    };
    if local_cookie.is_empty() {
        ext_cookie.to_string()
    } else {
        format!("{}; {}", ext_cookie, local_cookie)
    }
}

fn ensure_code_ok(value: &serde_json::Value) -> Result<(), String> {
    let code = value.get("code").and_then(|v| v.as_i64()).unwrap_or(0);
    if code == 0 {
        Ok(())
    } else {
        Err(value
            .get("message")
            .and_then(|v| v.as_str())
            .unwrap_or("Bilibili API request failed")
            .to_string())
    }
}

fn login_required_info(message: &str) -> Result<VideoInfo, String> {
    Ok(VideoInfo {
        title: "Bilibili".to_string(),
        cover_url: None,
        duration: None,
        platform: "bilibili".to_string(),
        formats: Vec::new(),
        kind: VideoKind::ChargingCollection,
        items: Vec::new(),
        login_required: true,
        message: Some(message.to_string()),
        uploader: None,
    })
}

fn cookie_store_path() -> PathBuf {
    get_app_config_dir().join("bilibili_cookies.json")
}

pub fn load_cookie_header() -> Result<String, String> {
    let path = cookie_store_path();
    if !path.exists() {
        return Ok(String::new());
    }
    let data = std::fs::read(&path).map_err(|e| format!("读取 Bilibili Cookie 失败: {e}"))?;
    let store: BilibiliCookieStore =
        serde_json::from_slice(&data).map_err(|e| format!("解析 Bilibili Cookie 失败: {e}"))?;
    Ok(store
        .cookies
        .iter()
        .map(|c| format!("{}={}", c.name, c.value))
        .collect::<Vec<_>>()
        .join("; "))
}

fn load_cookie_value(name: &str) -> Result<Option<String>, String> {
    let path = cookie_store_path();
    if !path.exists() {
        return Ok(None);
    }
    let data = std::fs::read(&path).map_err(|e| format!("读取 Bilibili Cookie 失败: {e}"))?;
    let store: BilibiliCookieStore =
        serde_json::from_slice(&data).map_err(|e| format!("解析 Bilibili Cookie 失败: {e}"))?;
    Ok(store
        .cookies
        .iter()
        .find(|cookie| cookie.name == name)
        .map(|cookie| cookie.value.clone()))
}

fn save_cookies_from_headers(headers: &HeaderMap) -> Result<(), String> {
    let mut cookies = Vec::new();
    for value in headers.get_all(SET_COOKIE).iter() {
        let Ok(raw) = value.to_str() else {
            continue;
        };
        if let Some((pair, _attrs)) = raw.split_once(';') {
            if let Some((name, value)) = pair.split_once('=') {
                if !name.trim().is_empty() && !value.trim().is_empty() {
                    cookies.push(StoredCookie {
                        name: name.trim().to_string(),
                        value: value.trim().to_string(),
                    });
                }
            }
        }
    }
    if cookies.is_empty() {
        return Err("Bilibili 登录成功但未返回 Cookie".to_string());
    }
    let store = BilibiliCookieStore { cookies };
    let bytes = serde_json::to_vec_pretty(&store).map_err(|e| e.to_string())?;
    atomic_write(&cookie_store_path(), &bytes).map_err(|e| e.to_string())
}

fn extract_bvid(url: &str) -> Result<String, String> {
    let parsed = url::Url::parse(url).map_err(|e| e.to_string())?;
    let path = parsed.path();
    let re = Regex::new(r"(BV[a-zA-Z0-9]+)").map_err(|e| e.to_string())?;
    re.captures(path)
        .and_then(|caps| caps.get(1))
        .map(|m| m.as_str().to_string())
        .ok_or_else(|| "Could not extract BV ID from Bilibili URL".to_string())
}

fn extract_page(url: &str) -> Option<u64> {
    let parsed = url::Url::parse(url).ok()?;
    parsed
        .query_pairs()
        .find(|(key, _)| key == "p")
        .and_then(|(_, value)| value.parse::<u64>().ok())
}

fn extract_space_list_ids(url: &str) -> Option<(String, String, bool)> {
    let collection =
        Regex::new(r"space\.bilibili\.com/(\d+)/(?:channel/collectiondetail\?sid=|lists/)(\d+)")
            .ok()?;
    if let Some(caps) = collection.captures(url) {
        let is_series = url.contains("type=series") || url.contains("seriesdetail");
        return Some((
            caps.get(1)?.as_str().to_string(),
            caps.get(2)?.as_str().to_string(),
            is_series,
        ));
    }
    let series = Regex::new(r"space\.bilibili\.com/(\d+)/channel/seriesdetail\?sid=(\d+)").ok()?;
    series.captures(url).and_then(|caps| {
        Some((
            caps.get(1)?.as_str().to_string(),
            caps.get(2)?.as_str().to_string(),
            true,
        ))
    })
}

fn quality_label(id: u64) -> String {
    match id {
        127 => "8K".to_string(),
        126 => "杜比视界".to_string(),
        125 => "HDR".to_string(),
        120 => "4K".to_string(),
        116 => "1080P60".to_string(),
        112 => "1080P+".to_string(),
        80 => "1080P".to_string(),
        74 => "720P60".to_string(),
        64 => "720P".to_string(),
        32 => "480P".to_string(),
        16 => "360P".to_string(),
        _ => format!("{}P", id),
    }
}

fn format_quality_rank(quality: &str) -> u64 {
    let base = quality.split_whitespace().next().unwrap_or(quality);
    match base {
        "8K" => 127,
        "杜比视界" => 126,
        "HDR" => 125,
        "4K" => 120,
        "1080P60" => 116,
        "1080P+" => 112,
        "1080P" => 80,
        "720P60" => 74,
        "720P" => 64,
        "480P" => 32,
        "360P" => 16,
        _ => base.trim_end_matches('P').parse::<u64>().unwrap_or(0),
    }
}

fn encode_svg_data_url(svg: &str) -> String {
    svg.replace('%', "%25")
        .replace('#', "%23")
        .replace('<', "%3C")
        .replace('>', "%3E")
        .replace('"', "%22")
        .replace(' ', "%20")
        .replace('\n', "")
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn selects_h264_dash_video_before_hevc_or_av1() {
        let videos = vec![
            json!({
                "id": 80,
                "codecs": "hev1.1.6.L120.90",
                "baseUrl": "https://example.com/hevc.m4s",
                "bandwidth": 3000
            }),
            json!({
                "id": 80,
                "codecs": "av01.0.08M.08",
                "baseUrl": "https://example.com/av1.m4s",
                "bandwidth": 4000
            }),
            json!({
                "id": 80,
                "codecs": "avc1.640032",
                "baseUrl": "https://example.com/h264.m4s",
                "bandwidth": 2000
            }),
        ];

        let selected = select_best_dash_video(&videos, 80).unwrap();
        assert_eq!(
            dash_video_url(selected),
            Some("https://example.com/h264.m4s")
        );
    }

    #[test]
    fn ranks_bilibili_formats_by_download_quality() {
        assert!(format_quality_rank("1080P") > format_quality_rank("720P"));
        assert!(format_quality_rank("1080P60") > format_quality_rank("1080P"));
        assert!(format_quality_rank("4K") > format_quality_rank("1080P60"));
        assert_eq!(format_quality_rank("1080P (HEVC)"), 80);
    }
}
