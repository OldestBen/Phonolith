use anyhow::Result;
use async_nats::jetstream;
use blake3::Hasher;
use chrono::Utc;
use futures::StreamExt;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::{
    io::Read,
    sync::{Arc, Mutex},
    time::Duration,
};
use tokio::task;
use tracing::{error, info, warn};

type Db = Arc<Mutex<Connection>>;

#[derive(Debug, Deserialize)]
struct FsEvent {
    event_type: String,
    path: String,
    old_path: Option<String>,
    timestamp: String,
}

#[derive(Debug, Serialize)]
struct HashEvent {
    blake3_hash: String,
    path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    old_path: Option<String>,
    file_size_bytes: u64,
    event_type: String,
    timestamp: String,
    is_duplicate: bool,
}

fn init_db(data_dir: &str) -> Result<Connection> {
    let conn = Connection::open(format!("{data_dir}/bitforge.db"))?;
    conn.execute_batch(
        "PRAGMA journal_mode=WAL;
         CREATE TABLE IF NOT EXISTS file_hashes (
             blake3_hash    TEXT NOT NULL,
             path           TEXT NOT NULL,
             file_size_bytes INTEGER,
             first_seen_at  TEXT NOT NULL,
             last_seen_at   TEXT NOT NULL,
             event_type     TEXT NOT NULL,
             PRIMARY KEY (blake3_hash, path)
         );
         CREATE INDEX IF NOT EXISTS idx_hash ON file_hashes(blake3_hash);
         CREATE INDEX IF NOT EXISTS idx_path ON file_hashes(path);",
    )?;
    Ok(conn)
}

fn hash_file(path: &str) -> Result<(String, u64)> {
    let mut file = std::fs::File::open(path)?;
    let mut hasher = Hasher::new();
    let mut buf = vec![0u8; 1024 * 1024];
    let mut total: u64 = 0;
    loop {
        let n = file.read(&mut buf)?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
        total += n as u64;
    }
    Ok((hasher.finalize().to_hex().to_string(), total))
}

async fn publish(js: &jetstream::Context, event: &HashEvent) -> Result<()> {
    let subject = format!("phonolith.hash.{}", event.event_type);
    let payload = serde_json::to_vec(event)?;
    js.publish(subject, payload.into()).await?;
    info!(
        "⬡ {} — {}… ({}B, dup:{})",
        event.path,
        &event.blake3_hash[..12],
        event.file_size_bytes,
        event.is_duplicate
    );
    Ok(())
}

async fn process_fs_event(
    payload: bytes::Bytes,
    js: jetstream::Context,
    db: Db,
) -> Result<()> {
    let ev: FsEvent = serde_json::from_slice(&payload)?;
    let now = Utc::now().to_rfc3339();

    match ev.event_type.as_str() {
        "deleted" => {
            {
                let db = db.lock().unwrap();
                db.execute(
                    "UPDATE file_hashes SET last_seen_at=?1, event_type='deleted' WHERE path=?2",
                    params![now, ev.path],
                )
                .ok();
            }
            publish(
                &js,
                &HashEvent {
                    blake3_hash: String::new(),
                    path: ev.path,
                    old_path: None,
                    file_size_bytes: 0,
                    event_type: "deleted".into(),
                    timestamp: now,
                    is_duplicate: false,
                },
            )
            .await?;
        }

        "renamed" => {
            let old = match &ev.old_path {
                Some(p) => p.clone(),
                None => return Ok(()),
            };
            let existing = {
                let db = db.lock().unwrap();
                db.query_row(
                    "SELECT blake3_hash FROM file_hashes WHERE path=?1 AND event_type!='deleted' ORDER BY last_seen_at DESC LIMIT 1",
                    params![old],
                    |r| r.get::<_, String>(0),
                )
                .ok()
            };

            if let Some(hash) = existing {
                let size = std::fs::metadata(&ev.path).map(|m| m.len()).unwrap_or(0);
                {
                    let db = db.lock().unwrap();
                    db.execute(
                        "INSERT OR REPLACE INTO file_hashes VALUES(?1,?2,?3,?4,?5,'renamed')",
                        params![hash, ev.path, size as i64, now.clone(), now.clone()],
                    )?;
                    db.execute(
                        "UPDATE file_hashes SET last_seen_at=?1, event_type='moved_from' WHERE path=?2 AND blake3_hash=?3",
                        params![now.clone(), old.clone(), hash.clone()],
                    )?;
                }
                publish(
                    &js,
                    &HashEvent {
                        blake3_hash: hash,
                        path: ev.path,
                        old_path: Some(old),
                        file_size_bytes: size,
                        event_type: "renamed".into(),
                        timestamp: now,
                        is_duplicate: false,
                    },
                )
                .await?;
            } else {
                hash_and_publish(&ev.path, "created", &js, &db, &now).await?;
            }
        }

        "created" | "modified" => {
            hash_and_publish(&ev.path, &ev.event_type, &js, &db, &now).await?;
        }

        other => warn!("Unknown event type: {other}"),
    }

    Ok(())
}

async fn hash_and_publish(
    path: &str,
    event_type: &str,
    js: &jetstream::Context,
    db: &Db,
    now: &str,
) -> Result<()> {
    let path_owned = path.to_string();
    let (hash, size) =
        task::spawn_blocking(move || hash_file(&path_owned)).await??;

    let is_duplicate = {
        let db = db.lock().unwrap();
        let count: i64 = db
            .query_row(
                "SELECT COUNT(*) FROM file_hashes WHERE blake3_hash=?1 AND event_type!='deleted'",
                params![hash],
                |r| r.get(0),
            )
            .unwrap_or(0);
        count > 0
    };

    {
        let db = db.lock().unwrap();
        db.execute(
            "INSERT INTO file_hashes VALUES(?1,?2,?3,?4,?5,?6)
             ON CONFLICT(blake3_hash,path) DO UPDATE SET last_seen_at=?5, event_type=?6",
            params![hash, path, size as i64, now, now, event_type],
        )?;
    }

    publish(
        js,
        &HashEvent {
            blake3_hash: hash,
            path: path.to_string(),
            old_path: None,
            file_size_bytes: size,
            event_type: event_type.to_string(),
            timestamp: now.to_string(),
            is_duplicate,
        },
    )
    .await
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            std::env::var("RUST_LOG").unwrap_or_else(|_| "bitforge=info".into()),
        )
        .init();

    let nats_url =
        std::env::var("NATS_URL").unwrap_or_else(|_| "nats://localhost:4222".into());
    let data_dir =
        std::env::var("DATA_DIR").unwrap_or_else(|_| "/data".into());

    info!("Bit-Forge starting");

    let db = Arc::new(Mutex::new(init_db(&data_dir)?));
    let client = async_nats::connect(&nats_url).await?;
    let js = jetstream::new(client);

    js.get_or_create_stream(jetstream::stream::Config {
        name: "PHONOLITH_HASH".into(),
        subjects: vec!["phonolith.hash.>".into()],
        retention: jetstream::stream::RetentionPolicy::WorkQueue,
        max_age: Duration::from_secs(86_400),
        ..Default::default()
    })
    .await?;

    let consumer = js
        .get_or_create_consumer(
            "PHONOLITH_FS",
            jetstream::consumer::pull::Config {
                durable_name: Some("bitforge".into()),
                filter_subjects: vec![
                    "phonolith.fs.created".into(),
                    "phonolith.fs.modified".into(),
                    "phonolith.fs.deleted".into(),
                    "phonolith.fs.renamed".into(),
                ],
                ..Default::default()
            },
        )
        .await?;

    info!("Bit-Forge listening for filesystem events");

    let mut messages = consumer.messages().await?;
    while let Some(msg) = messages.next().await {
        match msg {
            Ok(msg) => {
                let payload = msg.payload.clone();
                let js = js.clone();
                let db = db.clone();
                msg.ack().await.ok();
                task::spawn(async move {
                    if let Err(e) = process_fs_event(payload, js, db).await {
                        error!("Error: {e}");
                    }
                });
            }
            Err(e) => error!("Message error: {e}"),
        }
    }

    Ok(())
}
