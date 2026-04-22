/// Local network sync — PIN-protected.
///
/// Architecture:
///   HOST  → starts an axum HTTP server on a random free port
///           → generates a random 6-digit PIN
///           → UI shows "192.168.x.x:PORT PIN: 123456" to share
///   GUEST → enters the address + PIN, POSTs its own notes, receives host notes
///           → both sides merge (last updated_at wins per-id)
///
/// Security: Simple PIN protection for LAN access. Still LAN-only, no encryption.

use axum::{
    extract::State as AxumState,
    http::{StatusCode},
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use std::{
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
    #[serde(default)]
    pub pin: String,  // ← NEW: PIN for authorization
}

#[derive(Serialize)]
pub struct SyncResult {
    pub merged: usize,
    pub received: usize,
}

// ── Server state ──────────────────────────────────────────────────────────────

struct ServerState {
    db: Arc<Mutex<Database>>,
    pin: String,  // ← NEW: Host's PIN
}

// ── Running server handle (stored in AppState) ────────────────────────────────

pub struct SyncServerHandle {
    pub addr: SocketAddr,
    pub pin: String,  // ← NEW: PIN to share with guest
    shutdown_tx: oneshot::Sender<()>,
}

impl SyncServerHandle {
    pub fn stop(self) {
        let _ = self.shutdown_tx.send(());
    }
}

/// Generate a random 6-digit PIN
fn generate_pin() -> String {
    use rand::Rng;
    let pin: u32 = rand::thread_rng().gen_range(100_000..=999_999);
    pin.to_string()
}

// ── Start server ──────────────────────────────────────────────────────────────

/// Binds on `0.0.0.0:0` (OS picks a free port), returns the handle with PIN.
pub async fn start_server(db: Arc<Mutex<Database>>) -> Result<SyncServerHandle, String> {
    let pin = generate_pin();
    let state = Arc::new(ServerState { db, pin: pin.clone() });

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
        pin,  // ← NEW: PIN to share
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
    Ok(Json(SyncPayload { notes, pin: String::new() }))
}

// ── POST /sync ────────────────────────────────────────────────────────────────
/// Guest posts its notes + PIN → host validates PIN, merges notes, returns its own notes.

async fn handle_post_sync(
    AxumState(state): AxumState<Arc<ServerState>>,
    Json(payload): Json<SyncPayload>,
) -> Result<Json<SyncPayload>, StatusCode> {
    // ── Validate PIN ──────────────────────────────────────────────────────────
    if payload.pin != state.pin {
        eprintln!("[sync] Invalid PIN: got '{}', expected '{}'", payload.pin, state.pin);
        return Err(StatusCode::UNAUTHORIZED);
    }

    let db = state.db.lock().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    db.merge_sync_notes(&payload.notes)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let all = db
        .get_all_for_sync()
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(Json(SyncPayload { 
        notes: all,
        pin: String::new(),  // Don't echo PIN back
    }))
}

// ── Client-side sync ──────────────────────────────────────────────────────────

/// Connect to a host, exchange notes with PIN, return count of merged notes.
pub async fn sync_as_guest(
    host_addr: &str,
    pin: &str,
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

    // POST our notes + PIN → receive host notes
    let response = client
        .post(format!("{}/sync", base_url))
        .json(&SyncPayload {
            notes: local_notes.clone(),
            pin: pin.to_string(),  // ← NEW: Send PIN
        })
        .send()
        .await
        .map_err(|e| format!("Connection failed: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("Host returned error: {} (wrong PIN?)", response.status()));
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