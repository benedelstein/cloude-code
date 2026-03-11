-- Global attachment metadata (R2 blobs are referenced by object_key)
CREATE TABLE attachments (
  id TEXT PRIMARY KEY,
  uploader_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  object_key TEXT NOT NULL UNIQUE,
  filename TEXT NOT NULL,
  media_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  session_id TEXT REFERENCES sessions(id) ON DELETE CASCADE,
  bound_at TEXT
);

CREATE INDEX idx_attachments_uploader_created
  ON attachments(uploader_user_id, created_at DESC);
CREATE INDEX idx_attachments_session_created
  ON attachments(session_id, created_at DESC);

-- Queue for deferred R2 deletions during bulk session deletion (consumed by scheduled worker)
CREATE TABLE attachment_gc_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  object_key TEXT NOT NULL UNIQUE,
  retry_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
