## 1. Contract And Storage

- [x] 1.1 Add `packages/api-contract/src/notifications.ts` with FCM token upload schemas, `NotificationType`, `TurnFinishedNotificationPayload`, and `NotificationPayload` discriminated union.
- [x] 1.2 Export the notifications contract from `packages/api-contract/src/index.ts` and register any new source file required by the API type codegen manifest.
- [x] 1.3 Regenerate iOS CoreAPI output and fixtures from the API contract.
- [x] 1.4 Add a D1 migration for `fcm_tokens` with `(user_id, device_id)` primary key, unique token, timestamps, platform, and `invalidated_at`.
- [x] 1.5 Extend `Env` with `TURN_NOTIFICATION_QUEUE` and `FIREBASE_SERVICE_ACCOUNT_JSON_BASE64`.

## 2. API Server Notifications Module

- [x] 2.1 Create `services/api-server/src/modules/notifications` with routes, schemas, repository, services, provider, and types folders.
- [x] 2.2 Implement the authenticated `POST /notifications/fcm-tokens` route using the shared auth middleware and API contract schemas.
- [x] 2.3 Implement the FCM token repository upsert, active-token lookup, and invalidation methods.
- [x] 2.4 Implement `NotificationPublisher` that builds `NotificationQueueMessage` values and enqueues them to `TURN_NOTIFICATION_QUEUE`.
- [x] 2.5 Mount notification routes in API server composition and `src/index.ts`.

## 3. Queue Consumer And FCM Delivery

- [x] 3.1 Add Wrangler queue producer/consumer configuration for `turn-notifications` and its DLQ.
- [x] 3.2 Implement Firebase service account decoding, Google OAuth JWT assertion minting, access-token exchange, and access-token caching in the FCM HTTP v1 provider.
- [x] 3.3 Implement FCM message construction with display `notification` title/body and string-only `data` fields: `notification_id`, `notification_type`, and JSON-stringified `payload`.
- [x] 3.4 Implement queue consumer dispatch for `TURN_FINISHED` notification events, including per-token sends and terminal token invalidation.
- [x] 3.5 Wire the Worker `queue()` export to the notifications queue consumer without affecting existing `fetch` and `scheduled` handlers.

## 4. Turn-Finished Publisher Integration

- [x] 4.1 Inject or construct the notification publisher at the `SessionAgentDO` boundary without importing session runtime code into the notifications module.
- [x] 4.2 Publish a `TURN_FINISHED` notification event after non-aborted turn persistence, including `sessionId`, `messageId`, and `repoFullName` in the payload.
- [x] 4.3 Ensure aborted/canceled turns do not enqueue notifications.
- [x] 4.4 Log enqueue failures without failing turn completion or automatic pull request queueing.

## 5. iOS Firebase Messaging

- [x] 5.1 Add Firebase iOS SDK through Swift Package Manager with only the `FirebaseMessaging` product linked to the app target.
- [x] 5.2 Add the required Firebase configuration plist to the iOS app target.
- [x] 5.3 Configure Firebase at app launch and register for remote notifications.
- [x] 5.4 Add an app-level notification registration service/action that receives FCM token callbacks and uploads tokens through the API layer.
- [x] 5.5 Persist a stable local device id and reuse it across FCM token rotations.
- [x] 5.6 Retry token upload after sign-in or session restore when the FCM token arrived before authentication.
- [x] 5.7 Add iOS payload decode support for the string `payload` userInfo value using generated notification payload types, without implementing deep-link routing yet.

## 6. Verification

- [x] 6.1 Add focused API-server tests for token upsert, token invalidation, notification publisher queue payloads, and queue consumer FCM send behavior with a mocked provider.
- [x] 6.2 Add API contract codegen/Swift fixture verification for notification payload and token upload types.
- [x] 6.3 Run `pnpm build`, `pnpm lint`, `pnpm typecheck`, and relevant tests.
- [x] 6.4 Run iOS build and SwiftLint after Firebase Messaging integration.
- [ ] 6.5 Validate push delivery on a real iOS device or documented sandbox device path after Firebase/APNs configuration is available.
