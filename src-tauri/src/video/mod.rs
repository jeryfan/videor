pub mod bilibili;
pub mod direct;
pub mod douyin;
pub mod downloader;
pub mod m3u8;
pub mod stream_proxy;

use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// 视频信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VideoInfo {
    pub title: String,
    pub cover_url: Option<String>,
    pub duration: Option<u64>,
    pub platform: String,
    pub formats: Vec<VideoFormat>,
    #[serde(default)]
    pub kind: VideoKind,
    #[serde(default)]
    pub items: Vec<VideoItem>,
    #[serde(default)]
    pub login_required: bool,
    #[serde(default)]
    pub message: Option<String>,
    #[serde(default)]
    pub uploader: Option<String>,
}

/// 视频格式/清晰度
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VideoFormat {
    pub quality: String,
    pub url: String,
    #[serde(default)]
    pub preview_url: Option<String>,
    pub audio_url: Option<String>,
    pub size: Option<u64>,
    #[serde(default)]
    pub headers: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum VideoKind {
    #[default]
    Video,
    Multipart,
    Collection,
    ChargingCollection,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VideoItem {
    pub id: String,
    pub title: String,
    pub url: String,
    pub bvid: Option<String>,
    pub cid: Option<u64>,
    pub page: Option<u64>,
    pub duration: Option<u64>,
    pub cover_url: Option<String>,
}

#[async_trait::async_trait]
pub trait VideoParser: Send + Sync {
    fn can_handle(&self, url: &str) -> bool;
    async fn parse(&self, url: &str, client: &reqwest::Client) -> Result<VideoInfo, String>;
    async fn parse_with_headers(
        &self,
        url: &str,
        client: &reqwest::Client,
        _headers: Option<&HeaderMap>,
    ) -> Result<VideoInfo, String> {
        self.parse(url, client).await
    }
}

/// 解析视频链接（入口函数）
///
/// 自动从分享文本中提取 URL，然后分发给对应平台的解析器
pub async fn parse_video_url(input: &str) -> Result<VideoInfo, String> {
    parse_video_url_with_headers(input, None).await
}

pub async fn parse_video_url_with_curl(input: &str, raw_curl: &str) -> Result<VideoInfo, String> {
    let headers = parse_curl_headers(raw_curl)?;
    let headers = (!headers.is_empty()).then_some(headers);
    parse_video_url_with_headers(input, headers.as_ref()).await
}

pub async fn parse_video_url_with_headers(
    input: &str,
    headers: Option<&HeaderMap>,
) -> Result<VideoInfo, String> {
    let url = extract_url_from_text(input).unwrap_or_else(|| input.trim().to_string());

    let client = create_http_client();

    let parsers: Vec<Box<dyn VideoParser>> = vec![
        Box::new(douyin::DouyinParser),
        Box::new(bilibili::BilibiliParser),
        Box::new(m3u8::M3u8Parser),
        Box::new(direct::DirectParser),
    ];

    for parser in &parsers {
        if parser.can_handle(&url) {
            return parser.parse_with_headers(&url, &client, headers).await;
        }
    }

    Err(format!(
        "不支持的链接格式。当前支持：抖音、B站、视频直链（mp4/webm/m3u8 等）"
    ))
}

pub fn parse_curl_headers(raw_curl: &str) -> Result<HeaderMap, String> {
    let args = tokenize_curl_command(raw_curl)?;
    if args.first().map(|arg| arg.as_str()) != Some("curl") {
        return Err("请从浏览器 Network 面板使用 Copy as cURL 后粘贴完整 curl 命令".to_string());
    }

    let mut headers = HeaderMap::new();
    let mut index = 0;

    while index < args.len() {
        let arg = args[index].as_str();
        let header = if matches!(arg, "-H" | "--header") {
            index += 1;
            args.get(index).map(String::as_str)
        } else if let Some(header) = arg.strip_prefix("-H") {
            (!header.is_empty()).then_some(header)
        } else {
            arg.strip_prefix("--header=")
        };

        if let Some(header) = header {
            insert_header_line(&mut headers, header)?;
        }

        index += 1;
    }

    Ok(headers)
}

fn insert_header_line(headers: &mut HeaderMap, line: &str) -> Result<(), String> {
    let Some((name, value)) = line.split_once(':') else {
        return Ok(());
    };
    let name = name.trim();
    let value = value.trim();
    if name.is_empty() || value.is_empty() || should_drop_header(name) {
        return Ok(());
    }

    let header_name = HeaderName::from_bytes(name.as_bytes())
        .map_err(|_| format!("无效的 Header 名称: {name}"))?;
    let header_value =
        HeaderValue::from_str(value).map_err(|_| format!("无效的 Header 值: {name}"))?;
    headers.insert(header_name, header_value);
    Ok(())
}

fn tokenize_curl_command(raw: &str) -> Result<Vec<String>, String> {
    let normalized = raw.replace("\\\r\n", " ").replace("\\\n", " ");
    let mut args = Vec::new();
    let mut current = String::new();
    let mut chars = normalized.chars().peekable();
    let mut quote: Option<char> = None;

    while let Some(ch) = chars.next() {
        match quote {
            Some(q) if ch == q => quote = None,
            Some('"') if ch == '\\' => {
                if let Some(next) = chars.next() {
                    current.push(next);
                }
            }
            Some(_) => current.push(ch),
            None if ch == '\'' || ch == '"' => quote = Some(ch),
            None if ch == '\\' => {
                if let Some(next) = chars.next() {
                    current.push(next);
                }
            }
            None if ch.is_whitespace() => {
                if !current.is_empty() {
                    args.push(std::mem::take(&mut current));
                }
            }
            None => current.push(ch),
        }
    }

    if quote.is_some() {
        return Err("curl 命令引号不完整，请重新复制完整命令".to_string());
    }
    if !current.is_empty() {
        args.push(current);
    }
    Ok(args)
}

pub fn header_map_to_hash_map(headers: &HeaderMap) -> HashMap<String, String> {
    headers
        .iter()
        .filter_map(|(name, value)| {
            value
                .to_str()
                .ok()
                .map(|value| (name.as_str().to_string(), value.to_string()))
        })
        .collect()
}

pub fn hash_map_to_header_map(headers: &HashMap<String, String>) -> HeaderMap {
    let mut header_map = HeaderMap::new();
    for (name, value) in headers {
        if should_drop_header(name) {
            continue;
        }
        let Ok(header_name) = HeaderName::from_bytes(name.as_bytes()) else {
            continue;
        };
        let Ok(header_value) = HeaderValue::from_str(value) else {
            continue;
        };
        header_map.insert(header_name, header_value);
    }
    header_map
}

fn should_drop_header(name: &str) -> bool {
    matches!(
        name.to_ascii_lowercase().as_str(),
        "host"
            | "authority"
            | "method"
            | "path"
            | "scheme"
            | "content-length"
            | "connection"
            | "transfer-encoding"
            | "accept-encoding"
            | "upgrade"
            | "proxy-connection"
    )
}

/// 从分享文本中提取第一个 HTTP(S) URL
pub fn extract_url_from_text(text: &str) -> Option<String> {
    let re = regex::Regex::new(r"https?://[^\s\u{4e00}-\u{9fff}\u{ff01}-\u{ff5e}]+").ok()?;
    re.find(text).map(|m| {
        m.as_str()
            .trim_end_matches(|c: char| ",.;:!?，。；：！？)）】》".contains(c))
            .to_string()
    })
}

/// 创建共享 HTTP 客户端
pub fn create_http_client() -> reqwest::Client {
    reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
        .redirect(reqwest::redirect::Policy::limited(10))
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .expect("failed to build http client")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_curl_headers_and_filters_transport_fields() {
        let headers = parse_curl_headers(
            r#"curl 'https://example.com/list' \
  -H 'Host: example.com' \
  -H 'Content-Length: 123' \
  -H 'Connection: keep-alive' \
  -H 'Referer: https://example.com/page' \
  -H 'User-Agent: Mozilla/5.0' \
  -H 'Cookie: sid=abc'
"#,
        )
        .expect("headers");

        assert!(headers.get("host").is_none());
        assert!(headers.get("content-length").is_none());
        assert!(headers.get("connection").is_none());
        assert_eq!(
            headers.get("referer").and_then(|value| value.to_str().ok()),
            Some("https://example.com/page")
        );
        assert_eq!(
            headers
                .get("user-agent")
                .and_then(|value| value.to_str().ok()),
            Some("Mozilla/5.0")
        );
        assert_eq!(
            headers.get("cookie").and_then(|value| value.to_str().ok()),
            Some("sid=abc")
        );
    }

    #[test]
    fn parses_headers_from_chrome_curl() {
        let headers = parse_curl_headers(
            r#"curl 'https://surrit.com/480p/video.m3u8' \
  -H 'authority: surrit.com' \
  -H 'accept: */*' \
  -H 'accept-encoding: gzip, deflate, br, zstd' \
  -H 'origin: https://example.org' \
  -H 'referer: https://example.org/video' \
  -H 'sec-fetch-site: cross-site' \
  -H 'user-agent: Mozilla/5.0'
"#,
        )
        .expect("headers");

        assert!(headers.get("authority").is_none());
        assert!(headers.get("accept-encoding").is_none());
        assert_eq!(
            headers.get("accept").and_then(|value| value.to_str().ok()),
            Some("*/*")
        );
        assert_eq!(
            headers.get("origin").and_then(|value| value.to_str().ok()),
            Some("https://example.org")
        );
        assert_eq!(
            headers.get("referer").and_then(|value| value.to_str().ok()),
            Some("https://example.org/video")
        );
        assert_eq!(
            headers
                .get("user-agent")
                .and_then(|value| value.to_str().ok()),
            Some("Mozilla/5.0")
        );
    }

    #[test]
    fn rejects_incomplete_devtools_name_value_copy() {
        let error = parse_curl_headers(
            r#"authority
example.com
referer
https://example.org/video
"#,
        )
        .expect_err("should reject non-curl copy");

        assert!(error.contains("Copy as cURL"));
    }
}
