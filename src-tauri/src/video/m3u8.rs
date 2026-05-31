use super::{
    header_map_to_hash_map, stream_proxy, VideoFormat, VideoInfo, VideoItem, VideoKind, VideoParser,
};
use reqwest::header::HeaderMap;

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
        self.parse_with_headers(url, client, None).await
    }

    async fn parse_with_headers(
        &self,
        url: &str,
        client: &reqwest::Client,
        headers: Option<&HeaderMap>,
    ) -> Result<VideoInfo, String> {
        let playlist = fetch_playlist(client, url, headers).await?;
        let variants = parse_master_variants(url, &playlist)?;
        let duration = parse_media_duration(&playlist);
        let format_headers = headers.map(header_map_to_hash_map).unwrap_or_default();
        let preview_url = if format_headers.is_empty() {
            url.to_string()
        } else {
            stream_proxy::proxy_hls_url_for(url, &format_headers)
                .await
                .unwrap_or_else(|_| url.to_string())
        };
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
                preview_url: Some(preview_url),
                audio_url: None,
                size: None,
                headers: format_headers.clone(),
            }]
        } else {
            variants
                .into_iter()
                .map(|variant| VideoFormat {
                    quality: variant_quality(&variant),
                    url: variant.uri,
                    preview_url: Some(preview_url.clone()),
                    audio_url: None,
                    size: None,
                    headers: format_headers.clone(),
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

pub async fn parse_m3u8_input(
    input: &str,
    client: &reqwest::Client,
    headers: Option<&HeaderMap>,
) -> Result<VideoInfo, String> {
    let url = super::extract_url_from_text(input).unwrap_or_else(|| input.trim().to_string());
    if url.contains(".m3u8") {
        return M3u8Parser.parse_with_headers(&url, client, headers).await;
    }

    let candidates = discover_m3u8_urls(client, &url, headers).await?;
    match candidates.len() {
        0 => Err("该网页中没有发现 M3U8 地址".to_string()),
        1 => {
            M3u8Parser
                .parse_with_headers(&candidates[0], client, headers)
                .await
        }
        _ => Ok(VideoInfo {
            title: "发现多个 M3U8 地址".to_string(),
            cover_url: None,
            duration: None,
            platform: "m3u8".to_string(),
            formats: Vec::new(),
            kind: VideoKind::Collection,
            items: candidates
                .iter()
                .enumerate()
                .map(|(index, url)| VideoItem {
                    id: format!("m3u8_{}", index + 1),
                    title: m3u8_candidate_title(index, url),
                    url: url.clone(),
                    bvid: None,
                    cid: None,
                    page: None,
                    duration: None,
                    cover_url: None,
                })
                .collect(),
            login_required: false,
            message: Some("请选择一个 M3U8 地址继续解析".to_string()),
            uploader: None,
        }),
    }
}

async fn discover_m3u8_urls(
    client: &reqwest::Client,
    page_url: &str,
    headers: Option<&HeaderMap>,
) -> Result<Vec<String>, String> {
    let mut request = client.get(page_url);
    if let Some(headers) = headers {
        request = request.headers(headers.clone());
    }
    let html = request
        .send()
        .await
        .map_err(|e| format!("网页请求失败: {e}"))?
        .error_for_status()
        .map_err(|e| format!("网页响应异常: {e}"))?
        .text()
        .await
        .map_err(|e| format!("读取网页失败: {e}"))?;

    extract_m3u8_urls(page_url, &html)
}

fn extract_m3u8_urls(base_url: &str, content: &str) -> Result<Vec<String>, String> {
    let base = url::Url::parse(base_url).map_err(|e| format!("网页 URL 无效: {e}"))?;
    let normalized = content
        .replace("\\/", "/")
        .replace("&amp;", "&")
        .replace("\\u002F", "/")
        .replace("\\u002f", "/");
    let re = regex::Regex::new(r#"(?i)(https?:)?//[^\s"'<>\\]+?\.m3u8[^\s"'<>\\]*|/[^\s"'<>\\]+?\.m3u8[^\s"'<>\\]*|[A-Za-z0-9._~!$&'()*+,;=:@%/-]+?\.m3u8[^\s"'<>\\]*"#)
        .map_err(|e| e.to_string())?;
    let mut urls = Vec::new();

    for matched in re.find_iter(&normalized) {
        let raw = matched
            .as_str()
            .trim_matches(|c| matches!(c, ')' | ']' | '}'));
        let absolute = if raw.starts_with("//") {
            format!("{}:{raw}", base.scheme())
        } else if raw.starts_with("http://") || raw.starts_with("https://") {
            raw.to_string()
        } else {
            base.join(raw)
                .map_err(|e| format!("M3U8 地址无效: {e}"))?
                .to_string()
        };
        if !urls.contains(&absolute) {
            urls.push(absolute);
        }
    }

    Ok(urls)
}

fn m3u8_candidate_title(index: usize, url: &str) -> String {
    let file = url
        .split('/')
        .last()
        .and_then(|value| value.split('?').next())
        .filter(|value| !value.is_empty())
        .unwrap_or("video.m3u8");
    format!("线路 {} · {}", index + 1, file)
}

async fn fetch_playlist(
    client: &reqwest::Client,
    url: &str,
    headers: Option<&HeaderMap>,
) -> Result<String, String> {
    let mut request = client.get(url);
    if let Some(headers) = headers {
        request = request.headers(headers.clone());
    }
    let text = request
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

    #[test]
    fn extracts_m3u8_urls_from_page_content() {
        let html = r#"
<script>
window.__data = {
  main: "https:\/\/cdn.example.com\/live\/master.m3u8?token=abc",
  duplicate: "https://cdn.example.com/live/master.m3u8?token=abc",
  protocolRelative: "//media.example.com/hls/720p/video.m3u8",
  relativeRoot: "/streams/480p/video.m3u8",
  relativeFile: "backup/video.m3u8",
  unicodeEscaped: "https:\u002F\u002Fcdn.example.com\u002Fescaped\u002Findex.m3u8"
}
</script>
"#;

        let urls = extract_m3u8_urls("https://site.example.com/watch/123", html).expect("urls");

        assert_eq!(
            urls,
            vec![
                "https://cdn.example.com/live/master.m3u8?token=abc",
                "https://media.example.com/hls/720p/video.m3u8",
                "https://site.example.com/streams/480p/video.m3u8",
                "https://site.example.com/watch/backup/video.m3u8",
                "https://cdn.example.com/escaped/index.m3u8",
            ]
        );
    }
}
