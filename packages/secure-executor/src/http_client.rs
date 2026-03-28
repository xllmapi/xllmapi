use futures_util::StreamExt;
use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION, CONTENT_TYPE};
use serde_json::{json, Value};

pub struct StreamResult {
    pub content: String,
    pub input_tokens: u32,
    pub output_tokens: u32,
    pub total_tokens: u32,
    pub finish_reason: String,
}

pub async fn stream_chat_completion(
    base_url: &str,
    api_key: Option<&str>,
    provider_type: &str,
    model: &str,
    messages_json: &str,
    temperature: Option<f64>,
    max_tokens: Option<u32>,
    on_delta: impl Fn(String),
) -> Result<StreamResult, String> {
    match provider_type {
        "anthropic" => stream_anthropic(base_url, api_key, model, messages_json, temperature, max_tokens, on_delta).await,
        _ => stream_openai_compatible(base_url, api_key, model, messages_json, temperature, max_tokens, on_delta).await,
    }
}

async fn stream_openai_compatible(
    base_url: &str,
    api_key: Option<&str>,
    model: &str,
    messages_json: &str,
    temperature: Option<f64>,
    max_tokens: Option<u32>,
    on_delta: impl Fn(String),
) -> Result<StreamResult, String> {
    let messages: Value = serde_json::from_str(messages_json)
        .map_err(|e| format!("invalid messages JSON: {}", e))?;

    let mut body = json!({
        "model": model,
        "messages": messages,
        "stream": true,
    });
    if let Some(t) = temperature {
        body["temperature"] = json!(t);
    }
    if let Some(m) = max_tokens {
        body["max_tokens"] = json!(m);
    }

    let url = format!("{}/chat/completions", base_url.trim_end_matches('/'));
    let mut headers = HeaderMap::new();
    headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
    if let Some(key) = api_key {
        headers.insert(AUTHORIZATION, HeaderValue::from_str(&format!("Bearer {}", key))
            .map_err(|e| format!("invalid api key header: {}", e))?);
    }

    let client = reqwest::Client::new();
    let resp = client.post(&url).headers(headers).json(&body).send().await
        .map_err(|e| format!("HTTP request failed: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status().as_u16();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("LLM API returned {}: {}", status, text));
    }

    let mut content = String::new();
    let mut input_tokens: u32 = 0;
    let mut output_tokens: u32 = 0;
    let mut finish_reason = String::from("stop");
    let mut stream = resp.bytes_stream();
    let mut buffer = String::new();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("stream read error: {}", e))?;
        buffer.push_str(&String::from_utf8_lossy(&chunk));

        while let Some(line_end) = buffer.find('\n') {
            let line = buffer[..line_end].trim().to_string();
            buffer = buffer[line_end + 1..].to_string();

            if line.is_empty() || line == "data: [DONE]" {
                continue;
            }
            if let Some(data) = line.strip_prefix("data: ") {
                if let Ok(parsed) = serde_json::from_str::<Value>(data) {
                    if let Some(delta) = parsed["choices"][0]["delta"]["content"].as_str() {
                        if !delta.is_empty() {
                            content.push_str(delta);
                            on_delta(delta.to_string());
                        }
                    }
                    if let Some(reason) = parsed["choices"][0]["finish_reason"].as_str() {
                        finish_reason = reason.to_string();
                    }
                    if let Some(usage) = parsed.get("usage") {
                        input_tokens = usage["prompt_tokens"].as_u64().unwrap_or(0) as u32;
                        output_tokens = usage["completion_tokens"].as_u64().unwrap_or(0) as u32;
                    }
                }
            }
        }
    }

    // Estimate tokens if not provided
    if input_tokens == 0 && output_tokens == 0 {
        let msg_len = messages_json.len();
        input_tokens = (msg_len / 4).max(1) as u32;
        output_tokens = (content.len() / 4).max(1) as u32;
    }

    Ok(StreamResult {
        content,
        input_tokens,
        output_tokens,
        total_tokens: input_tokens + output_tokens,
        finish_reason,
    })
}

async fn stream_anthropic(
    base_url: &str,
    api_key: Option<&str>,
    model: &str,
    messages_json: &str,
    temperature: Option<f64>,
    max_tokens: Option<u32>,
    on_delta: impl Fn(String),
) -> Result<StreamResult, String> {
    let messages: Vec<Value> = serde_json::from_str(messages_json)
        .map_err(|e| format!("invalid messages JSON: {}", e))?;

    // Extract system message
    let mut system_text: Option<String> = None;
    let mut conversation: Vec<Value> = Vec::new();
    for msg in &messages {
        if msg["role"].as_str() == Some("system") {
            system_text = msg["content"].as_str().map(String::from);
        } else {
            conversation.push(msg.clone());
        }
    }

    let mut body = json!({
        "model": model,
        "messages": conversation,
        "max_tokens": max_tokens.unwrap_or(4096),
        "stream": true,
    });
    if let Some(sys) = &system_text {
        body["system"] = json!(sys);
    }
    if let Some(t) = temperature {
        body["temperature"] = json!(t);
    }

    let url = format!("{}/v1/messages", base_url.trim_end_matches('/'));
    let mut headers = HeaderMap::new();
    headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
    headers.insert("anthropic-version", HeaderValue::from_static("2023-06-01"));
    if let Some(key) = api_key {
        headers.insert("x-api-key", HeaderValue::from_str(key)
            .map_err(|e| format!("invalid api key header: {}", e))?);
    }

    let client = reqwest::Client::new();
    let resp = client.post(&url).headers(headers).json(&body).send().await
        .map_err(|e| format!("HTTP request failed: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status().as_u16();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("Anthropic API returned {}: {}", status, text));
    }

    let mut content = String::new();
    let mut input_tokens: u32 = 0;
    let mut output_tokens: u32 = 0;
    let mut finish_reason = String::from("end_turn");
    let mut stream = resp.bytes_stream();
    let mut buffer = String::new();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("stream read error: {}", e))?;
        buffer.push_str(&String::from_utf8_lossy(&chunk));

        while let Some(line_end) = buffer.find('\n') {
            let line = buffer[..line_end].trim().to_string();
            buffer = buffer[line_end + 1..].to_string();

            if line.is_empty() {
                continue;
            }
            if let Some(data) = line.strip_prefix("data: ") {
                if let Ok(parsed) = serde_json::from_str::<Value>(data) {
                    let event_type = parsed["type"].as_str().unwrap_or("");
                    match event_type {
                        "message_start" => {
                            if let Some(usage) = parsed["message"]["usage"].as_object() {
                                input_tokens = usage.get("input_tokens")
                                    .and_then(|v| v.as_u64()).unwrap_or(0) as u32;
                            }
                        }
                        "content_block_delta" => {
                            if let Some(text) = parsed["delta"]["text"].as_str() {
                                if !text.is_empty() {
                                    content.push_str(text);
                                    on_delta(text.to_string());
                                }
                            }
                        }
                        "message_delta" => {
                            if let Some(reason) = parsed["delta"]["stop_reason"].as_str() {
                                finish_reason = reason.to_string();
                            }
                            if let Some(usage) = parsed["usage"].as_object() {
                                output_tokens = usage.get("output_tokens")
                                    .and_then(|v| v.as_u64()).unwrap_or(0) as u32;
                            }
                        }
                        _ => {}
                    }
                }
            }
        }
    }

    Ok(StreamResult {
        content,
        input_tokens,
        output_tokens,
        total_tokens: input_tokens + output_tokens,
        finish_reason,
    })
}
