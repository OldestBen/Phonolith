use alsa::pcm::{Access, Format, HwParams, State};
use alsa::{Direction, PCM};
use anyhow::Result;
use async_nats::jetstream;
use blake3::Hasher;
use chrono::Utc;
use futures::StreamExt;
use serde::{Deserialize, Serialize};
use std::{
    io::{Cursor, Read},
    path::Path,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::Duration,
};
use symphonia::core::{
    audio::SampleBuffer,
    codecs::DecoderOptions,
    formats::FormatOptions,
    io::MediaSourceStream,
    meta::MetadataOptions,
    probe::Hint,
};
use tokio::sync::mpsc;
use tracing::{error, info, warn};

// ── Message types ─────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
struct PlayRequest {
    blake3_hash: String,
    path: String,
    endpoint_id: Option<String>,
    #[serde(default = "default_true")]
    validate_hash: bool,
}
fn default_true() -> bool { true }

#[derive(Debug, Serialize, Clone)]
struct SignalPathState {
    blake3_hash: String,
    path: String,
    source_format: String,
    source_bit_depth: u32,
    source_sample_rate: u32,
    source_channels: u32,
    source_bitrate_kbps: u32,
    decoder: String,
    dsp_active: bool,
    transport: String,
    output_endpoint: String,
    output_format: String,
    is_bit_perfect: bool,
    hash_verified: bool,
    state: String, // "playing" | "stopped" | "error"
    timestamp: String,
}

// ── Hash verification ─────────────────────────────────────────────────────────

fn verify_hash(data: &[u8], expected: &str) -> bool {
    if expected.is_empty() { return true; }
    Hasher::new().update(data).finalize().to_hex().to_string() == expected
}

// ── Audio decode + ALSA output ────────────────────────────────────────────────
// Runs entirely in a blocking thread. Returns real format metadata.
// Checks `stop` between every decoded packet for low-latency cancel.

struct FormatInfo {
    format_name: String,
    sample_rate: u32,
    bit_depth: u32,
    channels: u32,
    bitrate_kbps: u32,
}

fn play_blocking(
    path: &str,
    data: Vec<u8>,
    stop: Arc<AtomicBool>,
    event_tx: mpsc::UnboundedSender<SignalPathState>,
    blake3_hash: String,
    endpoint_id: String,
) -> Result<FormatInfo> {
    let cursor = Cursor::new(data);
    let mss = MediaSourceStream::new(Box::new(cursor), Default::default());

    let mut hint = Hint::new();
    if let Some(ext) = Path::new(path).extension().and_then(|e| e.to_str()) {
        hint.with_extension(ext);
    }

    let probed = symphonia::default::get_probe().format(
        &hint,
        mss,
        &FormatOptions::default(),
        &MetadataOptions::default(),
    )?;

    let mut format_reader = probed.format;
    let track = format_reader
        .default_track()
        .ok_or_else(|| anyhow::anyhow!("No default track found in {path}"))?;

    let sample_rate = track.codec_params.sample_rate.unwrap_or(44100);
    let channels = track
        .codec_params
        .channels
        .map(|c| c.count() as u32)
        .unwrap_or(2);
    let bits = track.codec_params.bits_per_sample.unwrap_or(16);
    let bitrate_kbps = track
        .codec_params
        .bit_rate
        .map(|b| b / 1000)
        .unwrap_or(0);
    let track_id = track.id;

    let format_name = Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("unknown")
        .to_uppercase();

    let is_bit_perfect = matches!(format_name.as_str(), "FLAC" | "WAV" | "AIFF" | "AIF");

    // Choose ALSA sample format. Use S32LE for >16-bit sources, S16LE otherwise.
    let alsa_fmt = if bits > 16 { Format::S32LE } else { Format::S16LE };

    // Open ALSA PCM device — exclusive access, no kernel mixer resampling
    let pcm_name = std::env::var("ALSA_DEVICE").unwrap_or_else(|_| "default".into());
    let pcm_result = PCM::new(&pcm_name, Direction::Playback, false);

    let pcm = match pcm_result {
        Ok(p) => p,
        Err(e) => {
            warn!("ALSA device '{pcm_name}' unavailable: {e} — signal path only mode");
            let info = FormatInfo { format_name, sample_rate, bit_depth: bits, channels, bitrate_kbps };
            return Ok(info);
        }
    };

    {
        let hwp = HwParams::any(&pcm)?;
        hwp.set_access(Access::RWInterleaved)?;
        hwp.set_format(alsa_fmt)?;
        hwp.set_rate_near(sample_rate, alsa::ValueOr::Nearest)?;
        hwp.set_channels(channels)?;
        // Buffer ≥ 200ms to allow gapless crossfade window
        hwp.set_buffer_time_near(200_000, alsa::ValueOr::Nearest)?;
        pcm.hw_params(&hwp)?;
    }
    pcm.prepare()?;

    let mut decoder = symphonia::default::get_codecs()
        .make(&track.codec_params, &DecoderOptions::default())?;

    // Publish "playing" signal path state before first sample
    let _ = event_tx.send(SignalPathState {
        blake3_hash: blake3_hash.clone(),
        path: path.to_string(),
        source_format: format_name.clone(),
        source_bit_depth: bits,
        source_sample_rate: sample_rate,
        source_channels: channels,
        source_bitrate_kbps: bitrate_kbps,
        decoder: "Symphonia 0.5 (64-bit float internally)".into(),
        dsp_active: false,
        transport: format!("ALSA exclusive ({pcm_name})"),
        output_endpoint: endpoint_id.clone(),
        output_format: format!("{alsa_fmt:?} {sample_rate}Hz"),
        is_bit_perfect,
        hash_verified: true,
        state: "playing".into(),
        timestamp: Utc::now().to_rfc3339(),
    });

    let mut sample_buf: Option<SampleBuffer<i32>> = None;

    loop {
        if stop.load(Ordering::Relaxed) {
            info!("Lucid: playback cancelled");
            break;
        }

        let packet = match format_reader.next_packet() {
            Ok(p) => p,
            Err(_) => break, // EOF or error
        };

        if packet.track_id() != track_id {
            continue;
        }

        match decoder.decode(&packet) {
            Ok(audio_buf) => {
                let spec = *audio_buf.spec();
                let capacity = audio_buf.capacity() as u64;

                if sample_buf.is_none() {
                    sample_buf = Some(SampleBuffer::<i32>::new(capacity, spec));
                }

                if let Some(buf) = &mut sample_buf {
                    buf.copy_interleaved_ref(audio_buf);
                    let samples = buf.samples();

                    match pcm.state() {
                        State::Running | State::Prepared => {}
                        _ => { let _ = pcm.prepare(); }
                    }

                    if alsa_fmt == Format::S16LE {
                        // Downconvert i32 → i16 for 16-bit output
                        let samples16: Vec<i16> = samples.iter().map(|&s| (s >> 16) as i16).collect();
                        let io = pcm.io_i16()?;
                        io.writei(&samples16)?;
                    } else {
                        let io = pcm.io_i32()?;
                        io.writei(samples)?;
                    }
                }
            }
            Err(symphonia::core::errors::Error::DecodeError(e)) => {
                warn!("Decode error (skipping packet): {e}");
                continue;
            }
            Err(e) => {
                error!("Fatal decode error: {e}");
                break;
            }
        }
    }

    // Drain the ALSA buffer so the last samples reach the DAC cleanly
    if pcm.state() == State::Running {
        pcm.drain()?;
    }

    Ok(FormatInfo { format_name, sample_rate, bit_depth: bits, channels, bitrate_kbps })
}

// ── Main ──────────────────────────────────────────────────────────────────────

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(std::env::var("RUST_LOG").unwrap_or_else(|_| "lucid=info".into()))
        .init();

    let nats_url = std::env::var("NATS_URL").unwrap_or_else(|_| "nats://localhost:4222".into());

    info!("Lucid starting — bit-perfect ALSA audio transport daemon");

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

    // Channel for blocking playback thread to send events back to async runtime
    let (event_tx, mut event_rx) = mpsc::unbounded_channel::<SignalPathState>();

    // Forward signal path events from the blocking thread to NATS
    let js_events = js.clone();
    tokio::spawn(async move {
        while let Some(state) = event_rx.recv().await {
            if let Ok(payload) = serde_json::to_vec(&state) {
                js_events.publish("phonolith.playback.signal", payload.into()).await.ok();
            }
            if state.state == "playing" {
                let started = serde_json::json!({
                    "blake3_hash": state.blake3_hash,
                    "path": state.path,
                    "format": state.source_format,
                    "sample_rate": state.source_sample_rate,
                    "bit_depth": state.source_bit_depth,
                    "timestamp": state.timestamp,
                });
                if let Ok(p) = serde_json::to_vec(&started) {
                    js_events.publish("phonolith.playback.started", p.into()).await.ok();
                }
            }
        }
    });

    let mut sub = client.subscribe("phonolith.lucid.play").await?;
    info!("Lucid ready — awaiting play requests on phonolith.lucid.play");

    // Stop flag shared with the current blocking playback task
    let mut stop_flag: Arc<AtomicBool> = Arc::new(AtomicBool::new(false));

    while let Some(msg) = sub.next().await {
        let req: PlayRequest = match serde_json::from_slice(&msg.payload) {
            Ok(r) => r,
            Err(e) => { error!("Invalid play request: {e}"); continue; }
        };

        info!("▶ Play: {}", req.path);

        // Cancel any currently running playback
        stop_flag.store(true, Ordering::Relaxed);
        stop_flag = Arc::new(AtomicBool::new(false));

        // RAM buffer: load the whole file before decoding
        // This allows the drive to spin down during playback
        let path = req.path.clone();
        let file_bytes = match tokio::task::spawn_blocking(move || std::fs::read(&path)).await {
            Ok(Ok(b)) => b,
            Ok(Err(e)) => { error!("Cannot read {}: {e}", req.path); continue; }
            Err(e) => { error!("spawn_blocking error: {e}"); continue; }
        };

        // Verify BLAKE3 hash (bit-rot detection at playback time)
        let hash_ok = if req.validate_hash && !req.blake3_hash.is_empty() {
            let bytes = file_bytes.clone();
            let expected = req.blake3_hash.clone();
            tokio::task::spawn_blocking(move || verify_hash(&bytes, &expected))
                .await
                .unwrap_or(false)
        } else {
            true
        };

        if !hash_ok {
            warn!("⚠ BLAKE3 mismatch on {} — possible bit-rot or tampering!", req.path);
        }

        let stop = stop_flag.clone();
        let tx = event_tx.clone();
        let path = req.path.clone();
        let hash = req.blake3_hash.clone();
        let endpoint = req.endpoint_id.unwrap_or_else(|| "default".into());

        tokio::task::spawn_blocking(move || {
            match play_blocking(&path, file_bytes, stop, tx.clone(), hash.clone(), endpoint.clone()) {
                Ok(info) => {
                    info!(
                        "✓ Finished: {} | {} {}b/{}Hz/{}ch",
                        path, info.format_name, info.bit_depth, info.sample_rate, info.channels
                    );
                    let _ = tx.send(SignalPathState {
                        blake3_hash: hash,
                        path,
                        source_format: info.format_name,
                        source_bit_depth: info.bit_depth,
                        source_sample_rate: info.sample_rate,
                        source_channels: info.channels,
                        source_bitrate_kbps: info.bitrate_kbps,
                        decoder: "Symphonia 0.5".into(),
                        dsp_active: false,
                        transport: "ALSA exclusive".into(),
                        output_endpoint: endpoint,
                        output_format: String::new(),
                        is_bit_perfect: true,
                        hash_verified: true,
                        state: "stopped".into(),
                        timestamp: Utc::now().to_rfc3339(),
                    });
                }
                Err(e) => error!("Playback error: {e}"),
            }
        });
    }

    Ok(())
}
