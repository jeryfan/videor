use super::{VideoFormat, VideoInfo, VideoItem, VideoKind, VideoParser};
use regex::Regex;
use serde_json::Value;

pub struct DouyinParser;

#[async_trait::async_trait]
impl VideoParser for DouyinParser {
    fn can_handle(&self, url: &str) -> bool {
        url.contains("douyin.com") || url.contains("douyinvod.com") || url.contains("iesdouyin.com")
    }

    async fn parse(&self, url: &str, client: &reqwest::Client) -> Result<VideoInfo, String> {
        // 直链 CDN — 直接返回
        if is_direct_cdn_url(url) {
            return Ok(VideoInfo {
                title: "抖音视频".to_string(),
                cover_url: None,
                duration: None,
                platform: "douyin".to_string(),
                formats: vec![VideoFormat {
                    quality: "original".to_string(),
                    url: url.to_string(),
                    preview_url: None,
                    audio_url: None,
                    size: None,
                    headers: Default::default(),
                }],
                kind: VideoKind::Video,
                items: Vec::<VideoItem>::new(),
                login_required: false,
                message: None,
                uploader: None,
            });
        }

        // 短链 -> 提取视频 ID
        let page_url = if url.contains("v.douyin.com") {
            resolve_short_url(client, url).await?
        } else {
            url.to_string()
        };

        let video_id = extract_video_id(&page_url)?;

        // 通过 iesdouyin 移动端分享页面获取视频信息
        fetch_via_mobile_share(client, &video_id).await
    }
}

fn is_direct_cdn_url(url: &str) -> bool {
    (url.contains("douyinvod.com") && url.contains("/video/")) || url.contains("mime_type=video")
}

/// 跟踪短链重定向获取最终 URL
async fn resolve_short_url(client: &reqwest::Client, url: &str) -> Result<String, String> {
    let resp = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("Failed to resolve short URL: {e}"))?;
    Ok(resp.url().to_string())
}

/// 从 iesdouyin 移动端分享页面获取视频信息
async fn fetch_via_mobile_share(
    client: &reqwest::Client,
    video_id: &str,
) -> Result<VideoInfo, String> {
    let share_url = format!("https://www.iesdouyin.com/share/video/{}", video_id);

    let mobile_ua = "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1";

    let resp = client
        .get(&share_url)
        .header("User-Agent", mobile_ua)
        .header("Referer", "https://www.douyin.com/")
        .send()
        .await
        .map_err(|e| format!("Failed to fetch Douyin share page: {e}"))?;

    let html = resp
        .text()
        .await
        .map_err(|e| format!("Failed to read share page: {e}"))?;

    // 提取 _ROUTER_DATA JSON
    let router_data = extract_router_data(&html)?;

    // 导航到视频数据：loaderData["video_(id)/page"].videoInfoRes.item_list[0]
    let item = router_data
        .pointer("/loaderData")
        .and_then(|ld| {
            if let Value::Object(map) = ld {
                for (key, val) in map {
                    if key.contains("video") && key.contains("page") {
                        return val.pointer("/videoInfoRes/item_list/0");
                    }
                }
            }
            None
        })
        .ok_or_else(|| "Video info not found in Douyin share page data".to_string())?;

    let title = item
        .get("desc")
        .and_then(|v| v.as_str())
        .map(|s| {
            if s.trim().is_empty() {
                "抖音视频".to_string()
            } else {
                s.to_string()
            }
        })
        .unwrap_or_else(|| "抖音视频".to_string());

    let cover_url = item
        .pointer("/video/cover/url_list/0")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let duration = item
        .pointer("/video/duration")
        .and_then(|v| v.as_u64())
        .map(|ms| ms / 1000);

    let mut formats = Vec::new();

    // 优先使用 _ROUTER_DATA 中的 play_addr URL（替换 playwm -> play 去水印）
    if let Some(url_list) = item
        .pointer("/video/play_addr/url_list")
        .and_then(|v| v.as_array())
    {
        for (idx, url_val) in url_list.iter().enumerate() {
            if let Some(raw_url) = url_val.as_str() {
                let url = raw_url.replace("playwm", "play");
                let label = if idx == 0 {
                    "原画"
                } else {
                    &format!("线路 {}", idx + 1)
                };
                formats.push(VideoFormat {
                    quality: label.to_string(),
                    url,
                    preview_url: None,
                    audio_url: None,
                    size: None,
                    headers: Default::default(),
                });
            }
        }
    }

    // Fallback：尝试 download_addr
    if formats.is_empty() {
        if let Some(url_list) = item
            .pointer("/video/download_addr/url_list")
            .and_then(|v| v.as_array())
        {
            for (idx, url_val) in url_list.iter().enumerate() {
                if let Some(url) = url_val.as_str() {
                    let label = if idx == 0 {
                        "原画"
                    } else {
                        &format!("线路 {}", idx + 1)
                    };
                    formats.push(VideoFormat {
                        quality: label.to_string(),
                        url: url.to_string(),
                        preview_url: None,
                        audio_url: None,
                        size: None,
                        headers: Default::default(),
                    });
                }
            }
        }
    }

    if formats.is_empty() {
        return Err("No playable video URLs found in Douyin share page".to_string());
    }

    Ok(VideoInfo {
        title,
        cover_url,
        duration,
        platform: "douyin".to_string(),
        formats,
        kind: VideoKind::Video,
        items: Vec::<VideoItem>::new(),
        login_required: false,
        message: None,
        uploader: None,
    })
}

/// 从 HTML 中提取 _ROUTER_DATA JSON
fn extract_router_data(html: &str) -> Result<Value, String> {
    let re = Regex::new(r"_ROUTER_DATA\s*=\s*(\{.+\})\s*</script>").map_err(|e| e.to_string())?;

    let caps = re
        .captures(html)
        .ok_or_else(|| "Could not find _ROUTER_DATA in Douyin share page".to_string())?;

    let json_str = &caps[1];
    serde_json::from_str(json_str).map_err(|e| format!("Failed to parse _ROUTER_DATA: {e}"))
}

fn extract_video_id(text: &str) -> Result<String, String> {
    // 匹配 /video/NNNN 或 /note/NNNN
    let re = Regex::new(r"/(?:video|note)/(\d+)").map_err(|e| e.to_string())?;
    if let Some(caps) = re.captures(text) {
        if let Some(id) = caps.get(1) {
            return Ok(id.as_str().to_string());
        }
    }

    // 尝试 modal_id 参数
    let re2 = Regex::new(r"modal_id=(\d+)").map_err(|e| e.to_string())?;
    if let Some(caps) = re2.captures(text) {
        if let Some(id) = caps.get(1) {
            return Ok(id.as_str().to_string());
        }
    }

    Err("Could not extract video ID from Douyin URL".to_string())
}
