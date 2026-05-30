use super::{VideoFormat, VideoInfo, VideoParser};
use regex::Regex;
use std::collections::HashSet;

pub struct BilibiliParser;

#[async_trait::async_trait]
impl VideoParser for BilibiliParser {
    fn can_handle(&self, url: &str) -> bool {
        url.contains("bilibili.com") || url.contains("b23.tv")
    }

    async fn parse(&self, url: &str, client: &reqwest::Client) -> Result<VideoInfo, String> {
        // 短链解析
        let resolved_url = if url.contains("b23.tv") {
            resolve_short_url(client, url).await?
        } else {
            url.to_string()
        };

        // 提取 BV ID
        let bvid = extract_bvid(&resolved_url)?;

        // 获取视频基本信息
        let view_url = format!(
            "https://api.bilibili.com/x/web-interface/view?bvid={}",
            bvid
        );

        let view_resp: serde_json::Value = client
            .get(&view_url)
            .header("Referer", "https://www.bilibili.com/")
            .send()
            .await
            .map_err(|e| format!("Bilibili view API request failed: {e}"))?
            .json()
            .await
            .map_err(|e| format!("Failed to parse Bilibili view response: {e}"))?;

        let data = view_resp
            .get("data")
            .ok_or_else(|| "Failed to get video info from Bilibili API".to_string())?;

        let title = data
            .get("title")
            .and_then(|v| v.as_str())
            .unwrap_or("B站视频")
            .to_string();

        let cover_url = data
            .get("pic")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        let duration = data.get("duration").and_then(|v| v.as_u64());

        let cid = data
            .get("cid")
            .and_then(|v| v.as_u64())
            .ok_or_else(|| "Failed to get cid from Bilibili video info".to_string())?;

        // 获取播放地址（DASH 格式）
        let play_url = format!(
            "https://api.bilibili.com/x/player/playurl?bvid={}&cid={}&fnval=16&fourk=1",
            bvid, cid
        );

        let play_resp: serde_json::Value = client
            .get(&play_url)
            .header("Referer", "https://www.bilibili.com/")
            .send()
            .await
            .map_err(|e| format!("Bilibili playurl API request failed: {e}"))?
            .json()
            .await
            .map_err(|e| format!("Failed to parse Bilibili playurl response: {e}"))?;

        let play_data = play_resp
            .get("data")
            .ok_or_else(|| "Failed to get play URL data from Bilibili API".to_string())?;

        let mut formats = Vec::new();

        // 优先 DASH 格式
        if let Some(dash) = play_data.get("dash") {
            let audio_url = dash
                .pointer("/audio/0/baseUrl")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());

            if let Some(videos) = dash.get("video").and_then(|v| v.as_array()) {
                let mut seen_qualities = HashSet::new();

                for video in videos {
                    let quality_id = video.get("id").and_then(|v| v.as_u64()).unwrap_or(0);

                    if !seen_qualities.insert(quality_id) {
                        continue;
                    }

                    let quality_label = quality_label(quality_id);

                    if let Some(base_url) = video.get("baseUrl").and_then(|v| v.as_str()) {
                        formats.push(VideoFormat {
                            quality: quality_label,
                            url: base_url.to_string(),
                            audio_url: audio_url.clone(),
                            size: None,
                        });
                    }
                }
            }
        }

        // Fallback：durl 格式
        if formats.is_empty() {
            if let Some(durls) = play_data.get("durl").and_then(|v| v.as_array()) {
                for durl in durls {
                    if let Some(url) = durl.get("url").and_then(|v| v.as_str()) {
                        let size = durl.get("size").and_then(|v| v.as_u64());
                        formats.push(VideoFormat {
                            quality: "default".to_string(),
                            url: url.to_string(),
                            audio_url: None,
                            size,
                        });
                    }
                }
            }
        }

        if formats.is_empty() {
            return Err("No playable video formats found".to_string());
        }

        Ok(VideoInfo {
            title,
            cover_url,
            duration,
            platform: "bilibili".to_string(),
            formats,
        })
    }
}

async fn resolve_short_url(client: &reqwest::Client, url: &str) -> Result<String, String> {
    let resp = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("Failed to resolve Bilibili short URL: {e}"))?;

    Ok(resp.url().to_string())
}

fn extract_bvid(url: &str) -> Result<String, String> {
    let re = Regex::new(r"(BV[a-zA-Z0-9]+)").map_err(|e| e.to_string())?;

    if let Some(caps) = re.captures(url) {
        if let Some(bvid) = caps.get(1) {
            return Ok(bvid.as_str().to_string());
        }
    }

    Err("Could not extract BV ID from Bilibili URL".to_string())
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
