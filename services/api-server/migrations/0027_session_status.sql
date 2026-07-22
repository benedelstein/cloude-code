-- Session setup status mirrored from the session Durable Object.
-- Existing rows default to 'ready' so long-finished sessions never show as preparing.
ALTER TABLE sessions ADD COLUMN status TEXT NOT NULL DEFAULT 'ready';
