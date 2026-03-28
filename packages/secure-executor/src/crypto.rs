use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use base64::Engine;
use base64::engine::general_purpose::STANDARD as BASE64;

pub fn decrypt_messages(
    encrypted_messages_b64: &str,
    key_b64: &str,
    iv_b64: &str,
) -> Result<String, String> {
    let key_bytes = BASE64
        .decode(key_b64)
        .map_err(|e| format!("invalid encryption key: {}", e))?;
    let iv_bytes = BASE64
        .decode(iv_b64)
        .map_err(|e| format!("invalid encryption iv: {}", e))?;
    let data = BASE64
        .decode(encrypted_messages_b64)
        .map_err(|e| format!("invalid encrypted data: {}", e))?;

    if key_bytes.len() != 32 {
        return Err(format!("key must be 32 bytes, got {}", key_bytes.len()));
    }
    if iv_bytes.len() != 12 {
        return Err(format!("iv must be 12 bytes, got {}", iv_bytes.len()));
    }

    // Platform sends: ciphertext + authTag (16 bytes) concatenated
    // aes-gcm crate expects: ciphertext + tag appended (which is what we have)
    let cipher = Aes256Gcm::new_from_slice(&key_bytes)
        .map_err(|e| format!("cipher init failed: {}", e))?;
    let nonce = Nonce::from_slice(&iv_bytes);

    let plaintext = cipher
        .decrypt(nonce, data.as_ref())
        .map_err(|_| "decryption failed: invalid ciphertext or key".to_string())?;

    String::from_utf8(plaintext).map_err(|e| format!("decrypted data is not valid UTF-8: {}", e))
}

#[cfg(test)]
mod tests {
    use super::*;
    use aes_gcm::aead::OsRng;
    use aes_gcm::{AeadCore, Aes256Gcm, KeyInit};
    use base64::Engine;
    use base64::engine::general_purpose::STANDARD as BASE64;

    #[test]
    fn test_encrypt_decrypt_roundtrip() {
        let key = Aes256Gcm::generate_key(OsRng);
        let cipher = Aes256Gcm::new(&key);
        let nonce = Aes256Gcm::generate_nonce(OsRng);

        let plaintext = r#"[{"role":"user","content":"Hello"}]"#;
        let ciphertext = cipher.encrypt(&nonce, plaintext.as_bytes()).unwrap();

        let key_b64 = BASE64.encode(&key);
        let iv_b64 = BASE64.encode(&nonce);
        let data_b64 = BASE64.encode(&ciphertext);

        let result = decrypt_messages(&data_b64, &key_b64, &iv_b64).unwrap();
        assert_eq!(result, plaintext);
    }

    #[test]
    fn test_decrypt_wrong_key_fails() {
        let key = Aes256Gcm::generate_key(OsRng);
        let cipher = Aes256Gcm::new(&key);
        let nonce = Aes256Gcm::generate_nonce(OsRng);

        let ciphertext = cipher.encrypt(&nonce, b"test".as_ref()).unwrap();

        let wrong_key = Aes256Gcm::generate_key(OsRng);
        let result = decrypt_messages(
            &BASE64.encode(&ciphertext),
            &BASE64.encode(&wrong_key),
            &BASE64.encode(&nonce),
        );
        assert!(result.is_err());
    }
}
