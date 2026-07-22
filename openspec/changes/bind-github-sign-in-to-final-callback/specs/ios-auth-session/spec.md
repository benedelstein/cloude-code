## ADDED Requirements

### Requirement: Native sign-in is bound to the final callback
The iOS app SHALL keep the attempt claim token in local function memory, open exactly one `ASWebAuthenticationSession`, validate that its final callback has the started attempt ID and a nonempty completion code, and send all three values to native completion before adopting the session through `TokenCoordinator`. The claim token and completion code SHALL NOT be persisted or logged.

#### Scenario: Matching final callback
- **WHEN** the single web-auth session returns the started attempt ID and completion code without an error
- **THEN** iOS sends the attempt ID, claim token, and completion code exactly once and adopts the returned session

#### Scenario: Installation is missing
- **WHEN** the server chains OAuth into GitHub App setup
- **THEN** the same web-auth session remains open until the setup callback returns the completion code

#### Scenario: Missing or mismatched callback proof
- **WHEN** the callback omits the completion code, reports an error, or has another attempt ID
- **THEN** iOS makes no completion request and shows the normal retryable sign-in error

### Requirement: Native cancellation is silent and cannot issue a session
The iOS app SHALL treat `ASWebAuthenticationSessionError.canceledLogin` as a silent signed-out outcome at every point in the OAuth and installation journey. It SHALL NOT poll or call native completion after cancellation.

#### Scenario: Cancellation before OAuth
- **WHEN** the user dismisses the web-auth session before OAuth finishes
- **THEN** iOS remains signed out without an error and makes zero completion calls

#### Scenario: Cancellation after OAuth
- **WHEN** the user dismisses during installation or before the final callback after OAuth established identity
- **THEN** iOS remains signed out without an error and makes zero completion calls

#### Scenario: Retry after cancellation
- **WHEN** the user retries sign-in after cancellation
- **THEN** iOS starts a new server attempt and opens one new web-auth session
