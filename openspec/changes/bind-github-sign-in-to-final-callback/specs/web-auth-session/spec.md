## MODIFIED Requirements

### Requirement: OAuth returns through web completion
After OAuth and optional installation URL preparation, the API SHALL issue a one-time completion code and redirect to the attempt's allowlisted BFF completion route with the non-secret attempt ID and completion code. The raw claim token SHALL remain only in the encrypted HttpOnly cookie. OAuth denial SHALL return the attempt ID and error without a completion code.

#### Scenario: Matching callback and cookie
- **WHEN** the BFF receives a completion code and attempt ID matching its claim cookie
- **THEN** it combines the callback code with the cookie claim to request API completion

#### Scenario: Attempt IDs differ
- **WHEN** the completion query attempt ID does not match the BFF attempt cookie
- **THEN** the BFF does not call completion, preserves the different active attempt cookie, and returns that tab to the retry surface

#### Scenario: Callback lacks completion code
- **WHEN** the BFF receives a non-error callback without a completion code
- **THEN** it does not call completion or clear a newer attempt cookie

#### Scenario: OAuth denial reaches the BFF
- **WHEN** GitHub denies OAuth for a web attempt
- **THEN** the BFF clears only the matching attempt cookie and returns to the signed-out retry surface without calling completion

### Requirement: Web session is established before installation navigation
The BFF completion route SHALL require the matching encrypted claim cookie and callback completion code before API completion, even when a valid web session already exists. Successful completion SHALL replace the session cookie, clear the attempt cookie, and immediately redirect to a clean final or installation URL that contains no completion code. Without the exact callback-and-cookie pair, it SHALL preserve existing-session back-button and concurrent-tab behavior.

#### Scenario: Matching account switch succeeds
- **WHEN** a matching claim cookie and callback code arrive with an existing valid session cookie
- **THEN** the BFF completes the attempt first and replaces the existing session

#### Scenario: Callback receiver lacks starter cookie
- **WHEN** a browser receives the completion callback without the matching claim cookie
- **THEN** it cannot claim, does not call API completion, and preserves any newer claim cookie

#### Scenario: Starter lacks callback code
- **WHEN** the initiating browser has the claim cookie but no completion code
- **THEN** it cannot claim and does not call API completion

#### Scenario: Installation navigation follows session cookie
- **WHEN** successful completion returns a GitHub App installation URL
- **THEN** the BFF sets the web session and clears the attempt cookie before redirecting to installation

#### Scenario: Consumed callback is revisited
- **WHEN** the cleanly consumed completion URL is revisited with a valid normal session and no matching claim pair
- **THEN** the BFF redirects to the default signed-in route without calling completion
