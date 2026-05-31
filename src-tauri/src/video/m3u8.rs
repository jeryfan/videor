use super::{VideoFormat, VideoInfo, VideoItem, VideoKind, VideoParser};

pub struct M3u8Parser;

#[derive(Debug, Clone)]
struct StreamVariant {
    uri: String,
    bandwidth: Option<u64>,
    resolution: Option<String>,
    name: Option<String>,
}

#[async_trait::async_trait]
impl VideoParser for M3u8Parser {
    fn can_handle(&self, url: &str) -> bool {
        url.contains(".m3u8")
    }

    async fn parse(&self, url: &str, client: &reqwest::Client) -> Result<VideoInfo, String> {
        let playlist = fetch_playlist(client, url).await?;
        let variants = parse_master_variants(url, &playlist)?;
        let duration = parse_media_duration(&playlist);
        let title = url
            .split('/')
            .last()
            .unwrap_or("m3u8")
            .split('?')
            .next()
            .unwrap_or("m3u8")
            .to_string();

        let formats = if variants.is_empty() {
            vec![VideoFormat {
                quality: "原始 M3U8".to_string(),
                url: url.to_string(),
                preview_url: Some(url.to_string()),
                audio_url: None,
                size: None,
            }]
        } else {
            variants
                .into_iter()
                .map(|variant| VideoFormat {
                    quality: variant_quality(&variant),
                    url: variant.uri,
                    preview_url: None,
                    audio_url: None,
                    size: None,
                })
                .collect()
        };

        Ok(VideoInfo {
            title,
            cover_url: None,
            duration,
            platform: "m3u8".to_string(),
            formats,
            kind: VideoKind::Video,
            items: Vec::<VideoItem>::new(),
            login_required: false,
            message: None,
            uploader: None,
        })
    }
}

async fn fetch_playlist(client: &reqwest::Client, url: &str) -> Result<String, String> {
    let text = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("M3U8 请求失败: {e}"))?
        .text()
        .await
        .map_err(|e| format!("读取 M3U8 响应失败: {e}"))?;

    if !text.contains("#EXTM3U") {
        return Err("链接不是有效的 M3U8 播放列表".to_string());
    }
    Ok(text)
}

fn parse_master_variants(base_url: &str, playlist: &str) -> Result<Vec<StreamVariant>, String> {
    let mut variants = Vec::new();
    let mut pending_inf: Option<String> = None;

    for line in playlist
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
    {
        if let Some(attrs) = line.strip_prefix("#EXT-X-STREAM-INF:") {
            pending_inf = Some(attrs.to_string());
            continue;
        }

        if line.starts_with('#') {
            continue;
        }

        if let Some(attrs) = pending_inf.take() {
            variants.push(StreamVariant {
                uri: absolutize_url(base_url, line)?,
                bandwidth: parse_attr(&attrs, "BANDWIDTH").and_then(|v| v.parse().ok()),
                resolution: parse_attr(&attrs, "RESOLUTION"),
                name: parse_attr(&attrs, "NAME"),
            });
        }
    }

    variants.sort_by_key(|variant| {
        std::cmp::Reverse((
            resolution_pixels(variant.resolution.as_deref()).unwrap_or(0),
            variant.bandwidth.unwrap_or(0),
        ))
    });
    Ok(variants)
}

fn parse_media_duration(playlist: &str) -> Option<u64> {
    let total = playlist
        .lines()
        .filter_map(|line| line.trim().strip_prefix("#EXTINF:"))
        .filter_map(|value| value.split(',').next())
        .filter_map(|seconds| seconds.parse::<f64>().ok())
        .sum::<f64>();

    if total > 0.0 {
        Some(total.round() as u64)
    } else {
        None
    }
}

fn parse_attr(attrs: &str, key: &str) -> Option<String> {
    attrs.split(',').find_map(|part| {
        let (name, value) = part.split_once('=')?;
        if name.trim() == key {
            Some(value.trim().trim_matches('"').to_string())
        } else {
            None
        }
    })
}

fn absolutize_url(base_url: &str, uri: &str) -> Result<String, String> {
    if uri.starts_with("http://") || uri.starts_with("https://") {
        return Ok(uri.to_string());
    }
    let base = url::Url::parse(base_url).map_err(|e| format!("M3U8 URL 无效: {e}"))?;
    base.join(uri)
        .map(|url| url.to_string())
        .map_err(|e| format!("M3U8 子播放列表 URL 无效: {e}"))
}

fn variant_quality(variant: &StreamVariant) -> String {
    if let Some(resolution) = &variant.resolution {
        let height = resolution
            .split_once('x')
            .and_then(|(_, height)| height.parse::<u64>().ok());
        if let Some(height) = height {
            return format!("{height}P");
        }
        return resolution.clone();
    }
    if let Some(name) = &variant.name {
        return name.clone();
    }
    if let Some(bandwidth) = variant.bandwidth {
        return format!("{} kbps", bandwidth / 1000);
    }
    "M3U8".to_string()
}

fn resolution_pixels(resolution: Option<&str>) -> Option<u64> {
    let (width, height) = resolution?.split_once('x')?;
    Some(width.parse::<u64>().ok()? * height.parse::<u64>().ok()?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_and_sorts_master_variants() {
        let playlist = r#"#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360
low/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1920x1080
high/index.m3u8
"#;

        let variants = parse_master_variants("https://example.com/live/master.m3u8", playlist)
            .expect("variants");
        assert_eq!(variants.len(), 2);
        assert_eq!(variant_quality(&variants[0]), "1080P");
        assert_eq!(variants[0].uri, "https://example.com/live/high/index.m3u8");
    }

    #[test]
    fn sums_media_playlist_duration() {
        let playlist = r#"#EXTM3U
#EXTINF:4.2,
0.ts
#EXTINF:5.8,
1.ts
"#;
        assert_eq!(parse_media_duration(playlist), Some(10));
    }
}
