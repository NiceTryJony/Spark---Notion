/// Local network sync — super alpha.
///
/// Architecture:
///   HOST  → starts an axum HTTP server on a random free port
///           → UI shows "192.168.x.x:PORT" to share
///   GUEST → enters the address, POSTs its own notes, receives host notes
///           → both sides merge (last updated_at wins per-id)
///
/// Security: zero — LAN only, no auth, treat it like a USB cable.

use axum::{
    extract::State as AxumState,
    http::StatusCode,
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    net::SocketAddr,
    sync::{Arc, Mutex},
};
use tokio::sync::oneshot;

use crate::db::{Database};

// ── Public API types ──────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone)]
pub struct SyncNote {
    pub id: i64,
    pub content: String,
    pub tags: Vec<String>,
    pub created_at: i64,
    pub updated_at: i64,
    pub pinned: bool,
    pub checked: Vec<bool>,
    pub deleted: bool,
}

#[derive(Serialize, Deserialize)]
pub struct SyncPayload {
    pub notes: Vec<SyncNote>,
}

#[derive(Serialize)]
pub struct SyncResult {
    pub merged: usize,
    pub received: usize,
}

// ── Server state ──────────────────────────────────────────────────────────────

struct ServerState {
    db: Arc<Mutex<Database>>,
}

// ── Running server handle (stored in AppState) ────────────────────────────────

pub struct SyncServerHandle {
    pub addr: SocketAddr,
    shutdown_tx: oneshot::Sender<()>,
}

impl SyncServerHandle {
    pub fn stop(self) {
        let _ = self.shutdown_tx.send(());
    }
}

// ── Start server ──────────────────────────────────────────────────────────────

/// Binds on `0.0.0.0:0` (OS picks a free port), returns the handle.
pub async fn start_server(db: Arc<Mutex<Database>>) -> Result<SyncServerHandle, String> {
    let state = Arc::new(ServerState { db });

    let app = Router::new()
        .route("/notes", get(handle_get_notes))
        .route("/sync", post(handle_post_sync))
        .with_state(state);

    let listener = tokio::net::TcpListener::bind("0.0.0.0:0")
        .await
        .map_err(|e| e.to_string())?;

    let addr = listener.local_addr().map_err(|e| e.to_string())?;
    let (tx, rx) = oneshot::channel::<()>();

    tokio::spawn(async move {
        axum::serve(listener, app)
            .with_graceful_shutdown(async {
                let _ = rx.await;
            })
            .await
            .ok();
    });

    Ok(SyncServerHandle {
        addr,
        shutdown_tx: tx,
    })
}

// ── GET /notes ────────────────────────────────────────────────────────────────

async fn handle_get_notes(
    AxumState(state): AxumState<Arc<ServerState>>,
) -> Result<Json<SyncPayload>, StatusCode> {
    let db = state.db.lock().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let notes = db
        .get_all_for_sync()
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(SyncPayload { notes }))
}

// ── POST /sync ────────────────────────────────────────────────────────────────
/// Guest posts its notes → host merges them, returns its own notes.

async fn handle_post_sync(
    AxumState(state): AxumState<Arc<ServerState>>,
    Json(payload): Json<SyncPayload>,
) -> Result<Json<SyncPayload>, StatusCode> {
    let db = state.db.lock().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    db.merge_sync_notes(&payload.notes)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let all = db
        .get_all_for_sync()
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(Json(SyncPayload { notes: all }))
}

// ── Client-side sync ──────────────────────────────────────────────────────────

/// Connect to a host, exchange notes, return count of merged notes.
pub async fn sync_as_guest(
    host_addr: &str,
    db: Arc<Mutex<Database>>,
) -> Result<SyncResult, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?;

    // Collect local notes to send
    let local_notes = {
        let db = db.lock().map_err(|e| e.to_string())?;
        db.get_all_for_sync().map_err(|e| e.to_string())?
    };

    let base_url = if host_addr.starts_with("http") {
        host_addr.to_string()
    } else {
        format!("http://{}", host_addr)
    };

    // POST our notes → receive host notes
    let response = client
        .post(format!("{}/sync", base_url))
        .json(&SyncPayload {
            notes: local_notes.clone(),
        })
        .send()
        .await
        .map_err(|e| format!("Connection failed: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("Host returned error: {}", response.status()));
    }

    let host_payload: SyncPayload = response
        .json()
        .await
        .map_err(|e| format!("Invalid response: {}", e))?;

    let received = host_payload.notes.len();

    // Merge host notes into local DB
    {
        let db = db.lock().map_err(|e| e.to_string())?;
        db.merge_sync_notes(&host_payload.notes)
            .map_err(|e| e.to_string())?;
    }

    Ok(SyncResult {
        merged: received,
        received,
    })
}

// ── Local IP helper ───────────────────────────────────────────────────────────

/// Returns the first non-loopback IPv4 address (best-effort).
pub fn local_ip() -> String {
    // Connect to a public address (no data sent) to discover the local IP
    if let Ok(socket) = std::net::UdpSocket::bind("0.0.0.0:0") {
        if socket.connect("8.8.8.8:80").is_ok() {
            if let Ok(addr) = socket.local_addr() {
                return addr.ip().to_string();
            }
        }
    }
    "127.0.0.1".to_string()
}