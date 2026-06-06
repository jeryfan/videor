use super::{header_map_to_hash_map, VideoFormat, VideoInfo, VideoItem, VideoKind, VideoParser};
use reqwest::header::HeaderMap;
use once_cell::sync::Lazy;

static VIDEO_EXT_REGEX: Lazy<regex::Regex> = Lazy::new(|| {
    regex::Regex::new(r"\.(mp4|webm|ogg|mov|m4v|mkv|flv|ts)(\?.*)?(#.*)?$").expect("valid regex")
});

pub struct DirectParser;

#[async_trait::async_trait]
impl VideoParser for DirectParser {
    fn can_handle(&self, url: &str) -> bool {
        VIDEO_EXT_REGEX.is_match(url)
    }

    async fn parse(&self, url: &str, _client: &reqwest::Client) -> Result<VideoInfo, String> {
        self.parse_with_headers(url, _client, None).await
    }

    async fn parse_with_headers(
        &self,
        url: &str,
        _client: &reqwest::Client,
        headers: Option<&HeaderMap>,
    ) -> Result<VideoInfo, String> {
        let title = url
            .split('/')
            .next_back()
            .unwrap_or("视频")
            .split('?')
            .next()
            .unwrap_or("视频")
            .split('#')
            .next()
            .unwrap_or("视频")
            .to_string();

        let format_headers = headers.map(header_map_to_hash_map).unwrap_or_default();

        Ok(VideoInfo {
            title,
            cover_url: None,
            duration: None,
            platform: "direct".to_string(),
            formats: vec![VideoFormat {
                quality: "original".to_string(),
                url: url.to_string(),
                preview_url: None,
                audio_url: None,
                size: None,
                headers: format_headers,
            }],
            kind: VideoKind::Video,
            items: Vec::<VideoItem>::new(),
            login_required: false,
            message: None,
            uploader: None,
        })
    }
}
