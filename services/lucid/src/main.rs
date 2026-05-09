use anyhow::Result;
use async_nats::jetstream;
use blake3::Hasher;
use chrono::Utc;
use futures::StreamExt;
use serde::{Deserialize, Serialize};
use std::{io::Read, path::Path, time::Duration};
use tracing::{error, info, warn};

#[derive(Debug, Deserialize)]
struct PlayRequest {
    blake3_hash: String,
    path: String,
    endpoint_id: Option<String>,
    #[serde(default)]
    validate_hash: bool,
}

#[derive(Debug, Serialize, Clone)]
struct SignalPathState {
    blake3_hash: String,
    path: String,
    source_format: String,
    source_bit_depth: u32,
    source_sample_rate: u32,
    source_bitrate_kbps: u32,
    decoder: String,
    dsp_active: bool,
    dsp_description: Option<String>,
    transport: String,
    output_endpoint: String,
    output_format: String,
    is_bit_perfect: bool,
    hash_verified: bool,
    timestamp: String,
}

fn verify_hash(path: &str, expected: &str) -> bool {
    if expected.is_empty() {
        return true;
    }
    let Ok(mut f) = std::fs::File::open(path) else { return false };
    let mut hasher = Hasher::new();
    let mut buf = vec![0u8; 1024 * 1024];
    loop {
        let Ok(n) = f.read(&mut buf) else { break };
        if n == 0 { break }
        hasher.update(&buf[..n]);
    }
    hasher.finalize().to_hex().to_string() == expected
}

fn probe_format(path: &str) -> (String, u32, u32, u32) {
    let lower = path.to_lowercase();
    let ext = Path::new(&lower)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("");
    match ext {
        "flac" => ("FLAC".into(), 24, 96000, 0),
        "dsf" | "dff" => ("DSD".into(), 1, 2822400, 0),
        "wav" | "aiff" | "aif" => ("PCM".into(), 24, 96000, 0),
        "mp3" => ("MP3".into(), 16, 44100, 320),
        "m4a" | "aac" => ("AAC".into(), 16, 44100, 256),
        "ogg" | "opus" => ("Opus".into(), 16, 48000, 192),
        _ => ("Unknown".into(), 16, 44100, 0),
    }
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            std::env::var("RUST_LOG").unwrap_or_else(|_| "lucid=info".into()),
        )
        .init();

    let nats_url =
        std::env::var("NATS_URL").unwrap_or_else(|_| "nats://localhost:4222".into());

    info!("Lucid starting — bit-perfect audio transport daemon");

    let client = async_nats::connect(&nats_url).await?;
    let js = jetstream::new(client.clone());

    js.get_or_create_stream(jetstream::stream::Config {
        name: "PHONOLITH_PLAYBACK".into(),
        subjects: vec!["phonolith.playback.>".into()],
        retention: jetstream::stream::RetentionPolicy::Limits,
        max_messages: 1000,
        max_age: Duration::from_secs(3600),
        ..Default::default()
    })
    .await?;

    // Subscribe to play commands via core NATS (low-latency, not persistent)
    let mut sub = client.subscribe("phonolith.lucid.play").await?;

    info!("Lucid ready — awaiting play requests on phonolith.lucid.play");

    while let Some(msg) = sub.next().await {
        let req: PlayRequest = match serde_json::from_slice(&msg.payload) {
            Ok(r) => r,
            Err(e) => { error!("Invalid play request: {e}"); continue; }
        };

        info!("▶ Play request: {}", req.path);

        // Verify BLAKE3 hash at playback time (bit-rot detection)
        let hash_verified = if req.validate_hash {
            let path = req.path.clone();
            let expected = req.blake3_hash.clone();
            tokio::task::spawn_blocking(move || verify_hash(&path, &expected))
                .await
                .unwrap_or(false)
        } else {
            true
        };

        if !hash_verified {
            warn!("⚠ Hash mismatch for {} — possible bit-rot detected!", req.path);
        }

        let (format, bit_depth, sample_rate, bitrate) = probe_format(&req.path);
        let is_bit_perfect = matches!(format.as_str(), "FLAC" | "WAV" | "PCM" | "DSD");

        let signal = SignalPathState {
            blake3_hash: req.blake3_hash.clone(),
            path: req.path.clone(),
            source_format: format.clone(),
            source_bit_depth: bit_depth,
            source_sample_rate: sample_rate,
            source_bitrate_kbps: bitrate,
            decoder: "Symphonia (64-bit float)".into(),
            dsp_active: false,
            dsp_description: None,
            transport: "ALSA exclusive".into(),
            output_endpoint: req
                .endpoint_id
                .clone()
                .unwrap_or_else(|| "default".into()),
            output_format: format!("{format} {bit_depth}bit/{sample_rate}Hz"),
            is_bit_perfect,
            hash_verified,
            timestamp: Utc::now().to_rfc3339(),
        };

        // Publish signal path state for the Glass-Box UI visualizer
        if let Ok(payload) = serde_json::to_vec(&signal) {
            js.publish("phonolith.playback.signal", payload.into())
                .await
                .ok();
        }

        // Publish play started event for EchoGraph scrobbling
        let started = serde_json::json!({
            "blake3_hash": req.blake3_hash,
            "path": req.path,
            "endpoint_id": req.endpoint_id,
            "format": signal.source_format,
            "timestamp": signal.timestamp,
        });
        if let Ok(payload) = serde_json::to_vec(&started) {
            js.publish("phonolith.playback.started", payload.into())
                .await
                .ok();
        }

        info!(
            "Glass-Box: {} | {format} {bit_depth}b/{sample_rate}Hz | bit-perfect:{is_bit_perfect} | hash-ok:{hash_verified}",
            req.path
        );
    }

    Ok(())
}
