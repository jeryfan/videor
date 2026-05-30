pub mod bilibili;
pub mod direct;
pub mod douyin;
pub mod downloader;

use serde::{Deserialize, Serialize};

/// 视频信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VideoInfo {
    pub title: String,
    pub cover_url: Option<String>,
    pub duration: Option<u64>,
    pub platform: String,
    pub formats: Vec<VideoFormat>,
}

/// 视频格式/清晰度
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VideoFormat {
    pub quality: String,
    pub url: String,
    pub audio_url: Option<String>,
    pub size: Option<u64>,
}

#[async_trait::async_trait]
pub trait VideoParser: Send + Sync {
    fn can_handle(&self, url: &str) -> bool;
    async fn parse(&self, url: &str, client: &reqwest::Client) -> Result<VideoInfo, String>;
}

/// 解析视频链接（入口函数）
///
/// 自动从分享文本中提取 URL，然后分发给对应平台的解析器
pub async fn parse_video_url(input: &str) -> Result<VideoInfo, String> {
    let url = extract_url_from_text(input).unwrap_or_else(|| input.trim().to_string());

    let client = create_http_client();

    let parsers: Vec<Box<dyn VideoParser>> = vec![
        Box::new(douyin::DouyinParser),
        Box::new(bilibili::BilibiliParser),
        Box::new(direct::DirectParser),
    ];

    for parser in &parsers {
        if parser.can_handle(&url) {
            return parser.parse(&url, &client).await;
        }
    }

    Err(format!(
        "不支持的链接格式。当前支持：抖音、B站、视频直链（mp4/webm/m3u8 等）"
    ))
}

/// 从分享文本中提取第一个 HTTP(S) URL
fn extract_url_from_text(text: &str) -> Option<String> {
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
