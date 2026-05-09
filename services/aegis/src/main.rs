use anyhow::Result;
use async_nats::jetstream;
use aws_sdk_s3::{
    config::Region,
    primitives::ByteStream,
    Client as S3Client,
};
use blake3::Hasher;
use chrono::Utc;
use futures::StreamExt;
use serde::{Deserialize, Serialize};
use std::{io::Read, time::Duration};
use tokio::task;
use tracing::{error, info, warn};

const CHUNK_SIZE: usize = 8 * 1024 * 1024; // 8 MB content-defined chunks

#[derive(Debug, Deserialize)]
struct HashEvent {
    blake3_hash: String,
    path: String,
    event_type: String,
    file_size_bytes: u64,
}

#[derive(Debug, Serialize)]
struct VaultEvent {
    event_type: String,   // queued|uploaded|verified|restored
    blake3_hash: String,
    path: String,
    s3_key: String,
    chunk_count: usize,
    tier: String,
    timestamp: String,
}

fn determine_tier(path: &str, size_bytes: u64) -> &'static str {
    let lower = path.to_lowercase();
    // DSD, high-res FLAC, and very large files → cold tier
    if lower.ends_with(".dsf")
        || lower.ends_with(".dff")
        || size_bytes > 200 * 1024 * 1024  // > 200 MB
    {
        "cold"
    } else {
        "hot"
    }
}

fn chunk_file(path: &str) -> Result<Vec<(String, Vec<u8>)>> {
    let mut file = std::fs::File::open(path)?;
    let mut chunks = Vec::new();
    let mut buf = vec![0u8; CHUNK_SIZE];
    loop {
        let n = file.read(&mut buf)?;
        if n == 0 {
            break;
        }
        let chunk = buf[..n].to_vec();
        let hash = Hasher::new().update(&chunk).finalize().to_hex().to_string();
        chunks.push((hash, chunk));
    }
    Ok(chunks)
}

async fn upload_file(
    s3: &S3Client,
    bucket: &str,
    event: &HashEvent,
) -> Result<VaultEvent> {
    let tier = determine_tier(&event.path, event.file_size_bytes);
    let path = event.path.clone();
    let blake3_hash = event.blake3_hash.clone();

    let chunks = task::spawn_blocking(move || chunk_file(&path)).await??;
    let chunk_count = chunks.len();

    for (idx, (chunk_hash, data)) in chunks.into_iter().enumerate() {
        let key = format!("vault/{}/{:05}/{}", blake3_hash, idx, chunk_hash);
        s3.put_object()
            .bucket(bucket)
            .key(&key)
            .body(ByteStream::from(data))
            .storage_class(if tier == "cold" {
                aws_sdk_s3::types::StorageClass::GlacierIr
            } else {
                aws_sdk_s3::types::StorageClass::Standard
            })
            .send()
            .await?;
        info!("  chunk {}/{chunk_hash:.12}… → s3://{bucket}/{key} [{tier}]", idx + 1);
    }

    Ok(VaultEvent {
        event_type: "uploaded".into(),
        blake3_hash: event.blake3_hash.clone(),
        path: event.path.clone(),
        s3_key: format!("vault/{blake3_hash}/"),
        chunk_count,
        tier: tier.into(),
        timestamp: Utc::now().to_rfc3339(),
    })
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            std::env::var("RUST_LOG").unwrap_or_else(|_| "aegis=info".into()),
        )
        .init();

    let nats_url =
        std::env::var("NATS_URL").unwrap_or_else(|_| "nats://localhost:4222".into());
    let s3_endpoint = std::env::var("S3_ENDPOINT").ok();
    let s3_bucket = std::env::var("S3_BUCKET").unwrap_or_default();
    let s3_region = std::env::var("S3_REGION").unwrap_or_else(|_| "us-east-1".into());

    if s3_bucket.is_empty() {
        warn!("S3_BUCKET not configured — Aegis running in dry-run mode");
    }

    info!("Aegis starting — vaulting to {}", if s3_bucket.is_empty() { "[dry-run]" } else { &s3_bucket });

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

    info!("Aegis listening for hash events");

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
                    info!("[dry-run] Would vault {} ({}B)", ev.path, ev.file_size_bytes);
                    continue;
                }

                info!("⬆ Vaulting {} ({}B)", ev.path, ev.file_size_bytes);
                match upload_file(&s3, &s3_bucket, &ev).await {
                    Ok(vault_ev) => {
                        let subject = format!("phonolith.vault.{}", vault_ev.event_type);
                        if let Ok(payload) = serde_json::to_vec(&vault_ev) {
                            js.publish(subject, payload.into()).await.ok();
                        }
                        info!("✓ Vaulted {} ({} chunks, {})", ev.path, vault_ev.chunk_count, vault_ev.tier);
                    }
                    Err(e) => error!("Vault failed for {}: {e}", ev.path),
                }
            }
            Err(e) => error!("Message error: {e}"),
        }
    }

    Ok(())
}
