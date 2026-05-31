use super::{VideoFormat, VideoInfo, VideoItem, VideoKind, VideoParser};

pub struct DirectParser;

#[async_trait::async_trait]
impl VideoParser for DirectParser {
    fn can_handle(&self, url: &str) -> bool {
        let video_ext_regex = regex::Regex::new(r"\.(mp4|webm|ogg|mov)(\?.*)?$").unwrap();
        video_ext_regex.is_match(url)
    }

    async fn parse(&self, url: &str, _client: &reqwest::Client) -> Result<VideoInfo, String> {
        // 直链视频无需解析，直接返回
        let title = url
            .split('/')
            .last()
            .unwrap_or("视频")
            .split('?')
            .next()
            .unwrap_or("视频")
            .to_string();

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
                headers: Default::default(),
            }],
            kind: VideoKind::Video,
            items: Vec::<VideoItem>::new(),
            login_required: false,
            message: None,
            uploader: None,
        })
    }
}
