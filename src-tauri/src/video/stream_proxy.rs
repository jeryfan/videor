use super::bilibili::{load_cookie_header, BILI_REFERER, BILI_UA};
use reqwest::header::{
    CONTENT_LENGTH, CONTENT_RANGE, CONTENT_TYPE, COOKIE, RANGE, REFERER, USER_AGENT,
};
use std::collections::HashMap;
use tauri::http::{header, Request, Response, StatusCode};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::OnceCell;

const STREAM_CHUNK_SIZE: u64 = 1024 * 1024;
static LOCAL_PROXY_PORT: OnceCell<u16> = OnceCell::const_new();

pub async fn proxy_url_for(upstream_url: &str) -> Result<String, String> {
    let port = ensure_local_http_proxy().await?;
    Ok(format!(
        "http://127.0.0.1:{port}/video?url={}",
        percent_encode(upstream_url)
    ))
}

pub async fn build_stream_response(request: Request<Vec<u8>>) -> Response<Vec<u8>> {
    let uri = request.uri().clone();
    let Some(raw_url) = uri.query().and_then(|query| {
        query
            .split('&')
            .find_map(|pair| pair.strip_prefix("url=").map(percent_decode))
    }) else {
        return text_response(StatusCode::BAD_REQUEST, "missing url");
    };

    let range = request
        .headers()
        .get(RANGE)
        .and_then(|value| value.to_str().ok())
        .map(str::to_string);

    match fetch_stream(&raw_url, range.as_deref()).await {
        Ok(response) => response,
        Err(error) => text_response(StatusCode::BAD_GATEWAY, &error),
    }
}

async fn fetch_stream(url: &str, range: Option<&str>) -> Result<Response<Vec<u8>>, String> {
    if !is_allowed_video_url(url) {
        return Ok(text_response(
            StatusCode::FORBIDDEN,
            "unsupported stream host",
        ));
    }

    let client = reqwest::Client::builder()
        .user_agent(BILI_UA)
        .redirect(reqwest::redirect::Policy::limited(5))
        .build()
        .map_err(|e| e.to_string())?;
    let mut req = client
        .get(url)
        .header(USER_AGENT, BILI_UA)
        .header(REFERER, BILI_REFERER);

    let upstream_range = bounded_range(range);
    req = req.header(RANGE, upstream_range);

    let cookie = load_cookie_header().unwrap_or_default();
    if !cookie.is_empty() {
        req = req.header(COOKIE, cookie);
    }

    let upstream = req.send().await.map_err(|e| e.to_string())?;
    let status = upstream.status();
    let headers = upstream.headers().clone();
    let body = upstream.bytes().await.map_err(|e| e.to_string())?.to_vec();

    let mut builder = Response::builder()
        .status(StatusCode::from_u16(status.as_u16()).unwrap_or(StatusCode::OK))
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .header(header::ACCEPT_RANGES, "bytes");

    if let Some(value) = headers.get(CONTENT_TYPE).and_then(|v| v.to_str().ok()) {
        builder = builder.header(header::CONTENT_TYPE, value);
    } else {
        builder = builder.header(header::CONTENT_TYPE, "video/mp4");
    }
    if let Some(value) = headers.get(CONTENT_LENGTH).and_then(|v| v.to_str().ok()) {
        builder = builder.header(header::CONTENT_LENGTH, value);
    }
    if let Some(value) = headers.get(CONTENT_RANGE).and_then(|v| v.to_str().ok()) {
        builder = builder.header(header::CONTENT_RANGE, value);
    }

    Ok(builder.body(body).unwrap_or_else(|_| {
        text_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            "failed to build response",
        )
    }))
}

async fn ensure_local_http_proxy() -> Result<u16, String> {
    LOCAL_PROXY_PORT
        .get_or_try_init(|| async {
            let listener = TcpListener::bind("127.0.0.1:0")
                .await
                .map_err(|e| format!("启动本地视频代理失败: {e}"))?;
            let port = listener
                .local_addr()
                .map_err(|e| format!("读取本地视频代理端口失败: {e}"))?
                .port();

            tauri::async_runtime::spawn(async move {
                loop {
                    match listener.accept().await {
                        Ok((stream, _)) => {
                            tauri::async_runtime::spawn(handle_http_connection(stream));
                        }
                        Err(error) => {
                            log::warn!("本地视频代理接收连接失败: {error}");
                            break;
                        }
                    }
                }
            });

            Ok(port)
        })
        .await
        .copied()
}

async fn handle_http_connection(mut stream: TcpStream) {
    let response = match read_http_request(&mut stream).await {
        Ok((path, headers)) if path.starts_with("/video?") => {
            let raw_url = path
                .split_once('?')
                .and_then(|(_, query)| {
                    query
                        .split('&')
                        .find_map(|pair| pair.strip_prefix("url=").map(percent_decode))
                })
                .ok_or_else(|| "missing url".to_string())
                .map(|url| (url, headers.get("range").cloned()));

            match raw_url {
                Ok((url, range)) => fetch_stream(&url, range.as_deref())
                    .await
                    .unwrap_or_else(|error| text_response(StatusCode::BAD_GATEWAY, &error)),
                Err(error) => text_response(StatusCode::BAD_REQUEST, &error),
            }
        }
        Ok(_) => text_response(StatusCode::NOT_FOUND, "not found"),
        Err(error) => text_response(StatusCode::BAD_REQUEST, &error),
    };

    let bytes = http_response_bytes(response);
    let _ = stream.write_all(&bytes).await;
    let _ = stream.shutdown().await;
}

async fn read_http_request(
    stream: &mut TcpStream,
) -> Result<(String, HashMap<String, String>), String> {
    let mut buffer = vec![0_u8; 16 * 1024];
    let mut read = 0_usize;

    loop {
        if read == buffer.len() {
            return Err("request header too large".to_string());
        }
        let n = stream
            .read(&mut buffer[read..])
            .await
            .map_err(|e| e.to_string())?;
        if n == 0 {
            return Err("empty request".to_string());
        }
        read += n;
        if buffer[..read]
            .windows(4)
            .any(|window| window == b"\r\n\r\n")
        {
            break;
        }
    }

    let request = String::from_utf8_lossy(&buffer[..read]);
    let mut lines = request.lines();
    let request_line = lines
        .next()
        .ok_or_else(|| "missing request line".to_string())?;
    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or_default();
    let path = parts.next().unwrap_or_default();

    if method != "GET" && method != "HEAD" {
        return Err("unsupported method".to_string());
    }

    let mut headers = HashMap::new();
    for line in lines {
        if line.is_empty() {
            break;
        }
        if let Some((name, value)) = line.split_once(':') {
            headers.insert(name.trim().to_ascii_lowercase(), value.trim().to_string());
        }
    }

    Ok((path.to_string(), headers))
}

fn http_response_bytes(response: Response<Vec<u8>>) -> Vec<u8> {
    let status = response.status();
    let reason = status.canonical_reason().unwrap_or("");
    let headers = response.headers().clone();
    let body = response.into_body();
    let mut output = format!("HTTP/1.1 {} {}\r\n", status.as_u16(), reason).into_bytes();

    for (name, value) in headers.iter() {
        if let Ok(value) = value.to_str() {
            output.extend_from_slice(name.as_str().as_bytes());
            output.extend_from_slice(b": ");
            output.extend_from_slice(value.as_bytes());
            output.extend_from_slice(b"\r\n");
        }
    }
    output.extend_from_slice(b"Connection: close\r\n\r\n");
    output.extend_from_slice(&body);
    output
}

fn is_allowed_video_url(url: &str) -> bool {
    url.starts_with("https://")
        && (url.contains(".bilivideo.com")
            || url.contains("bilivideo.cn")
            || url.contains("bilibili.com"))
}

fn bounded_range(range: Option<&str>) -> String {
    let Some(range) = range else {
        return format!("bytes=0-{}", STREAM_CHUNK_SIZE - 1);
    };
    let Some(spec) = range.trim().strip_prefix("bytes=") else {
        return format!("bytes=0-{}", STREAM_CHUNK_SIZE - 1);
    };
    let Some((start, end)) = spec.split_once('-') else {
        return format!("bytes=0-{}", STREAM_CHUNK_SIZE - 1);
    };
    let Ok(start) = start.trim().parse::<u64>() else {
        return range.to_string();
    };

    let max_end = start.saturating_add(STREAM_CHUNK_SIZE - 1);
    let end = end
        .trim()
        .parse::<u64>()
        .ok()
        .map(|value| value.min(max_end))
        .unwrap_or(max_end);

    format!("bytes={start}-{end}")
}

fn text_response(status: StatusCode, text: &str) -> Response<Vec<u8>> {
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, "text/plain; charset=utf-8")
        .body(text.as_bytes().to_vec())
        .unwrap()
}

fn percent_decode(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'%' if i + 2 < bytes.len() => {
                if let (Some(high), Some(low)) = (hex_value(bytes[i + 1]), hex_value(bytes[i + 2]))
                {
                    out.push((high << 4) | low);
                    i += 3;
                    continue;
                }
                out.push(bytes[i]);
                i += 1;
            }
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            byte => {
                out.push(byte);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).to_string()
}

fn percent_encode(input: &str) -> String {
    let mut output = String::new();
    for byte in input.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                output.push(byte as char)
            }
            _ => output.push_str(&format!("%{byte:02X}")),
        }
    }
    output
}

fn hex_value(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bounded_range_defaults_to_first_chunk() {
        assert_eq!(bounded_range(None), "bytes=0-1048575");
    }

    #[test]
    fn bounded_range_caps_open_ended_request() {
        assert_eq!(
            bounded_range(Some("bytes=1048576-")),
            "bytes=1048576-2097151"
        );
    }

    #[test]
    fn bounded_range_keeps_smaller_explicit_request() {
        assert_eq!(bounded_range(Some("bytes=100-199")), "bytes=100-199");
    }
}
