use anyhow::Result;
use async_nats::jetstream;
use chrono::Utc;
use notify::{
    event::{ModifyKind, RenameMode},
    Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher,
};
use serde::{Deserialize, Serialize};
use std::{path::Path, time::Duration};
use tokio::sync::mpsc;
use tracing::{error, info, warn};

const AUDIO_EXTENSIONS: &[&str] = &[
    "flac", "mp3", "aac", "m4a", "ogg", "opus", "wav", "aiff", "aif",
    "dsf", "dff", "wv", "ape", "mpc", "wma",
];

#[derive(Debug, Serialize, Deserialize)]
struct FsEvent {
    event_type: String,
    path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    old_path: Option<String>,
    timestamp: String,
}

fn is_audio(path: &str) -> bool {
    let lower = path.to_lowercase();
    AUDIO_EXTENSIONS
        .iter()
        .any(|ext| lower.ends_with(&format!(".{ext}")))
}

fn map_event(event: Event) -> Option<FsEvent> {
    let ts = Utc::now().to_rfc3339();
    match &event.kind {
        EventKind::Create(_) => {
            let path = event.paths.first()?.to_string_lossy().to_string();
            is_audio(&path).then_some(FsEvent {
                event_type: "created".into(),
                path,
                old_path: None,
                timestamp: ts,
            })
        }
        EventKind::Modify(ModifyKind::Data(_)) | EventKind::Modify(ModifyKind::Metadata(_)) => {
            let path = event.paths.first()?.to_string_lossy().to_string();
            is_audio(&path).then_some(FsEvent {
                event_type: "modified".into(),
                path,
                old_path: None,
                timestamp: ts,
            })
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
            is_audio(&path).then_some(FsEvent {
                event_type: "deleted".into(),
                path,
                old_path: None,
                timestamp: ts,
            })
        }
        _ => None,
    }
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            std::env::var("RUST_LOG").unwrap_or_else(|_| "tremor=info".into()),
        )
        .init();

    let nats_url =
        std::env::var("NATS_URL").unwrap_or_else(|_| "nats://localhost:4222".into());
    let library_path =
        std::env::var("LIBRARY_PATH").unwrap_or_else(|_| "/library".into());

    info!("Tremor starting — watching {library_path}");

    let client = async_nats::connect(&nats_url).await?;
    let js = jetstream::new(client);

    js.get_or_create_stream(jetstream::stream::Config {
        name: "PHONOLITH_FS".into(),
        subjects: vec!["phonolith.fs.>".into()],
        retention: jetstream::stream::RetentionPolicy::WorkQueue,
        max_age: Duration::from_secs(86_400),
        ..Default::default()
    })
    .await?;

    let (tx, mut rx) = mpsc::channel::<FsEvent>(4096);

    let mut watcher = RecommendedWatcher::new(
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
    )?;

    watcher.watch(Path::new(&library_path), RecursiveMode::Recursive)?;
    info!("Watching {library_path} recursively — listening for audio file changes");

    while let Some(ev) = rx.recv().await {
        let subject = format!("phonolith.fs.{}", ev.event_type);
        match serde_json::to_vec(&ev) {
            Ok(payload) => {
                if let Err(e) = js.publish(subject.clone(), payload.into()).await {
                    error!("Failed to publish {subject}: {e}");
                } else {
                    info!("▶ {} → {}", ev.event_type, ev.path);
                }
            }
            Err(e) => error!("Serialization error: {e}"),
        }
    }

    Ok(())
}
