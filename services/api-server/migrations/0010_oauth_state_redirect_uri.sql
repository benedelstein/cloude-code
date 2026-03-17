-- Store the frontend callback URL so the API server can redirect back after GitHub OAuth
ALTER TABLE oauth_states ADD COLUMN redirect_uri TEXT;
