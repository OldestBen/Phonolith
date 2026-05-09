use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Key, Nonce,
};
use anyhow::{bail, Result};
use async_nats::jetstream;
use aws_sdk_s3::{config::Region, primitives::ByteStream, Client as S3Client};
use blake3::Hasher;
use chrono::Utc;
use futures::StreamExt;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use std::{io::Read, time::Duration};
use tokio::task;
use tracing::{error, info, warn};

const CHUNK_SIZE: usize = 8 * 1024 * 1024;

#[derive(Debug, Deserialize)]
struct HashEvent {
    blake3_hash: String,
    path: String,
    event_type: String,
    file_size_bytes: u64,
}

#[derive(Debug, Serialize)]
struct VaultEvent {
    event_type: String,
    blake3_hash: String,
    path: String,
    s3_key: String,
    chunk_count: usize,
    tier: String,
    encrypted: bool,
    timestamp: String,
}

// ── Key management ────────────────────────────────────────────────────────────

fn load_or_create_key(data_dir: &str) -> Result<[u8; 32]> {
    let key_path = format!("{data_dir}/aegis.key");
    if std::path::Path::new(&key_path).exists() {
        let bytes = std::fs::read(&key_path)?;
        if bytes.len() != 32 {
            bail!("aegis.key is corrupt (expected 32 bytes, got {})", bytes.len());
        }
        let mut key = [0u8; 32];
        key.copy_from_slice(&bytes);
        info!("Loaded existing AES-256 key from {key_path}");
        Ok(key)
    } else {
        let mut key = [0u8; 32];
        rand::rngs::OsRng.fill_bytes(&mut key);
        std::fs::write(&key_path, &key)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&key_path, std::fs::Permissions::from_mode(0o600))?;
        }
        warn!(
            "⚠ Generated new AES-256 key at {key_path} \
             — BACK THIS UP. Without it your vault is unrecoverable."
        );
        Ok(key)
    }
}

// ── Zero-knowledge encryption ─────────────────────────────────────────────────
// Each chunk: 12-byte random nonce || AES-256-GCM ciphertext (includes 16-byte tag)
// S3 sees only opaque encrypted blobs; the key never leaves this host.

fn encrypt_chunk(key: &[u8; 32], plaintext: &[u8]) -> Result<Vec<u8>> {
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key));
    let mut nonce_bytes = [0u8; 12];
    rand::rngs::OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);
    let ciphertext = cipher
        .encrypt(nonce, plaintext)
        .map_err(|e| anyhow::anyhow!("AES-256-GCM encrypt failed: {e}"))?;
    let mut out = Vec::with_capacity(12 + ciphertext.len());
    out.extend_from_slice(&nonce_bytes);
    out.extend_from_slice(&ciphertext);
    Ok(out)
}

fn decrypt_chunk(key: &[u8; 32], blob: &[u8]) -> Result<Vec<u8>> {
    if blob.len() < 28 {
        bail!("Blob too short to be a valid encrypted chunk");
    }
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key));
    let nonce = Nonce::from_slice(&blob[..12]);
    cipher
        .decrypt(nonce, &blob[12..])
        .map_err(|e| anyhow::anyhow!("AES-256-GCM decrypt failed: {e}"))
}

// ── File chunking + encrypt ───────────────────────────────────────────────────

fn chunk_and_encrypt(path: &str, key: &[u8; 32]) -> Result<Vec<(String, Vec<u8>)>> {
    let mut file = std::fs::File::open(path)?;
    let mut chunks = Vec::new();
    let mut buf = vec![0u8; CHUNK_SIZE];
    loop {
        let n = file.read(&mut buf)?;
        if n == 0 {
            break;
        }
        let plaintext = &buf[..n];
        // Hash the plaintext for the S3 key (content-addressable dedup)
        let plain_hash = Hasher::new().update(plaintext).finalize().to_hex().to_string();
        let ciphertext = encrypt_chunk(key, plaintext)?;
        chunks.push((plain_hash, ciphertext));
    }
    Ok(chunks)
}

// ── S3 upload ─────────────────────────────────────────────────────────────────

fn determine_tier(path: &str, size_bytes: u64) -> &'static str {
    let lower = path.to_lowercase();
    if lower.ends_with(".dsf") || lower.ends_with(".dff") || size_bytes > 200 * 1024 * 1024 {
        "cold"
    } else {
        "hot"
    }
}

async fn upload_file(
    s3: &S3Client,
    bucket: &str,
    key: &[u8; 32],
    event: &HashEvent,
) -> Result<VaultEvent> {
    let tier = determine_tier(&event.path, event.file_size_bytes);
    let path = event.path.clone();
    let blake3_hash = event.blake3_hash.clone();
    let key_copy = *key;

    let chunks = task::spawn_blocking(move || chunk_and_encrypt(&path, &key_copy)).await??;
    let chunk_count = chunks.len();

    for (idx, (plain_hash, encrypted_data)) in chunks.into_iter().enumerate() {
        let s3_key = format!("vault/{}/{:05}/{}.enc", blake3_hash, idx, plain_hash);
        s3.put_object()
            .bucket(bucket)
            .key(&s3_key)
            .body(ByteStream::from(encrypted_data))
            .storage_class(if tier == "cold" {
                aws_sdk_s3::types::StorageClass::GlacierIr
            } else {
                aws_sdk_s3::types::StorageClass::Standard
            })
            .send()
            .await?;
        info!("  [{idx}] {plain_hash:.12}… → s3://{bucket}/{s3_key} [{tier}] 🔒");
    }

    Ok(VaultEvent {
        event_type: "uploaded".into(),
        blake3_hash: event.blake3_hash.clone(),
        path: event.path.clone(),
        s3_key: format!("vault/{blake3_hash}/"),
        chunk_count,
        tier: tier.into(),
        encrypted: true,
        timestamp: Utc::now().to_rfc3339(),
    })
}

// ── Main ──────────────────────────────────────────────────────────────────────

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(std::env::var("RUST_LOG").unwrap_or_else(|_| "aegis=info".into()))
        .init();

    let nats_url = std::env::var("NATS_URL").unwrap_or_else(|_| "nats://localhost:4222".into());
    let data_dir = std::env::var("DATA_DIR").unwrap_or_else(|_| "/data".into());
    let s3_endpoint = std::env::var("S3_ENDPOINT").ok();
    let s3_bucket = std::env::var("S3_BUCKET").unwrap_or_default();
    let s3_region = std::env::var("S3_REGION").unwrap_or_else(|_| "us-east-1".into());

    let enc_key = load_or_create_key(&data_dir)?;

    if s3_bucket.is_empty() {
        warn!("S3_BUCKET not configured — Aegis running in dry-run mode (encryption still active)");
    }
    info!(
        "Aegis starting — zero-knowledge vault → {}",
        if s3_bucket.is_empty() { "[dry-run]" } else { &s3_bucket }
    );

    let mut s3_config = aws_config::defaults(aws_config::BehaviorVersion::latest())
        .region(Region::new(s3_region));
    if let Some(endpoint) = s3_endpoint {
        s3_config = s3_config.endpoint_url(endpoint);
    }
    let s3 = S3Client::new(&s3_config.load().await);
    let client = async_nats::connect(&nats_url).await?;
    let js = jetstream::new(client);

    js.get_or_create_stream(jetstream::stream::Config {
        name: "PHONOLITH_VAULT".into(),
        subjects: vec!["phonolith.vault.>".into()],
        retention: jetstream::stream::RetentionPolicy::Limits,
        max_age: Duration::from_secs(30 * 86_400),
        ..Default::default()
    })
    .await?;

    let consumer = js
        .get_or_create_consumer(
            "PHONOLITH_HASH",
            jetstream::consumer::pull::Config {
                durable_name: Some("aegis".into()),
                filter_subjects: vec![
                    "phonolith.hash.created".into(),
                    "phonolith.hash.modified".into(),
                ],
                ..Default::default()
            },
        )
        .await?;

    info!("Aegis listening — AES-256-GCM zero-knowledge encryption active");

    let mut messages = consumer.messages().await?;
    while let Some(msg) = messages.next().await {
        match msg {
            Ok(msg) => {
                let payload = msg.payload.clone();
                msg.ack().await.ok();

                let ev: HashEvent = match serde_json::from_slice(&payload) {
                    Ok(e) => e,
                    Err(e) => { error!("Deserialize error: {e}"); continue; }
                };

                if s3_bucket.is_empty() {
                    info!("[dry-run] Would encrypt+vault {} ({}B)", ev.path, ev.file_size_bytes);
                    continue;
                }

                info!("⬆ Encrypting + vaulting {} ({}B)", ev.path, ev.file_size_bytes);
                match upload_file(&s3, &s3_bucket, &enc_key, &ev).await {
                    Ok(vault_ev) => {
                        let subject = format!("phonolith.vault.{}", vault_ev.event_type);
                        if let Ok(p) = serde_json::to_vec(&vault_ev) {
                            js.publish(subject, p.into()).await.ok();
                        }
                        info!(
                            "✓ Vaulted {} ({} encrypted chunks, {}, 🔒)",
                            ev.path, vault_ev.chunk_count, vault_ev.tier
                        );
                    }
                    Err(e) => error!("Vault failed for {}: {e}", ev.path),
                }
            }
            Err(e) => error!("Message error: {e}"),
        }
    }

    Ok(())
}
