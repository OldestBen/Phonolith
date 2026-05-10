use anyhow::Result;
use async_nats::jetstream;
use chrono::Utc;
use notify::{
    event::{ModifyKind, RenameMode},
    Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher,
};
use serde::{Deserialize, Serialize};
use std::{path::Path, sync::Arc, time::Duration};
use tokio::sync::{mpsc, watch};
use tracing::{error, info, warn};

const AUDIO_EXTENSIONS: &[&str] = &[
    "flac", "mp3", "aac", "m4a", "ogg", "opus", "wav", "aiff", "aif",
    "dsf", "dff", "wv", "ape", "mpc", "wma",
];

const SOURCES_FILE: &str = "/data/sources.json";

// ── Types ─────────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
struct LibrarySource {
    id:   String,
    name: String,
    path: String,
}

#[derive(Debug, Deserialize)]
struct SourcesConfig {
    sources: Vec<LibrarySource>,
}

#[derive(Debug, Serialize, Deserialize)]
struct FsEvent {
    event_type: String,
    path:       String,
    #[serde(skip_serializing_if = "Option::is_none")]
    old_path:   Option<String>,
    timestamp:  String,
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async fn publish_task(nc: &async_nats::Client, level: &str, message: &str) {
    let ts = chrono::Utc::now().to_rfc3339();
    if let Ok(payload) = serde_json::to_vec(&serde_json::json!({
        "service": "tremor",
        "level": level,
        "message": message,
        "ts": ts,
    })) {
        nc.publish("phonolith.tasks.tremor", payload.into()).await.ok();
    }
}

fn is_audio(path: &str) -> bool {
    let lower = path.to_lowercase();
    AUDIO_EXTENSIONS.iter().any(|ext| lower.ends_with(&format!(".{ext}")))
}

fn map_event(event: Event) -> Option<FsEvent> {
    let ts = Utc::now().to_rfc3339();
    match &event.kind {
        EventKind::Create(_) => {
            let path = event.paths.first()?.to_string_lossy().to_string();
            is_audio(&path).then_some(FsEvent { event_type: "created".into(), path, old_path: None, timestamp: ts })
        }
        EventKind::Modify(ModifyKind::Data(_)) | EventKind::Modify(ModifyKind::Metadata(_)) => {
            let path = event.paths.first()?.to_string_lossy().to_string();
            is_audio(&path).then_some(FsEvent { event_type: "modified".into(), path, old_path: None, timestamp: ts })
        }
        EventKind::Modify(ModifyKind::Name(RenameMode::Both)) => {
            let old = event.paths.first()?.to_string_lossy().to_string();
            let new = event.paths.get(1)?.to_string_lossy().to_string();
            (is_audio(&old) || is_audio(&new)).then_some(FsEvent {
                event_type: "renamed".into(),
                path: new,
                old_path: Some(old),
                timestamp: ts,
            })
        }
        EventKind::Remove(_) => {
            let path = event.paths.first()?.to_string_lossy().to_string();
            is_audio(&path).then_some(FsEvent { event_type: "deleted".into(), path, old_path: None, timestamp: ts })
        }
        _ => None,
    }
}

// ── Source loading ─────────────────────────────────────────────────────────────

fn load_sources(fallback: &str) -> Vec<String> {
    // Try sources.json first; fall back to the LIBRARY_PATH env var.
    if let Ok(raw) = std::fs::read_to_string(SOURCES_FILE) {
        if let Ok(cfg) = serde_json::from_str::<SourcesConfig>(&raw) {
            let paths: Vec<String> = cfg.sources.iter().map(|s| s.path.clone()).collect();
            if !paths.is_empty() {
                info!("Loaded {} source(s) from {SOURCES_FILE}", paths.len());
                return paths;
            }
        }
    }
    if !fallback.is_empty() {
        info!("No sources.json — watching LIBRARY_PATH: {fallback}");
        return vec![fallback.to_string()];
    }
    info!("No sources configured yet — Tremor idle until a library source is added");
    vec![]
}

// ── Watcher task ──────────────────────────────────────────────────────────────

fn start_watcher(paths: Vec<String>, tx: mpsc::Sender<FsEvent>) -> Option<RecommendedWatcher> {
    if paths.is_empty() {
        return None;
    }
    let mut watcher = match RecommendedWatcher::new(
        {
            let tx = tx.clone();
            move |result: notify::Result<Event>| match result {
                Ok(ev) => {
                    if let Some(fs_ev) = map_event(ev) {
                        if tx.blocking_send(fs_ev).is_err() {
                            error!("Event channel full — dropping event");
                        }
                    }
                }
                Err(e) => error!("Watch error: {e}"),
            }
        },
        notify::Config::default().with_poll_interval(Duration::from_secs(2)),
    ) {
        Ok(w) => w,
        Err(e) => { error!("Failed to create watcher: {e}"); return None; }
    };

    let mut active = 0usize;
    for path in &paths {
        let p = Path::new(path);
        if !p.exists() {
            warn!("Source path does not exist (yet): {path}");
            continue;
        }
        match watcher.watch(p, RecursiveMode::Recursive) {
            Ok(_) => { info!("Watching: {path}"); active += 1; }
            Err(e) => warn!("Cannot watch {path}: {e}"),
        }
    }
    if active == 0 { return None; }
    Some(watcher)
}

// ── Main ──────────────────────────────────────────────────────────────────────

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(std::env::var("RUST_LOG").unwrap_or_else(|_| "tremor=info".into()))
        .init();

    let nats_url    = std::env::var("NATS_URL").unwrap_or_else(|_| "nats://localhost:4222".into());
    let library_env = std::env::var("LIBRARY_PATH").unwrap_or_default();

    info!("Tremor starting");

    let client = async_nats::connect(&nats_url).await?;
    let js = jetstream::new(client.clone());

    js.get_or_create_stream(jetstream::stream::Config {
        name:      "PHONOLITH_FS".into(),
        subjects:  vec!["phonolith.fs.>".into()],
        retention: jetstream::stream::RetentionPolicy::WorkQueue,
        max_age:   Duration::from_secs(86_400),
        ..Default::default()
    })
    .await?;

    let (ev_tx, mut ev_rx) = mpsc::channel::<FsEvent>(4096);

    // Watch for source config changes via NATS.
    let (reload_tx, mut reload_rx) = watch::channel::<()>(());
    let reload_tx = Arc::new(reload_tx);

    {
        let reload_tx = Arc::clone(&reload_tx);
        tokio::spawn(async move {
            if let Ok(mut sub) = client.subscribe("phonolith.config.sources").await {
                use futures::StreamExt;
                while let Some(_msg) = sub.next().await {
                    info!("Source config update received — reloading watchers");
                    let _ = reload_tx.send(());
                }
            }
        });
    }

    // Initial watch.
    let mut _watcher = start_watcher(load_sources(&library_env), ev_tx.clone());

    loop {
        tokio::select! {
            Some(ev) = ev_rx.recv() => {
                let subject = format!("phonolith.fs.{}", ev.event_type);
                match serde_json::to_vec(&ev) {
                    Ok(payload) => {
                        if let Err(e) = js.publish(subject.clone(), payload.into()).await {
                            error!("Failed to publish {subject}: {e}");
                        } else {
                            let filename = std::path::Path::new(&ev.path)
                                .file_name()
                                .map(|n| n.to_string_lossy().to_string())
                                .unwrap_or_else(|| ev.path.clone());
                            let msg = match ev.event_type.as_str() {
                                "created"  => format!("New file: {filename}"),
                                "modified" => format!("Modified: {filename}"),
                                "deleted"  => format!("Removed: {filename}"),
                                "renamed"  => format!("Renamed: {filename}"),
                                other      => format!("{other}: {filename}"),
                            };
                            publish_task(&client, "info", &msg).await;
                            info!("▶ {} → {}", ev.event_type, ev.path);
                        }
                    }
                    Err(e) => error!("Serialization error: {e}"),
                }
            }
            Ok(_) = reload_rx.changed() => {
                // Drop old watcher (stops watching), start fresh.
                _watcher = None;
                _watcher = start_watcher(load_sources(&library_env), ev_tx.clone());
            }
        }
    }
}
