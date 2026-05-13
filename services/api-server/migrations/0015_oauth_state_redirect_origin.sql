-- Record the origin that initiated the OAuth flow so the prod bouncer can 302
-- back to the correct preview/preview-branch origin after GitHub's callback.
ALTER TABLE oauth_states ADD COLUMN redirect_origin TEXT;
