-- Connectors injected by the on-sprite egress proxy. Stored as a JSON array of
-- connector configs with AES-GCM-encrypted keys inline. The plaintext key is
-- never stored and never reaches the sprite.
ALTER TABLE repo_environments ADD COLUMN connectors_json TEXT NOT NULL DEFAULT '[]';
