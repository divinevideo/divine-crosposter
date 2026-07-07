# divine-crossposter

Cloudflare Worker service for opt-in crossposting of original Divine videos to external short-form platforms.

`divine-crossposter` owns publishing consent, OAuth publish grants, posting preferences, crosspost job state, retries, and external post IDs. It is distribution infrastructure; it is not identity proof. Divine clients call this Worker after a user connects a platform or asks to publish a video, and platform-specific OAuth and publishing details stay server-side.

The codebase is a TypeScript/Hono Cloudflare Worker using D1 for service-owned state, Cloudflare Queues for publish work, and a scheduled reconciler for missed automatic crosspost triggers.

License: MPL-2.0.

## Architecture

- HTTP API Worker: Hono routes for health, platform capability reads, OAuth connections, preferences, crosspost creation, and job reads.
- Platform adapters: one adapter per supported platform: `instagram`, `tiktok`, `x`, and `youtube`.
- D1 store: OAuth states, encrypted platform connections, user preferences, automatic cursors, jobs, and append-only job attempts.
- Queue consumer: consumes `{ "jobId": "..." }` messages from `CROSSPOST_QUEUE`, refreshes tokens when needed, calls the platform adapter, records attempts, and updates job state.
- Scheduled reconciler: Cloudflare Cron Trigger backup path for automatic crossposting. It polls recent eligible videos through Funnelcake and creates the same idempotent jobs as client-triggered automatic crossposts.

V1 does not transcode video in the Worker. If a platform requires media normalization later, that should be handled by a separate service that returns a platform-ready temporary asset.

## Local Setup

Install dependencies:

```bash
npm install
```

Start the local Worker:

```bash
npm run dev
```

Run with scheduled-trigger testing enabled:

```bash
npm run dev:scheduled
```

With `wrangler dev --test-scheduled` running, trigger the scheduled handler locally:

```bash
curl "http://localhost:8787/cdn-cgi/handler/scheduled?format=json"
```

Useful local checks:

```bash
npm run typecheck
npm run test:once
```

## Configuration

`wrangler.toml` defines these non-secret variables:

| Variable | Purpose |
| --- | --- |
| `KEYCAST_URL` | Base URL for Keycast bearer-token validation. Defaults to `https://login.divine.video`. |
| `FUNNELCAKE_URL` | Base URL for Funnelcake event/video lookups. Defaults to `https://api.divine.video`. |
| `OAUTH_REDIRECT_BASE` | Public Worker origin used to build OAuth callback URLs. |
| `ENABLE_INSTAGRAM` | Set to `true` only after Instagram OAuth credentials are configured. |
| `ENABLE_TIKTOK` | Set to `true` only after TikTok OAuth credentials are configured. |
| `ENABLE_X` | Set to `true` only after X OAuth credentials are configured. |
| `ENABLE_YOUTUBE` | Set to `true` only after Google/YouTube OAuth credentials are configured. |
| `YOUTUBE_DEFAULT_PRIVACY_STATUS` | Optional. One of `private`, `public`, or `unlisted`; defaults to `private`. |

Set secrets with Wrangler:

```bash
npx wrangler secret put TOKEN_ENCRYPTION_KEY
npx wrangler secret put INSTAGRAM_CLIENT_ID
npx wrangler secret put INSTAGRAM_CLIENT_SECRET
npx wrangler secret put TWITTER_CLIENT_ID
npx wrangler secret put TWITTER_CLIENT_SECRET
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put TIKTOK_CLIENT_KEY
npx wrangler secret put TIKTOK_CLIENT_SECRET
```

`TOKEN_ENCRYPTION_KEY` must be at least 32 characters. It encrypts provider access and refresh tokens before they are stored in D1. Do not log OAuth codes, callback URLs containing codes, access tokens, refresh tokens, client secrets, or decrypted token values.

## D1

Create the database:

```bash
npx wrangler d1 create divine-crossposter
```

Copy the returned `database_id` into the `[[d1_databases]]` entry in `wrangler.toml`.

Apply migrations locally:

```bash
npx wrangler d1 migrations apply divine-crossposter --local
```

Apply migrations remotely:

```bash
npx wrangler d1 migrations apply divine-crossposter --remote
```

The initial schema lives in `migrations/0001_initial.sql` and creates:

- `oauth_states`
- `connections`
- `preferences`
- `auto_cursors`
- `jobs`
- `job_attempts`

D1 is the source of truth for connection state, preferences, idempotent job creation, retry state, and audit-safe attempt history.

## Cloudflare Queue

Create the queue:

```bash
npx wrangler queues create divine-crossposter-jobs
```

`wrangler.toml` binds the producer as `CROSSPOST_QUEUE` and configures this Worker as the consumer:

```toml
[[queues.producers]]
binding = "CROSSPOST_QUEUE"
queue = "divine-crossposter-jobs"

[[queues.consumers]]
queue = "divine-crossposter-jobs"
max_batch_size = 10
max_batch_timeout = 30
```

Queue messages are shaped as:

```json
{ "jobId": "job_..." }
```

The queue handler acknowledges successful, skipped, failed, and `needs_reauth` outcomes. Transient publish and processing failures are retried through Cloudflare Queues with service-selected backoff delays.

## Scheduled Trigger

`wrangler.toml` configures the reconciler cron:

```toml
[triggers]
crons = ["*/5 * * * *"]
```

The scheduled reconciler is the backup path for automatic mode. Divine web/mobile should still push a newly published event ID to this service after a successful Divine publish; the reconciler catches missed client callbacks by polling Funnelcake for recent eligible videos and using the same idempotent job creation path.

Local scheduled testing:

```bash
npm run dev:scheduled
curl "http://localhost:8787/cdn-cgi/handler/scheduled?format=json"
```

## Routes

Public:

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Liveness response: `{ "ok": true, "service": "divine-crossposter" }`. |
| `GET` | `/platforms` | Lists all supported providers and whether each is enabled/configured. |

Authenticated routes require `Authorization: Bearer <Keycast access token>`:

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/connections` | List connected external accounts for the authenticated Divine pubkey. |
| `POST` | `/connections/:platform/start` | Create OAuth state and return an authorization URL. Body: `{ "returnUrl": "https://..." }`. |
| `GET` | `/connections/:platform/callback` | OAuth callback. Exchanges the provider code, stores encrypted tokens, and redirects to the stored return URL. |
| `DELETE` | `/connections/:platform/:connection_id` | Disconnect a platform account and disable future crossposts for that connection. |
| `GET` | `/preferences` | List per-platform posting preferences. |
| `PUT` | `/preferences/:platform` | Set `manual`, `automatic`, or `disabled` mode for a platform. |
| `POST` | `/videos/:event_id/crossposts` | Create or return idempotent manual crosspost jobs for selected platforms. |
| `POST` | `/videos/:event_id/auto-crosspost` | Client push path after a successful Divine publish; creates jobs for automatic-mode platforms. |
| `GET` | `/videos/:event_id/crossposts` | Read crosspost jobs for a Divine video. |
| `GET` | `/jobs/:job_id` | Read one job and its attempt history. |

Route modules should keep platform OAuth and publishing details server-side. Clients should only see connection summaries, preferences, job summaries, normalized statuses, and external post IDs/URLs after success.

## OAuth Setup Notes

Register one callback URL per platform using the public `OAUTH_REDIRECT_BASE`:

```text
${OAUTH_REDIRECT_BASE}/connections/instagram/callback
${OAUTH_REDIRECT_BASE}/connections/tiktok/callback
${OAUTH_REDIRECT_BASE}/connections/x/callback
${OAUTH_REDIRECT_BASE}/connections/youtube/callback
```

Enable a platform only when the provider app has the publish scopes this service needs and its Wrangler secrets are present. The registry reports a provider as enabled only when both the `ENABLE_*` flag and matching credentials are configured.

Provider notes:

- Instagram Reels uses Meta content publishing: create a Reels media container from a public video URL, wait for processing, then publish.
- TikTok Direct Post requires publish consent and may require app review before public posting is available.
- X uses OAuth 2.0 plus chunked media upload before post creation.
- YouTube Shorts uses the YouTube Data API upload flow; Shorts classification is determined by video format, duration, and metadata conventions.

## Divine Dependencies

Keycast auth:

- Authenticated client routes accept a Divine bearer token.
- The Worker validates it by calling Keycast `POST /api/nostr` with `{"method":"get_public_key","params":[]}`.
- The returned full hex pubkey is the authenticated Divine user. Do not truncate pubkeys in logs, fixtures, or docs.

Funnelcake:

- Manual and automatic crosspost creation must verify that the Divine video event belongs to the authenticated pubkey and is eligible.
- Automatic mode only applies to videos created after `automatic_enabled_at`.
- The scheduled reconciler uses Funnelcake to scan recent eligible videos for users with automatic mode enabled.

## Deployment

Create infrastructure first:

```bash
npx wrangler d1 create divine-crossposter
npx wrangler queues create divine-crossposter-jobs
```

Set `database_id` in `wrangler.toml`, configure vars/secrets, then apply remote migrations:

```bash
npx wrangler d1 migrations apply divine-crossposter --remote
```

Deploy:

```bash
npm run deploy
```

After deploy, check:

```bash
curl "https://<worker-host>/health"
curl "https://<worker-host>/platforms"
```

Use Cloudflare logs/tail output when validating OAuth callbacks, queue processing, and scheduled reconciliation. Keep provider token material and OAuth callback query strings out of logs.

## Operational Notes

Job statuses:

- `queued`
- `uploading`
- `processing`
- `posted`
- `failed`
- `needs_reauth`
- `skipped`

Normalized error codes:

- `rate_limited`
- `needs_reauth`
- `media_rejected`
- `platform_review_required`
- `processing_timeout`
- `expired`
- `not_connected`
- `not_owner`
- `not_eligible`
- `unknown_platform_error`

Retry behavior:

- Jobs are idempotent by `(pubkey, video_event_id, platform, external_account_id)`.
- Transient provider failures such as rate limits, unknown platform errors, and processing timeouts use exponential backoff.
- Permanent failures such as revoked auth, missing publish permission, unsupported media, or disabled providers should not be retried forever.
- Unposted jobs expire and should become `skipped` instead of surprise-posting long after the original request.
- Each publish attempt writes a `job_attempts` record with normalized status/error data and audit-safe provider response details.

Reauth behavior:

- If token refresh or provider publishing returns an auth failure, mark the connection and job `needs_reauth`.
- Automatic jobs for that platform should stop until the user reconnects.
- Manual retry after reconnect should reuse the existing job where possible and preserve attempt history.

Disconnect behavior:

- Local D1 state is the source of truth for stopping future Divine-initiated crossposts.
- If a provider supports revocation, call it best-effort during disconnect; a failed provider revocation should not keep local crossposting enabled.

## Manual Test Checklist

- `GET /health` works without auth.
- `GET /platforms` returns `instagram`, `tiktok`, `x`, and `youtube`.
- Protected routes return `401` without a bearer token.
- A disabled provider returns a platform-not-enabled response from connection start.
- A valid connection start stores an OAuth state and returns an authorization URL.
- OAuth callback consumes state once, encrypts tokens, creates a connection, and creates a default manual preference.
- Updating preferences to `automatic` records `automatic_enabled_at`.
- Duplicate manual crosspost requests return existing jobs instead of creating duplicate external posts.
- Queue processing records attempts and moves successful jobs to `posted`.
- Revoked or expired provider auth marks the connection/job `needs_reauth`.
- Scheduled reconciliation can be triggered locally with the scheduled test endpoint.
