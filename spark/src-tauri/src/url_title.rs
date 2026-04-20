/// Fetches the `<title>` of a web page.
/// Used for Smart Paste: when the clipboard is a URL, we turn it into
/// "Page Title — https://url #link" instead of a raw link.
///
/// This runs on the Tauri async runtime — no blocking calls.

use reqwest::Client;

/// Returns `Some(title)` if we could fetch and parse the title within the timeout,
/// `None` otherwise (e.g. network error, non-HTML content, missing title tag).
pub async fn fetch_url_title(url: &str) -> Option<String> {
    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        // Pretend to be a browser so servers don't block us
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
        .build()
        .ok()?;

    let response = client.get(url).send().await.ok()?;

    // Only proceed if content-type looks like HTML
    let ct = response
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_lowercase();
    if !ct.contains("html") { return None; }

    // Read only up to 32 KB — title is always near the top
    let bytes = response.bytes().await.ok()?;
    let chunk = &bytes[..bytes.len().min(32 * 1024)];
    let html  = String::from_utf8_lossy(chunk);

    extract_title(&html)
}

/// Extracts `<title>…</title>` from raw HTML (no external parser needed).
fn extract_title(html: &str) -> Option<String> {
    let lower = html.to_lowercase();
    let start = lower.find("<title")?;
    let open  = html[start..].find('>')? + start + 1;
    let end   = lower[open..].find("</title>")? + open;

    let raw = &html[open..end];
    // Decode common HTML entities
    let title = raw
        .replace("&amp;",  "&")
        .replace("&lt;",   "<")
        .replace("&gt;",   ">")
        .replace("&quot;", "\"")
        .replace("&#39;",  "'")
        .replace("&nbsp;", " ");

    // Collapse whitespace
    let title: String = title
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .trim()
        .to_string();

    if title.is_empty() { None } else { Some(title) }
}

/// Returns true if the string looks like an HTTP(S) URL.
pub fn looks_like_url(s: &str) -> bool {
    let t = s.trim();
    // Single-line, no spaces (URLs with spaces are rare and usually broken)
    !t.contains('\n') &&
    !t.contains(' ')  &&
    (t.starts_with("http://") || t.starts_with("https://"))
}