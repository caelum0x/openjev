use crate::native;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::thread;

const MODELS: &str = r#"{"object":"list","data":[
{"id":"system-one","label":"System One"},
{"id":"openjev-v13","label":"OpenJev V13"},
{"id":"rlhf","label":"RLHF"},
{"id":"rlcd","label":"RLCD"}
]}"#;

pub fn serve(addr: &str) -> std::io::Result<()> {
    let listener = TcpListener::bind(addr)?;
    listener.set_nonblocking(false)?;
    eprintln!("openjev engine {} on http://{addr}", native::version());
    for stream in listener.incoming() {
        match stream {
            Ok(s) => {
                thread::spawn(move || {
                    if let Err(e) = handle(s) {
                        eprintln!("conn: {e}");
                    }
                });
            }
            Err(e) => eprintln!("accept: {e}"),
        }
    }
    Ok(())
}

fn handle(mut stream: TcpStream) -> std::io::Result<()> {
    stream.set_read_timeout(Some(std::time::Duration::from_secs(15)))?;
    let mut buf = Vec::with_capacity(8192);
    let mut tmp = [0u8; 4096];
    loop {
        let n = stream.read(&mut tmp)?;
        if n == 0 {
            return Ok(());
        }
        buf.extend_from_slice(&tmp[..n]);
        if let Some(header_end) = find_double_crlf(&buf) {
            let headers = std::str::from_utf8(&buf[..header_end])
                .unwrap_or("")
                .to_string();
            let content_len = content_length(&headers);
            let body_start = header_end + 4;
            while buf.len() < body_start + content_len {
                let n = stream.read(&mut tmp)?;
                if n == 0 {
                    break;
                }
                buf.extend_from_slice(&tmp[..n]);
            }
            let method_path = headers.lines().next().unwrap_or("").to_string();
            let end = body_start + content_len;
            let body = buf[body_start..end.min(buf.len())].to_vec();
            dispatch(&mut stream, &method_path, &body)?;
            return Ok(());
        }
        if buf.len() > 1_000_000 {
            return write_res(&mut stream, 413, "text/plain", b"too large");
        }
    }
}

fn find_double_crlf(buf: &[u8]) -> Option<usize> {
    buf.windows(4).position(|w| w == b"\r\n\r\n")
}

fn content_length(headers: &str) -> usize {
    for line in headers.lines() {
        let l = line.to_ascii_lowercase();
        if let Some(rest) = l.strip_prefix("content-length:") {
            return rest.trim().parse().unwrap_or(0);
        }
    }
    0
}

fn dispatch(stream: &mut TcpStream, start: &str, body: &[u8]) -> std::io::Result<()> {
    let mut parts = start.split_whitespace();
    let method = parts.next().unwrap_or("");
    let path = parts.next().unwrap_or("/");
    let path = path.split('?').next().unwrap_or(path);

    if method == "GET" && (path == "/health" || path == "/v1/health") {
        let v = native::version();
        let payload = format!("{{\"ok\":true,\"engine\":\"{v}\"}}");
        return write_res(stream, 200, "application/json", payload.as_bytes());
    }
    if method == "GET" && (path == "/v1/models" || path == "/v1") {
        return write_res(stream, 200, "application/json", MODELS.as_bytes());
    }
    if method == "POST" && (path == "/v1/systemone" || path == "/api/v1/systemone") {
        let input = std::str::from_utf8(body).unwrap_or("");
        match native::eval_json(input) {
            Ok(out) => return write_res(stream, 200, "application/json", out.as_bytes()),
            Err(e) => {
                let payload = format!(
                    "{{\"error\":{{\"type\":\"engine_error\",\"message\":{}}}}}",
                    serde_json::to_string(&e).unwrap_or_else(|_| "\"error\"".into())
                );
                return write_res(stream, 400, "application/json", payload.as_bytes());
            }
        }
    }
    write_res(stream, 404, "application/json", b"{\"error\":{\"type\":\"not_found\"}}")
}

fn write_res(stream: &mut TcpStream, status: u16, ctype: &str, body: &[u8]) -> std::io::Result<()> {
    let reason = match status {
        200 => "OK",
        400 => "Bad Request",
        404 => "Not Found",
        413 => "Payload Too Large",
        _ => "Error",
    };
    let head = format!(
        "HTTP/1.1 {status} {reason}\r\nContent-Type: {ctype}\r\nContent-Length: {}\r\nConnection: close\r\nAccess-Control-Allow-Origin: *\r\n\r\n",
        body.len()
    );
    stream.write_all(head.as_bytes())?;
    stream.write_all(body)?;
    stream.flush()
}
