## Why

Users can miss when an agent turn finishes if they leave the iOS app or lock the device. A push notification on turn completion gives them a lightweight return path to the finished session without keeping the app active.

## What Changes

- Add a notifications API contract with FCM token upload types and a typed notification payload contract.
- Add authenticated API server routes for uploading iOS FCM tokens by user id and device id.
- Store FCM tokens in D1 keyed by user id and device id, with token rotation and invalidation support.
- Add a Cloudflare Queue-backed notification event path for turn-finished notifications.
- Send turn-finished notifications through Firebase Cloud Messaging HTTP v1 using a base64-encoded Firebase service account JSON secret.
- Add iOS Firebase Messaging setup using Swift Package Manager and upload FCM tokens to the API server.
- Do not implement notification tap deep linking yet; include enough structured payload data for the iOS app to route to a session later.

## Capabilities

### New Capabilities
- `push-notifications`: User device token registration and queued push notification delivery for agent turn completion.

### Modified Capabilities

None.

## Impact

- `packages/api-contract`: add notification request/response and payload schemas, then regenerate `apps/ios/Modules/CoreAPI`.
- `services/api-server`: add a `notifications` module, D1 migration, queue binding/consumer, Firebase HTTP v1 provider, and turn-finished publisher integration.
- `services/api-server/wrangler.jsonc`: add Cloudflare Queue producer/consumer bindings and Firebase secret documentation.
- `apps/ios`: add Firebase Messaging via SPM, configure Firebase, request/register for push notifications, persist a stable device id, and upload FCM tokens after auth is available.
- External setup: Firebase project/APNs configuration and `FIREBASE_SERVICE_ACCOUNT_JSON_BASE64` Worker secret.
