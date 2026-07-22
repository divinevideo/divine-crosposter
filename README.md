# Divine Crossposter

Cloudflare Worker for opt-in crossposting of original Divine videos to external short-form platforms. A creator connects a platform account, chooses manual or automatic posting, and Crossposter publishes their Divine videos there on their behalf. Nothing posts until the creator opts in.

The service owns publishing consent, OAuth publish grants, per-platform posting preferences, crosspost job state, retries, and external post IDs. It is distribution infrastructure, not identity proof: Divine clients call this Worker after a user connects a platform or asks to publish a video, and platform OAuth and publishing details stay server-side.

The codebase is a TypeScript Worker built on [Hono](https://hono.dev), using D1 for service-owned state, Cloudflare Queues for publish work, and a Cron-triggered reconciler that catches missed automatic-crosspost triggers. License: MPL-2.0.

## Features

- **Opt-in only.** No video leaves Divine until a creator connects an account and picks a posting mode. Automatic mode applies only to Divine videos created after the creator turned it on.
- **Supported platforms.** Instagram Reels, TikTok, X, and YouTube Shorts, each behind its own adapter. A platform reports as enabled only when its `ENABLE_*` flag is `true` and matching OAuth credentials are configured, so an operator can stage a provider before exposing it.
- **Manual and automatic posting.** Manual jobs are created when the creator asks. Automatic jobs are created after a Divine publish, either from a client push or from the scheduled reconciler.
- **Idempotent jobs.** Jobs are keyed by `(pubkey, video_event_id, platform, external_account_id)`, so duplicate requests return the existing job instead of double-posting.
- **Built-in setup UI.** `GET /` serves a self-contained web app where a creator signs in with their Divine/Nostr account, connects platforms, and sets posting switches. `GET /platforms` shows provider readiness (HTML, or JSON with `?format=json`).

## Architecture

Crossposter is a single Worker with four entry points wired together in `src/index.ts`:

- **HTTP API and UI** — Hono routes for the setup UI, health, provider readiness, OAuth connections, preferences, crosspost creation, and job reads.
- **Platform adapters** — one adapter per platform (`src/platforms/instagram.ts`, `tiktok.ts`, `x.ts`, `youtube.ts`) behind a shared adapter interface and a registry that reports which providers are configured.
- **Queue consumer** — consumes `{ "jobId": "..." }` messages from `CROSSPOST_QUEUE`, refreshes tokens when needed, calls the platform adapter, records an attempt, and updates job state. Controlled application retries are fresh delayed messages; the current delivery is acknowledged only after that send succeeds.
- **Scheduled reconciler and watchdog** — a Cron Trigger backs up automatic mode, recovers stale claims, re-enqueues due D1 jobs, and checks both the primary queue and dead-letter queue (DLQ). Divine web/mobile should still push a newly published event after a successful publish.

D1 is the source of truth for connection state, preferences, idempotent job creation, retry state, and an append-only attempt history. The Worker does not transcode video; if a platform needs media normalization later, that belongs in a separate service.

### How it fits Divine

- **Auth** comes from Keycast (`login.divine.video`). Authenticated routes accept a Divine bearer token, which the Worker validates by calling Keycast `POST /api/nostr` with `{"method":"get_public_key","params":[]}`. The returned full hex pubkey is the authenticated Divine user.
- **Video ownership and eligibility** come from Funnelcake (`api.divine.video`). Crosspost creation verifies the Divine video event belongs to the authenticated pubkey and is eligible before queueing work.

## Getting started

Install dependencies:

```bash
npm install
```

Run the Worker locally:

```bash
npm run dev
```

Run with scheduled-trigger testing enabled, then fire the scheduled handler:

```bash
npm run dev:scheduled
curl "http://localhost:8787/cdn-cgi/handler/scheduled?format=json"
```

Typecheck and test:

```bash
npm run typecheck
npm run test:once
```

Create the backing infrastructure once per environment:

```bash
npx wrangler d1 create divine-crossposter
npx wrangler queues create divine-crossposter-jobs
npx wrangler queues create divine-crossposter-jobs-dlq
```

Copy the returned D1 `database_id` into `wrangler.toml`, then apply migrations locally or remotely:

```bash
npx wrangler d1 migrations apply divine-crossposter --local
npx wrangler d1 migrations apply divine-crossposter --remote
```

The initial schema (`migrations/0001_initial.sql`) creates `oauth_states`, `connections`, `preferences`, `auto_cursors`, `jobs`, and `job_attempts`.

## Configuration

The Worker is deployed as `divine-crossposter` on the `crossposter.divine.video` custom domain (`wrangler.toml`).

### Bindings

| Binding | Type | Purpose |
| --- | --- | --- |
| `DB` | D1 database | Service-owned state (`divine-crossposter`). |
| `CROSSPOST_QUEUE` | Queue producer | Enqueues publish jobs onto `divine-crossposter-jobs`. |
| `CROSSPOST_DLQ` | Queue producer/metrics binding | Reads aggregate backlog metrics for `divine-crossposter-jobs-dlq`. |

The same Worker is the queue consumer, configured with `max_batch_size = 10`, `max_batch_timeout = 30`, five native retries, and `divine-crossposter-jobs-dlq` as its dead-letter queue. The reconciler/watchdog cron runs `*/5 * * * *`.

### Variables

Non-secret `[vars]` in `wrangler.toml`:

| Variable | Purpose |
| --- | --- |
| `KEYCAST_URL` | Base URL for Keycast bearer-token validation. Currently `https://login.divine.video`. |
| `FUNNELCAKE_URL` | Base URL for Funnelcake event/video lookups. Currently `https://api.divine.video`. |
| `OAUTH_REDIRECT_BASE` | Public Worker origin used to build OAuth callback URLs. Currently `https://crossposter.divine.video`. |
| `ENABLE_INSTAGRAM` / `ENABLE_TIKTOK` / `ENABLE_X` / `ENABLE_YOUTUBE` | Set to `true` to expose a platform, only after its OAuth credentials are configured. In the committed config Instagram and X are `true`; TikTok and YouTube are `false`. Before rotating X secrets, use a deployment override with `ENABLE_X=false`, then restore it only after the replacement credentials are configured. |
| `INSTAGRAM_CLIENT_ID` | Meta app id used for Instagram OAuth. |
| `YOUTUBE_DEFAULT_PRIVACY_STATUS` | Optional. One of `private`, `public`, or `unlisted`; defaults to `private`. |

### Secrets

Set with Wrangler:

```bash
npx wrangler secret put TOKEN_ENCRYPTION_KEY
npx wrangler secret put INSTAGRAM_CLIENT_SECRET
npx wrangler secret put TWITTER_CLIENT_ID
npx wrangler secret put TWITTER_CLIENT_SECRET
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put TIKTOK_CLIENT_KEY
npx wrangler secret put TIKTOK_CLIENT_SECRET
npx wrangler secret put OPS_ALERT_WEBHOOK_URL
```

`TOKEN_ENCRYPTION_KEY` must be at least 32 characters. It encrypts provider access and refresh tokens before they are stored in D1. Do not log OAuth codes, callback URLs containing codes, access tokens, refresh tokens, client secrets, or decrypted token values.

A platform is reported as enabled only when both its `ENABLE_*` flag is `true` and its credential pair is present: Instagram needs `INSTAGRAM_CLIENT_ID` + `INSTAGRAM_CLIENT_SECRET`, TikTok needs `TIKTOK_CLIENT_KEY` + `TIKTOK_CLIENT_SECRET`, X needs `TWITTER_CLIENT_ID` + `TWITTER_CLIENT_SECRET`, and YouTube needs `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET`.

### OAuth callbacks

Register one callback URL per platform against the public `OAUTH_REDIRECT_BASE`:

```text
${OAUTH_REDIRECT_BASE}/connections/instagram/callback
${OAUTH_REDIRECT_BASE}/connections/tiktok/callback
${OAUTH_REDIRECT_BASE}/connections/x/callback
${OAUTH_REDIRECT_BASE}/connections/youtube/callback
```

Provider notes:

- Instagram Reels uses Meta content publishing: create a Reels media container from a public video URL, wait for processing, then publish.
- TikTok Direct Post requires publish consent and may require app review before public posting.
- X uses OAuth 2.0 plus chunked media upload before post creation. In the X Developer Portal, configure the production application as an **OAuth 2.0 confidential web application** with **Read and write** permission, callback `https://crossposter.divine.video/connections/x/callback`, and scopes `tweet.read tweet.write users.read media.write offline.access`. The portal client ID and client secret must be the pair installed as the `TWITTER_CLIENT_ID` and `TWITTER_CLIENT_SECRET` Worker secrets.
- YouTube Shorts uses the YouTube Data API upload flow; Shorts classification depends on video format, duration, and metadata conventions.

## Routes

Public:

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/` | Self-contained setup UI: Divine login, connect platforms, set posting switches. |
| `GET` | `/health` | Liveness JSON: `{ "ok": true, "service": "divine-crossposter" }`. |
| `GET` | `/platforms` | Provider readiness. HTML by default; JSON via `?format=json` or `Accept: application/json`. |

Authenticated routes require `Authorization: Bearer <Keycast access token>`:

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/connections` | List connected external accounts for the authenticated Divine pubkey. |
| `POST` | `/connections/:platform/start` | Create OAuth state and return an authorization URL. Body: `{ "returnUrl": "https://..." }`. |
| `GET` | `/connections/:platform/callback` | OAuth callback. Exchanges the provider code, stores encrypted tokens, and redirects to the stored return URL. |
| `DELETE` | `/connections/:platform/:connection_id` | Disconnect a platform account and stop future crossposts for it. |
| `GET` | `/preferences` | List per-platform posting preferences. |
| `PUT` | `/preferences/:platform` | Set `manual`, `automatic`, or `disabled` mode for a platform. |
| `POST` | `/videos/:event_id/crossposts` | Create or return idempotent manual crosspost jobs for selected platforms. |
| `POST` | `/videos/:event_id/auto-crosspost` | Client push path after a successful Divine publish; creates jobs for automatic-mode platforms. |
| `GET` | `/videos/:event_id/crossposts` | Read crosspost jobs for a Divine video. |
| `GET` | `/jobs/:job_id` | Read one job and its attempt history. |

Clients see connection summaries, preferences, job summaries, normalized statuses, and external post IDs/URLs after success; platform OAuth and publishing internals stay server-side.

## Job lifecycle

Job statuses: `queued`, `uploading`, `dispatching`, `processing`, `posted`, `failed`, `needs_reauth`, `skipped`.

Normalized error codes: `rate_limited`, `needs_reauth`, `media_rejected`, `platform_review_required`, `processing_timeout`, `expired`, `not_connected`, `not_owner`, `not_eligible`, `unknown_platform_error`, `ambiguous_post_result`.

- Transient provider failures and processing polls use bounded application backoff: Crossposter sends a fresh delayed queue message, then acknowledges the current delivery. `message.retry()` is not used. Only unexpected infrastructure failures or a failed fresh-message send remain unacknowledged; Cloudflare retries those deliveries at most five times before moving them to the DLQ.
- Scheduled reconciliation recovers a stale X `uploading` claim only while the job is unexpired and the incremented retry count remains within the retry budget. An expired claim becomes `skipped`; a claim that exhausts the retry budget remains terminal `failed` with no `nextRetryAt`. A stale X `dispatching` claim has an unknown external outcome, so it becomes terminal `ambiguous_post_result` and requires manual reconciliation; it is never automatically reposted.
- If token refresh or publishing returns an auth failure, the connection and job are marked `needs_reauth`; automatic jobs for that platform stop until the user reconnects. Manual retry after reconnect reuses the existing job where possible and preserves attempt history.
- Disconnecting relies on local D1 state to stop future Divine-initiated crossposts. Provider revocation, where supported, is called best-effort; a failed revocation does not keep local crossposting enabled.

## Queue operations and alerts

The watchdog alerts on two independent signals: a nonempty DLQ and D1 jobs that have been runnable for at least 15 minutes. Primary queue `oldestMessageTimestamp` is deliberately not an alert threshold because delayed retry messages can be old while their D1 `next_retry_at` is still in the future. Alert payloads contain only `service`, `observedAt`, `issue`, `backlogCount`, `backlogBytes`, and `overdueJobCount`; they never include job IDs, URLs, tokens, pubkeys, provider responses, callback state, or verifier material.

Inspect DLQ messages and the corresponding aggregate D1 state before deciding how to recover them. Do not purge the DLQ as a routine response: determine whether the failure is infrastructure-only, confirm the job's current status and external posting outcome, and re-enqueue only when that outcome is safe and known.

To test the production notification path once without touching either queue, insert an opaque request into D1, wait for the next scheduled run and webhook receipt, then use count-only queries to confirm it was consumed:

```bash
npx wrangler d1 execute divine-crossposter --remote --command \
  "INSERT INTO operations_alert_tests (id, requested_at, consumed_at) VALUES (lower(hex(randomblob(16))), unixepoch(), NULL);"

npx wrangler d1 execute divine-crossposter --remote --json --command \
  "SELECT COUNT(*) AS pending_operations_tests FROM operations_alert_tests WHERE consumed_at IS NULL;"

npx wrangler d1 execute divine-crossposter --remote --json --command \
  "SELECT COUNT(*) AS recently_consumed_operations_tests FROM operations_alert_tests WHERE consumed_at >= unixepoch() - 900;"
```

The request stays unconsumed if either queue metrics lookup fails, the webhook secret is absent, or the webhook returns a non-2xx response. A successful receipt consumes only the oldest pending test request, after the webhook returns 2xx. The request ID is never included in the alert or logs.

One-shot alert delivery is at-least-once. Overlapping scheduled runs, or a webhook success followed by a D1 consume failure, can deliver the same sanitized `notification_test` more than once. Receivers should handle duplicates; Crossposter still conditionally consumes the pending row and never adds its request ID to the payload.

## Deployment

Merges to `main` deploy automatically through GitHub Actions (`.github/workflows/ci-deploy.yml`). Every pull request and push runs the `test` job on Node 24 (`npm ci`, `npm run typecheck`, `npm run test:once`). On push to `main`, the `deploy` job then:

1. Applies remote D1 migrations with Wrangler.
2. Deploys the Worker with `npm run deploy`.
3. Smoke-tests the live health, home UI, and platform endpoints on `crossposter.divine.video`, including `GET /platforms?format=json` reporting Instagram and X enabled.

The deploy job enters the `production` GitHub environment. `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` may therefore be repository secrets, production-environment secrets, or selected-organization secrets that include this repository. Keep the API token limited to the Divine account and these permissions: Account Settings Read, Workers Scripts Edit, D1 Edit, Queues Edit, and Workers Routes Edit for the `divine.video` zone only.

The separate `notify` job deliberately does not enter the production environment, so its `OPS_ALERT_WEBHOOK_URL` Actions secret must be a repository secret or a selected-organization secret. This is separate from installing the same secret name in the Worker with Wrangler. If the Actions webhook secret is absent, notification exits successfully without exposing anything.

### Safe production rollout

Use the reviewed branch for the safety deployment, but let the merge-to-`main` CI run be the sole activation of `ENABLE_X=true`:

1. Capture the current production Worker version and `origin/main` SHA in the private deployment checklist.
2. Create `divine-crossposter-jobs-dlq` if absent, apply migrations, and install the Worker `OPS_ALERT_WEBHOOK_URL` interactively. Do not replace X credentials yet.
3. Deploy the reviewed branch with `ENABLE_X=false`. Verify the deployed version has the D1 binding, primary queue, DLQ binding, scheduled cron, five native retries, and the named DLQ; verify the live platform JSON reports X disabled.
4. Only after that safety version is healthy, replace `TWITTER_CLIENT_ID` and `TWITTER_CLIENT_SECRET` interactively from the one known matching X Developer Portal application. Do not print or compare secret values.
5. Merge the reviewed branch. The normal CI deployment is the only step that restores the committed `ENABLE_X=true`, and its live smoke test must see X enabled.

Useful commands for the operator-controlled steps are:

```bash
git fetch origin main
git rev-parse origin/main
npx wrangler deployments list --name divine-crossposter
npx wrangler queues list
npx wrangler d1 migrations list divine-crossposter --remote

npx wrangler queues create divine-crossposter-jobs-dlq # only if absent
npx wrangler d1 migrations apply divine-crossposter --remote
npx wrangler secret put OPS_ALERT_WEBHOOK_URL
npx wrangler deploy --var ENABLE_X:false --message "X recovery safety version"

npx wrangler secret put TWITTER_CLIENT_ID
npx wrangler secret put TWITTER_CLIENT_SECRET
npx wrangler secret list
```

After the CI deployment, not before, inspect both queues. Require exactly one producer and one consumer on `divine-crossposter-jobs`, `max_retries = 5`, and `divine-crossposter-jobs-dlq` as its dead-letter queue. Require one watchdog/metrics producer and no consumer on the DLQ:

```bash
npx wrangler queues info divine-crossposter-jobs
npx wrangler queues info divine-crossposter-jobs-dlq
curl -fsS https://crossposter.divine.video/health
curl -fsS 'https://crossposter.divine.video/platforms?format=json'
```

### Real X authorization and manual post

After the live checks pass, sign in at the production setup page, connect X, and approve consent. Choose an original, non-archive kind-34236 video owned by that same Divine account. In the setup page's browser console, use the page's existing authenticated `api()` helper so the bearer token never leaves the page:

```js
await (async () => {
  const fullEventId = String(prompt('Full 64-hex Divine video event ID') || '').trim().toLowerCase()
  if (!/^[0-9a-f]{64}$/.test(fullEventId)) throw new Error('Expected a full 64-hex event ID')
  const source = await fetch('https://api.divine.video/api/videos/' + fullEventId).then((response) => response.json())
  const event = source.event || source
  if (event.id !== fullEventId || event.pubkey !== pubkey || event.kind !== 34236) {
    throw new Error('Video preflight did not match the signed-in owner and kind')
  }
  const created = await api('/videos/' + fullEventId + '/crossposts', {
    method: 'POST',
    body: JSON.stringify({ platforms: ['x'] }),
  })
  const xJob = created.jobs.find((job) => job.platform === 'x')
  if (!xJob) throw new Error('Crossposter did not return an X job')
  for (let poll = 0; poll < 120; poll += 1) {
    const current = await api('/jobs/' + xJob.id)
    if (current.job.status === 'posted') return current
    if (current.job.status === 'failed' && current.job.nextRetryAt === null) {
      throw new Error(current.job.errorCode || current.job.status)
    }
    if (['needs_reauth', 'skipped'].includes(current.job.status)) {
      throw new Error(current.job.errorCode || current.job.status)
    }
    await new Promise((resolve) => setTimeout(resolve, 5000))
  }
  throw new Error('X job did not finish within ten minutes')
})()
```

A retry-scheduled `failed` job with a non-null `nextRetryAt` continues polling; a terminal `failed` job has a null `nextRetryAt` and stops. Confirm the returned external URL locally, but do not paste tokens, OAuth codes, full pubkeys, job results, provider bodies, or callback data into terminals, chat, logs, or committed files.

Verify production outcomes with count-only D1 queries:

```bash
npx wrangler d1 execute divine-crossposter --remote --json --command \
  "SELECT status, COUNT(*) AS count FROM oauth_attempts WHERE platform = 'x' GROUP BY status;"
npx wrangler d1 execute divine-crossposter --remote --json --command \
  "SELECT COUNT(*) AS active_x_connections FROM connections WHERE platform = 'x' AND status = 'connected';"
npx wrangler d1 execute divine-crossposter --remote --json --command \
  "SELECT COUNT(*) AS complete_posted_x_jobs FROM jobs WHERE platform = 'x' AND status = 'posted' AND length(external_post_id) > 0 AND external_post_url LIKE 'https://x.com/i/web/status/%';"
npx wrangler d1 execute divine-crossposter --remote --json --command \
  "SELECT COUNT(*) AS unsafe_x_attempts FROM job_attempts a JOIN jobs j ON j.id = a.job_id WHERE j.platform = 'x' AND a.provider_response_json IS NOT NULL AND (a.status = 'posted' OR json_valid(a.provider_response_json) = 0 OR EXISTS (SELECT 1 FROM json_each(a.provider_response_json) WHERE key NOT IN ('mediaId', 'caption')));"
```

Expect a connected X attempt, an active X connection, a complete posted X job, and zero unsafe X attempts. X processing checkpoints may contain only `mediaId` and `caption`; posted attempts must have a null `provider_response_json`. Never select identifying columns for this verification.

### Notification checks

Test the GitHub notification without breaking a build or deploying:

```bash
gh workflow run ci-deploy.yml -f test_failure_notification=true
run_id="$(gh run list --workflow ci-deploy.yml --event workflow_dispatch --limit 1 --json databaseId --jq '.[0].databaseId')"
gh run watch "$run_id" --exit-status
```

Confirm receipt of the sanitized `notification_test`, then run the one-shot D1 watchdog test documented under Queue operations and alerts. Delivery is at-least-once, so the receiver must tolerate duplicates.

With an account administrator, query Cloudflare Notifications for alert types eligible for the Divine account. Create or verify an enabled Worker/edge-error policy scoped as narrowly as Cloudflare allows to this Worker or zone, use Cloudflare's test action, and confirm receipt and notification history. If no eligible Worker/edge-error type exists, record that product limitation instead of claiming the checkpoint passed. Record only the policy name, event type, scope, and receipt timestamp—never secrets, account identifiers, destination details, or payload bodies.

### Pause and rollback

For repeated invalid posts, bad external IDs, credential exposure, callback regression, or a rising DLQ, pause primary delivery before changing the Worker. Roll back to the recorded X-disabled safety version, then verify X is disabled and all D1, queue, DLQ, cron, retry, and dead-letter bindings remain present:

```bash
npx wrangler queues pause-delivery divine-crossposter-jobs
npx wrangler deployments list --name divine-crossposter
read -r "safety_version_id?Recorded X-disabled safety Worker version ID: "
test -n "$safety_version_id"
npx wrangler versions view "$safety_version_id" --name divine-crossposter
npx wrangler rollback "$safety_version_id" --name divine-crossposter --message "Disable X after recovery incident" --yes

curl -fsS https://crossposter.divine.video/health
curl -fsS 'https://crossposter.divine.video/platforms?format=json'
npx wrangler queues info divine-crossposter-jobs
npx wrangler queues info divine-crossposter-jobs-dlq
```

Inspect and preserve real primary-queue and DLQ messages while determining their external outcome. Never purge real messages. Resume only after deciding how existing X jobs should be handled with X disabled:

```bash
npx wrangler queues resume-delivery divine-crossposter-jobs
```

Use manual deployment only for local or non-production environments. Do not use it to activate X in production; follow the disabled-first rollout above and let merge-to-`main` CI be the sole activation:

```bash
npm run deploy
```

After deploy, check the live service:

```bash
curl "https://crossposter.divine.video/health"
curl "https://crossposter.divine.video/platforms?format=json"
```

Use Cloudflare logs/tail when validating OAuth callbacks, queue processing, and scheduled reconciliation. Keep provider token material and OAuth callback query strings out of logs.

---

Part of [Divine](https://divine.video) — your playground for human creativity · [Brand guidelines](https://github.com/divinevideo/brand-guidelines)
