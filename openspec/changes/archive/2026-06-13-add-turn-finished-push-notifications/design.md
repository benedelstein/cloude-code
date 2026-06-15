## Context

Cloude Code already has separate ownership boundaries for session execution and user-level fanout. `SessionAgentDO` owns turn lifecycle and persists session summary state to D1 through `SessionSummaryService`; user-facing live updates are handled through a separate user-scoped stream. Push notifications should follow the same separation: session code emits a semantic notification event, while a notifications module owns token storage, queue consumption, and Firebase Cloud Messaging delivery.

The iOS app uses generated API types from `packages/api-contract`. Notification payloads will eventually be consumed by iOS tap handling, so the payload contract should live in the API contract even though the app does not implement deep-link routing in this change. The generated Swift code is decode-tolerant for enums and discriminated unions by default, so future notification variants can decode as unknown instead of breaking older clients.

Gallery used Firebase EventArc plus the Firebase Admin SDK: domain code published a typed notification event, the event handler converted it into an FCM message, and iOS decoded a stringified JSON `payload` from `userInfo`. This change mirrors that architecture with Cloudflare Queues and FCM HTTP v1.

## Goals / Non-Goals

**Goals:**

- Register iOS FCM tokens through an authenticated API route.
- Store FCM tokens in D1 by user id and stable device id.
- Publish a queued notification event when a non-aborted agent turn finishes.
- Deliver turn-finished push notifications through FCM HTTP v1.
- Include a structured, enum-discriminated payload in the FCM string data so iOS can route from notification taps later.
- Keep API-side notification code in its own `services/api-server/src/modules/notifications` module.

**Non-Goals:**

- No notification feed or persisted notification history.
- No strict idempotency or exactly-once delivery guarantee.
- No iOS notification tap deep-link implementation.
- No additional notification types beyond `TURN_FINISHED` in this change.
- No Firebase Firestore/Auth/Admin SDK dependency.

## Decisions

### Use a generic notification queue with one initial payload variant

The queue message will represent a user notification event, not a low-level FCM send request and not a turn-specific job:

```ts
type NotificationQueueMessage = {
  id: string;
  toUserId: string;
  title: string;
  body: string;
  payload: NotificationPayload;
  createdAt: string;
};
```

`NotificationPayload` will be defined in `packages/api-contract` as a discriminated union with one initial variant:

```ts
NotificationType = "TURN_FINISHED"
TurnFinishedNotificationPayload = {
  type: "TURN_FINISHED";
  version: 1;
  sessionId: uuid;
  messageId: string;
  repoFullName: string;
}
```

Rationale: producers publish semantic notification events, and the notifications module owns delivery. This keeps the queue reusable for future notification types without adding those types now.

Alternative considered: queue a `TurnFinishedNotificationJob`. That is narrower, but it would push notification-specific construction into session code and make later notification sources less consistent.

### Store FCM token rows, not notification records

Add a D1 `fcm_tokens` table:

```sql
CREATE TABLE fcm_tokens (
  user_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  token TEXT NOT NULL,
  platform TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  invalidated_at TEXT,
  PRIMARY KEY (user_id, device_id),
  UNIQUE (token)
);
```

The API route upserts by `(user_id, device_id)` and replaces the token when FCM rotates it. Invalid tokens are soft-invalidated with `invalidated_at`.

Rationale: the stable install/device id is the long-lived local handle; the FCM token is rotating delivery material attached to that device. The table name still reflects the product concept, `fcm_tokens`, rather than `devices`.

Alternative considered: store notification rows for idempotency. This change does not need a feed or strict dedupe. Queue message `id` is a random correlation id only and does not prevent duplicate sends.

### Use Cloudflare Queues as the EventArc equivalent

`SessionAgentDO` will call a notification publisher after a non-aborted turn is persisted. The publisher enqueues `NotificationQueueMessage` into a Cloudflare Queue. The queue consumer loads active FCM tokens for `toUserId`, builds FCM HTTP v1 messages, sends them, and invalidates dead tokens.

Rationale: FCM delivery involves external I/O and Google OAuth token minting. Queueing keeps that work off the turn-finish path and gives retry/DLQ behavior without inventing a D1 polling queue.

Alternative considered: `ctx.waitUntil()` direct send from `onTurnFinished`. That is simpler but couples turn finalization to Firebase delivery and provides weaker retry/observability boundaries.

### Use FCM HTTP v1 with a base64 service account secret

The Worker will store `FIREBASE_SERVICE_ACCOUNT_JSON_BASE64` as a secret. The FCM provider decodes/parses it at the integration boundary, signs a Google OAuth JWT with `jose` and the service account private key, exchanges it for an access token, and sends to `https://fcm.googleapis.com/v1/projects/{projectId}/messages:send`.

Rationale: Cloudflare Workers are not a Node Firebase Admin SDK environment. HTTP v1 keeps dependencies narrow and Worker-compatible. The base64 JSON secret keeps deployment simple.

### Send string-only FCM data with stringified structured payload

FCM `message.notification` carries display title/body. FCM `message.data` carries string values for app code:

```ts
data: {
  notification_id: event.id,
  notification_type: event.payload.type,
  payload: JSON.stringify(event.payload),
}
```

The APNs config will include the normal alert sound under `apns.payload.aps.sound`.

Rationale: iOS `userInfo` receives string data, and Gallery already uses a stringified `payload` field decoded by the app. Including both `notification_type` and `payload` lets iOS route cheaply from the type enum and decode full structured data when needed.

## Risks / Trade-offs

- Duplicate queue delivery can produce duplicate pushes -> accept in v1; add a persisted notification table only when feed or strict dedupe matters.
- Queue enqueue can fail after the assistant message is already committed -> log the failure; notification delivery is a convenience, not source-of-truth state.
- FCM payload schema changes can break old iOS builds -> keep `type` stable, include `version`, and rely on generated unknown cases for future enum/union variants.
- Invalid FCM token handling can accidentally remove valid tokens if errors are misclassified -> only invalidate documented terminal token errors such as unregistered tokens and invalid token responses, not transient send failures.
- Firebase/APNs setup has external console steps -> document required Firebase project, APNs key, `GoogleService-Info.plist`, and Worker secret before release.

## Migration Plan

1. Add D1 migration and deploy it before token upload is enabled.
2. Add Queue producer/consumer bindings in Wrangler and create the Cloudflare Queues, including DLQ if supported in the environment.
3. Set `FIREBASE_SERVICE_ACCOUNT_JSON_BASE64` in Worker secrets.
4. Ship server-side route, repository, publisher, queue consumer, and FCM provider behind normal deployment.
5. Ship iOS Firebase Messaging setup and token upload.
6. Validate on a real/sandbox iOS device because simulators do not provide the same APNs/FCM behavior.
7. Rollback by disabling the iOS token upload or removing the turn-finished publisher call; stored FCM tokens can remain inert.

## Open Questions

- What exact notification title/body copy should ship for turn completion?
- Should token upload request notification authorization immediately at launch, only after sign-in, or behind a user-facing prompt later?
- Should production and development builds use separate Firebase projects or separate Firebase apps in one project?
