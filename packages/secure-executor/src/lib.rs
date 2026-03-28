mod crypto;
mod http_client;

use napi::bindgen_prelude::*;
use napi::threadsafe_function::{ErrorStrategy, ThreadsafeFunction, ThreadsafeFunctionCallMode};
use napi_derive::napi;

#[napi(object)]
pub struct ExecuteParams {
    pub encrypted_messages: String,
    pub encryption_key: String,
    pub encryption_iv: String,
    pub provider_base_url: String,
    pub provider_api_key: Option<String>,
    pub provider_type: String,
    pub model: String,
    pub temperature: Option<f64>,
    pub max_tokens: Option<u32>,
}

#[napi(object)]
pub struct ExecuteResult {
    pub content: String,
    pub input_tokens: u32,
    pub output_tokens: u32,
    pub total_tokens: u32,
    pub finish_reason: String,
}

#[napi]
pub async fn execute(
    params: ExecuteParams,
    #[napi(ts_arg_type = "(delta: string) => void")]
    on_delta: ThreadsafeFunction<String, ErrorStrategy::Fatal>,
) -> Result<ExecuteResult> {
    // 1. Decrypt messages (plaintext only exists in Rust heap)
    let messages_json = crypto::decrypt_messages(
        &params.encrypted_messages,
        &params.encryption_key,
        &params.encryption_iv,
    )
    .map_err(|e| Error::from_reason(format!("decryption failed: {}", e)))?;

    // 2. Stream LLM API call
    let result = http_client::stream_chat_completion(
        &params.provider_base_url,
        params.provider_api_key.as_deref(),
        &params.provider_type,
        &params.model,
        &messages_json,
        params.temperature,
        params.max_tokens.map(|v| v),
        |delta: String| {
            on_delta.call(delta, ThreadsafeFunctionCallMode::NonBlocking);
        },
    )
    .await
    .map_err(|e| Error::from_reason(format!("execution failed: {}", e)))?;

    // messages_json dropped here — never existed in JS heap
    Ok(ExecuteResult {
        content: result.content,
        input_tokens: result.input_tokens,
        output_tokens: result.output_tokens,
        total_tokens: result.total_tokens,
        finish_reason: result.finish_reason,
    })
}

/// Version info for diagnostics
#[napi]
pub fn version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}
