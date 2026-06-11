# auth-token-refresh Specification

## Purpose
TBD - created by archiving change add-auth-token-refresh. Update Purpose after archive.
## Requirements
### Requirement: Native token exchange issues access/refresh pair
When `POST /auth/token` is called with `client: "native"`, the server SHALL create a refresh-session family and return an access token (30-minute TTL), `accessTokenExpiresAt`, a refresh token (60-day TTL), and `refreshTokenExpiresAt`, alongside the existing `token`/`user`/`hasInstallations`/`installUrl` fields (`token` equals the access token).

#### Scenario: Native client exchanges OAuth code
- **WHEN** a valid `{code, state, client: "native"}` is posted to `/auth/token`
- **THEN** the response contains `accessTokenExpiresAt`, `refreshToken`, and `refreshTokenExpiresAt`, and the access token authenticates requests via `Authorization: Bearer`

#### Scenario: Legacy clients are unaffected
- **WHEN** `{code, state}` is posted without a `client` field
- **THEN** the response is byte-identical in shape to the current contract (no `refreshToken` or expiry keys) and a 30-day session token is issued

### Requirement: Refresh endpoint rotates tokens
The server SHALL expose `POST /auth/refresh` accepting `{refreshToken}` without requiring an Authorization header. A valid refresh SHALL rotate the refresh token, replace the family's access token row, extend the refresh expiry (sliding 60 days), and return the new pair with expiries.

#### Scenario: Successful refresh
- **WHEN** a valid, unexpired refresh token is posted to `/auth/refresh`
- **THEN** a new access token and new refresh token are returned, and the previous access token no longer authenticates

#### Scenario: Invalid or expired refresh token
- **WHEN** an unknown or expired refresh token is posted
- **THEN** the server responds 401 with code `INVALID_REFRESH_TOKEN`

### Requirement: Rotation grace window and reuse detection
After rotation, the server SHALL accept the immediately-previous refresh token for 60 seconds (retry tolerance). Presentation of the previous token outside that window SHALL be treated as reuse: the server MUST revoke the entire session family (refresh token and current access token).

#### Scenario: Retry within grace window
- **WHEN** the previous refresh token is presented within 60 seconds of rotation
- **THEN** the refresh succeeds

#### Scenario: Reuse outside grace window
- **WHEN** the previous refresh token is presented more than 60 seconds after rotation
- **THEN** the server responds 401 and both the refresh token and the family's access token are revoked

### Requirement: Logout revokes the session family
When `POST /auth/logout` is called with an access token that belongs to a refresh-session family, the server SHALL revoke the family (refresh token included), not just the access row. Legacy web tokens keep current logout behavior.

#### Scenario: Native logout
- **WHEN** a native access token is used to call `/auth/logout`
- **THEN** subsequent use of the access token returns 401 and the paired refresh token is rejected

### Requirement: Refresh tokens stored hashed
The server SHALL store only SHA-256 hashes of refresh tokens; the raw value is returned to the client exactly once per rotation.

#### Scenario: Database inspection
- **WHEN** the `auth_refresh_sessions` table is read
- **THEN** no raw refresh token values are present

