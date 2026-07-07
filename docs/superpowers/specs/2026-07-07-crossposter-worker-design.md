# Divine Crossposter Cloudflare Worker Design

Date: 2026-07-07
Status: Draft for review

## Purpose

`divine-crossposter` lets Divine users opt in to publishing their own original Divine videos to connected external platforms: Instagram Reels, TikTok, X, and YouTube Shorts.

The service is distribution infrastructure, not identity proof. It may reuse OAuth provider patterns and app configuration from `divine-identify-verification-service`, but it owns publishing consent, publish tokens, posting preferences, job state, retries, and external post IDs.

## Product Scope

V1 supports user-owned original Divine videos only.

Users can:

- connect one or more external platforms with publish consent
- choose `manual` or `automatic` behavior per connected platform
- manually trigger a crosspost from Divine web or mobile for an eligible video
- enable automatic crossposting for future eligible videos only
- see per-platform posting status in web or mobile
- disconnect a platform and stop future posting

V1 does not include caption editing, per-platform hashtag editing, media trimming, watermarking, remix support, archived Vine bulk publishing, repost publishing, comments sync, analytics import, or paid campaign workflows.

## Architecture

Build `divine-crossposter` as a TypeScript/Hono Cloudflare Worker.

Cloudflare is a good fit because the service is mostly HTTP orchestration: OAuth callbacks, token refresh, user preference APIs, job creation, queue dispatch, status reads, and platform API calls. It also matches the implementation shape of `divine-identify-verification-service`, which already handles similar provider OAuth concerns.

Use Cloudflare Queues for crosspost jobs. Use D1 for V1 storage because the initial data model is small, Worker-native, and local to this service. Move to Postgres through Hyperdrive only if later reporting, admin workflows, or cross-service joins outgrow D1.

Do not put crossposting inside `divine-identify-verification-service`. Verification proves account ownership; crossposting grants permission to publish. Those consent surfaces and security risks are different.

## Components

### HTTP API Worker

Owns client-facing routes for Divine web and mobile:

- platform connection state
- OAuth start and callback routes
- crosspost preferences
- manual job creation
- job status reads
- disconnect and token revocation flows

Clients call this service rather than calling TikTok, Instagram, X, or YouTube directly. OAuth redirects may leave the app/browser, but final connection state is stored server-side.

### Platform OAuth Adapters

One adapter per platform:

- `instagram`
- `tiktok`
- `x`
- `youtube`

Adapters handle authorization URLs, callback exchange, refresh token exchange, account identity fetch, token revocation when supported, and publishing requests.

Where practical, adapter code should follow the route shape, validation style, and provider-specific lessons from `divine-identify-verification-service`. Shared code can be extracted later if duplication becomes real.

### Preferences Store

Stores per-user, per-platform settings:

- connected account identifier
- display handle or channel name
- posting mode: `manual` or `automatic`
- enabled timestamp
- disabled timestamp, when disconnected
- selected default visibility where a platform requires it

Automatic mode only applies to videos created after `automatic_enabled_at`.

### Job Store

Stores every crosspost attempt with idempotency:

- Divine user pubkey
- Divine video event ID
- platform
- external account ID
- source media URL and hash from the Divine event
- caption snapshot from the Divine event
- job status
- retry count and next retry time
- external post ID or URL after success
- structured error code after failure

The unique job key is `(pubkey, video_event_id, platform, external_account_id)`. Repeated manual taps or duplicate automatic triggers return the existing job instead of creating a duplicate external post.

### Queue Consumer

Processes one platform publish job at a time:

1. load job and connection
2. refresh the platform token if needed
3. fetch or provide the Divine media URL according to platform requirements
4. publish to the target platform
5. poll processing state when required
6. store final external post ID or failure state

The consumer should prefer external platform fetch-from-URL flows where available. It should not do CPU-heavy video processing in the Worker.

### Auto Trigger Reconciler

Runs as a Cloudflare Scheduled Worker inside `divine-crossposter`.

The primary automatic trigger is still a push from Divine web or mobile after a successful publish. The reconciler is the backup path: it periodically scans users with automatic mode enabled, asks Funnelcake for recent eligible videos since each user's cursor, and calls the same idempotent job-creation logic used by the client push path.

This gives automatic crossposting a small poll/push bot without making polling the only source of truth. If a client publishes a video and fails before notifying crossposter, the next reconciliation pass catches it. Duplicate triggers are safe because job creation is keyed by `(pubkey, video_event_id, platform, external_account_id)`.

### Future Media Normalization Service

If platforms reject Divine media because of codec, aspect ratio, duration, or file-size constraints, add a separate normalization service. That service can run on GKE or Cloud Run and output a platform-ready temporary asset. Do not hide transcoding inside the Worker.

## Auth And Consent

Divine clients authenticate to `divine-crossposter` using the existing Divine Keycast/Login bearer-token model in V1. NIP-98 can be added later for callers that need signed HTTP auth.

Platform identity verification is not enough to publish. A user who has verified a TikTok, YouTube, X, or Instagram identity must still authorize publishing scopes before crossposting can happen.

The connect flow should make the account and permission clear:

- "Connect TikTok for crossposting"
- show the external account returned by the provider
- store publish grant only after callback succeeds
- allow disconnect from Divine settings

## Token Security

Refresh tokens and long-lived access tokens are sensitive. Store them encrypted at rest using a Worker secret-backed encryption key or a platform-provided secret binding pattern. Never log raw access tokens, refresh tokens, authorization codes, client secrets, or full OAuth callback URLs containing codes.

Token records should include:

- provider
- Divine pubkey
- external account ID
- encrypted access token
- encrypted refresh token when present
- expiry timestamp
- granted scopes
- rotation metadata
- last successful refresh timestamp

If a refresh fails with an authorization error, mark the connection `needs_reauth` and stop automatic jobs for that platform until the user reconnects.

## Data Flow

### Connect Platform

1. User opens settings in Divine web or mobile.
2. Client calls `POST /connections/:platform/start`.
3. Worker creates OAuth state bound to the Divine user and return URL.
4. User authorizes the platform.
5. Provider redirects to `GET /connections/:platform/callback`.
6. Worker exchanges the code, fetches account identity, encrypts tokens, and stores the connection.
7. Worker redirects back to the client with a connection result.

### Manual Crosspost

1. User presses Crosspost on an eligible Divine video.
2. Client calls `POST /videos/:event_id/crossposts` with selected platforms.
3. Worker authenticates the Divine user.
4. Worker verifies the video belongs to the user and is eligible.
5. Worker snapshots caption and media fields from the Divine event.
6. Worker creates or returns idempotent jobs.
7. Worker enqueues jobs.
8. Client polls or subscribes to job status.

### Automatic Crosspost

1. User enables automatic mode for a connected platform.
2. Worker stores `automatic_enabled_at`.
3. After a future Divine video publish succeeds, the publishing client calls `divine-crossposter` with the newly published event ID.
4. Worker fetches the event from Funnelcake, verifies ownership and event timestamp, checks preferences, and creates idempotent jobs for enabled platforms.

The Scheduled Worker reconciler also checks recent videos for users with automatic mode enabled. It maintains per-user cursors, ignores videos older than `automatic_enabled_at`, and enqueues any missing jobs through the same idempotent creation path.

This keeps V1 explicit and easy to reason about from web and mobile while still covering missed client callbacks. A later version can add a relay/event-stream consumer if polling recent videos becomes too slow or too expensive.

## Platform Publishing Notes

Instagram Reels uses Meta's content publishing flow: create a media container with `media_type=REELS` and a public video URL, wait for processing, then publish the container.

TikTok Direct Post requires publish consent, creator info handling, initialization, and export/upload to TikTok. Unaudited clients may be limited to private visibility until review is complete.

X requires OAuth permission, media upload for video, then post creation with the uploaded media ID.

YouTube Shorts uses the YouTube Data API upload flow. Shorts classification is handled by YouTube based on video format/duration and metadata conventions rather than a separate "shorts" endpoint.

Each platform adapter must normalize platform errors into crossposter error codes such as `rate_limited`, `needs_reauth`, `media_rejected`, `platform_review_required`, `processing_timeout`, and `unknown_platform_error`.

## Error Handling And Retries

Job statuses:

- `queued`
- `uploading`
- `processing`
- `posted`
- `failed`
- `needs_reauth`
- `skipped`

Retry transient platform failures with exponential backoff and jitter. Do not retry permanent failures such as revoked auth, unsupported media, missing publish permission, or platform account ineligible for publishing.

Old jobs should not surprise-post days later. V1 expires unposted jobs after 48 hours.

Manual retries should reuse the existing job record when possible and create a new attempt record if the prior failure needs audit history.

## API Shape

Candidate routes:

- `GET /health`
- `GET /platforms`
- `GET /connections`
- `POST /connections/:platform/start`
- `GET /connections/:platform/callback`
- `DELETE /connections/:platform/:connection_id`
- `GET /preferences`
- `PUT /preferences/:platform`
- `POST /videos/:event_id/crossposts`
- `GET /videos/:event_id/crossposts`
- `GET /jobs/:job_id`

The exact route names can change during implementation, but the service boundary should remain stable: clients manage connections/preferences and create/read jobs; platform details stay server-side.

## Storage

Use D1 with these logical tables:

- `oauth_states`: short-lived OAuth state records bound to a Divine pubkey, provider, return URL, and expiry
- `connections`: encrypted provider token records and external account metadata
- `preferences`: per-user, per-platform mode and automatic enablement timestamp
- `auto_cursors`: per-user reconciliation cursors for recent-video polling
- `jobs`: one row per `(pubkey, video_event_id, platform, external_account_id)`
- `job_attempts`: append-only attempt history for retries, platform responses, and audit-safe error details

Use Cloudflare Queues as the execution transport. D1 is the source of truth for job state.

## Testing

Unit tests:

- OAuth state creation and validation
- token encryption/decryption boundaries
- idempotent job key creation
- preference logic for manual and automatic mode
- future-only automatic eligibility
- platform error normalization

Integration tests with mocked platform APIs:

- successful connect callback
- revoked token refresh leading to `needs_reauth`
- manual crosspost duplicate prevention
- automatic crosspost ignores videos older than `automatic_enabled_at`
- reconciler enqueues missed automatic jobs once and advances cursors safely
- queue consumer success and retry paths

Manual verification before launch:

- connect and disconnect each platform in a non-production app
- manual crosspost from web
- manual crosspost from mobile
- automatic mode for a newly published test video
- reconnect flow after revoked access
- platform-specific media rejection handling

## Rollout

Start with an internal allowlist and one or two platforms enabled behind configuration flags. TikTok and Instagram may require app review before public posting works as expected, so the user experience must handle "connected but limited" states without treating them as bugs.

Ship manual crossposting first, then automatic crossposting once token refresh, duplicate protection, and job state are proven.

## Implementation Defaults

- Storage: D1 for V1.
- Automatic trigger: web/mobile calls crossposter after a successful future Divine publish; a Scheduled Worker reconciler polls recent videos for opted-in users as the backup path.
- Divine auth: accept the same Keycast/Login bearer-token model used by Divine clients; add NIP-98 later only if a caller needs it.
- OAuth code sharing: copy provider adapter patterns from `divine-identify-verification-service` first; extract a shared package only after duplication is proven.
- Platform readiness: ship provider support behind per-platform feature flags so app-review delays do not block the whole service.
