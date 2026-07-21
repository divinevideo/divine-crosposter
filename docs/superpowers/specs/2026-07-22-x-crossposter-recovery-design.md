# X Crossposter Recovery Design

## Purpose

Restore the production Divine-to-X path from provider authorization through a confirmed video post, and make future failures diagnosable. The first success criterion is one real creator authorizing X and one eligible Divine video reaching X with a durable `posted` job record and external post ID.

This repair is intentionally limited to the standalone Crossposter flow. Divine mobile and web integration will follow only after the service can complete the core path reliably.

## Current Evidence

- Production D1 contains 13 unconsumed OAuth starts, zero connections, zero preferences, zero jobs, and zero attempts.
- PR #10 shipped with Instagram dashboard configuration incomplete and the X callback allowlist unverified.
- X requires an exact callback URL match. Production must allowlist `https://crossposter.divine.video/connections/x/callback`.
- The current X adapter uses `/{mediaId}/append` and `/{mediaId}/finalize` JSON requests. X's current v2 chunked upload API requires `INIT`, `APPEND`, and `FINALIZE` multipart/form requests to the same `/2/media/upload` endpoint.
- The production GitHub Actions deploy fails before deployment because `CLOUDFLARE_API_TOKEN` is invalid or revoked.
- OAuth callback exceptions are currently collapsed into a generic redirect, so exchange and account lookup failures leave no durable operational evidence.
- The queue consumer has no dead-letter queue. Repeated unhandled deliveries can therefore be discarded after Cloudflare's retry limit.

## Scope

### In scope

1. Bring X OAuth configuration and implementation into compliance with the current X OAuth 2.0 Authorization Code with PKCE flow.
2. Correct X chunked video upload and post creation.
3. Persist a sanitized OAuth lifecycle so operators can distinguish abandonment, provider denial, token exchange failure, account lookup failure, and success.
4. Expire abandoned OAuth attempts during the scheduled reconciliation pass.
5. Configure a queue dead-letter queue and document the operational check for it.
6. Restore automated production deployment with a valid, narrowly scoped Cloudflare API token.
7. Configure proactive notification for GitHub deployment failure and Cloudflare Worker/queue failure.
8. Complete one real X authorization and one real Divine-video crosspost.

### Out of scope

- Instagram, TikTok, and YouTube repair.
- Divine mobile or web settings UI and publish callbacks.
- Video transcoding or format conversion.
- Automatic deletion of the end-to-end verification post.
- Storing OAuth authorization codes, access tokens, refresh tokens, client secrets, raw provider bodies, or Nostr private keys in diagnostic records or logs.

## Architecture

The existing Worker, D1 database, queue, and scheduled reconciler remain the service boundary. The repair adds a small OAuth-attempt repository beside `oauth_states`, updates the X adapter to the documented provider protocol, and adds queue/deployment operations without introducing another runtime service.

The user flow remains:

1. A Divine-authenticated creator starts an X connection.
2. Crossposter creates a short-lived OAuth state and a durable sanitized attempt record.
3. The browser visits X with PKCE and the exact production callback URL.
4. X redirects to Crossposter; Crossposter consumes the state, exchanges the code, reads the X account, encrypts tokens, creates the connection and manual preference, and marks the attempt connected.
5. The creator requests a manual crosspost for an eligible Divine video.
6. The queue consumer downloads the source media, performs X's chunked upload protocol, creates the X post, and records the external post ID.

## X Provider Configuration

The X Developer Portal application must be configured as an OAuth 2.0 confidential web application with read and write access. Its exact production callback URL is:

```text
https://crossposter.divine.video/connections/x/callback
```

The requested scopes remain:

```text
tweet.read tweet.write users.read media.write offline.access
```

The portal client ID and client secret must match the `TWITTER_CLIENT_ID` and `TWITTER_CLIENT_SECRET` Worker secrets. Portal configuration is a human checkpoint because provider dashboard credentials are not readable from the Worker.

## OAuth Attempt Lifecycle

Migration `0002_oauth_attempts.sql` adds an internal `oauth_attempts` table. It stores:

- an opaque attempt ID;
- the full creator pubkey, consistent with Divine's rule never to truncate Nostr identifiers;
- platform;
- lifecycle status;
- sanitized failure code;
- provider HTTP status when available;
- creation, expiration, and update timestamps.

The lifecycle statuses are:

```text
started
provider_denied
token_exchange_failed
account_lookup_failed
connected
expired
```

`oauth_states.metadata_json` links the short-lived state to the opaque attempt ID. Unknown callback states are not persisted, preventing attacker-controlled state values from becoming durable data.

Every known callback transition updates the attempt before redirecting. Logs contain only structured fields safe for operations: event name, attempt ID, platform, lifecycle status, sanitized failure code, and provider HTTP status. Logs never contain a state value, pubkey, callback query string, authorization code, access token, refresh token, secret, or raw provider response.

The scheduled reconciler marks overdue `started` attempts `expired` and deletes their expired OAuth states. This turns abandoned flows into measurable outcomes and prevents the stale-state buildup visible in production today.

## X OAuth Behavior

The authorization request retains PKCE S256, a random state, the exact redirect URI, and the required scopes. Token and refresh requests explicitly send `application/x-www-form-urlencoded`; confidential-client authentication uses HTTP Basic authentication.

Provider failures are classified at the boundary:

- an explicit user/provider denial becomes `provider_denied`;
- a non-success token response becomes `token_exchange_failed` with only the HTTP status retained;
- a non-success `/2/users/me` response or an empty user ID becomes `account_lookup_failed`;
- a fully stored encrypted connection becomes `connected`.

The browser receives a safe failure reason suitable for retry guidance. Provider internals stay server-side.

## X Video Upload Behavior

The adapter follows X's v2 chunked media upload sequence:

1. `INIT`: multipart/form request to `POST https://api.x.com/2/media/upload` with `command=INIT`, `total_bytes`, `media_type`, and `media_category=tweet_video`.
2. `APPEND`: split the source bytes into bounded chunks. For each chunk, send multipart/form data to the same endpoint with `command=APPEND`, `media_id`, `segment_index`, and a binary `media` part.
3. `FINALIZE`: multipart/form request to the same endpoint with `command=FINALIZE` and `media_id`.
4. `STATUS`: if `processing_info` exists, poll `GET /2/media/upload?command=STATUS&media_id=...` after the provider-supplied delay or the existing bounded service backoff.
5. Post: after media processing succeeds, call `POST /2/tweets` with the caption and media ID.

An X processing state of `failed` is terminal and records a normalized provider failure rather than polling until timeout. Pending and in-progress states remain retryable. A successful post stores the full external post ID and canonical `https://x.com/i/web/status/{id}` URL.

## Queue Reliability

Create `divine-crossposter-jobs-dlq` and configure the production consumer with `max_retries = 5` and `dead_letter_queue = "divine-crossposter-jobs-dlq"`. Handled provider failures continue to use the job lifecycle and retry schedule. The DLQ captures only deliveries that fail outside that controlled path.

The deployment runbook checks that the primary queue has one producer and one consumer and that the DLQ exists. A `CROSSPOST_DLQ` binding exposes DLQ metrics to the scheduled handler. The handler checks primary and DLQ backlog metrics after reconciliation and sends a sanitized alert to an `OPS_ALERT_WEBHOOK_URL` secret when the DLQ is non-empty or the primary queue's oldest message is more than 15 minutes old. Alert payloads contain aggregate counts, timestamps, and service identifiers only.

Cloudflare HTTP/Worker error notification covers unhandled invocation failures that the Worker cannot report itself. GitHub Actions failure notification covers build and deployment failures. The webhook, Cloudflare notification, and GitHub notification destinations are external production settings and must each be verified deliberately.

## Deployment Recovery

GitHub Actions keeps the existing test-then-deploy structure. A repository or selected-organization `CLOUDFLARE_API_TOKEN` must be replaced with a valid token scoped to the Divine account and only the permissions required for Worker deployment, D1 migrations, queues, routes, and scripts.

Deployment acceptance requires:

1. typecheck and all tests pass;
2. remote D1 migrations apply;
3. Worker deployment succeeds;
4. queue and DLQ bindings are present in the deployed version;
5. production smoke tests pass;
6. the GitHub Actions run is green;
7. the operations webhook test is received;
8. Cloudflare Worker error and GitHub Actions failure notifications are confirmed.

Manual Wrangler deployment using a developer OAuth session may be used to validate the repair before CI is restored, but it does not satisfy the deployment acceptance criteria.

## Testing

Tests are written before implementation changes.

### OAuth tests

- starting X OAuth creates both state and `started` attempt records;
- provider denial records `provider_denied` and returns a safe redirect reason;
- token exchange failure records only the sanitized class and HTTP status;
- account lookup failure is distinct from token exchange failure;
- success stores the encrypted connection and marks the attempt connected;
- scheduled housekeeping expires abandoned attempts and deletes stale states;
- callback logs contain none of the forbidden sensitive values.

### X adapter tests

- authorization URL contains the exact redirect URI, state, PKCE S256 challenge, and scopes;
- token requests have form encoding and confidential-client authentication;
- upload uses the same `/2/media/upload` endpoint for INIT, every APPEND, and FINALIZE;
- APPEND uses multipart binary chunks with sequential indices;
- pending processing schedules a poll;
- failed processing becomes terminal;
- successful processing creates a post and returns the external ID and URL.

### Regression and verification

- full unit and route suite;
- TypeScript typecheck;
- remote migration dry run or apply through the deployment job;
- live `/health` and `/platforms?format=json` smoke checks;
- real browser authorization using an X test account;
- one manual crosspost using an existing eligible Divine video;
- production D1 verification that the attempt is connected and the job is posted, using aggregate or targeted safe queries without printing pubkeys or tokens.

## Human Checkpoints

Two steps require Rabble or another authorized operator:

1. In the X Developer Portal, verify the application type, write permission, scopes, and exact callback URL, then complete the consent flow with the chosen X test account.
2. Replace or authorize the GitHub Actions Cloudflare token if the current GitHub identity cannot manage the relevant organization secret.

Implementation may proceed through local and manual production validation while those checkpoints are pending. The task is not complete until both checkpoints and the real post succeed.

## Acceptance Criteria

- X authorization completes and leaves one active production connection.
- A real eligible Divine video is posted to X by Crossposter.
- The production job reaches `posted` with an external post ID and URL.
- No secret, OAuth code, token, callback query string, provider body, or private key appears in logs or diagnostic tables.
- Abandoned and failed OAuth attempts are distinguishable in D1 by sanitized lifecycle state.
- The X upload sequence matches the current official v2 chunked-upload protocol.
- The queue has a DLQ and bounded retry configuration.
- The latest `main` GitHub Actions test and deploy jobs are green.
- Deployment, Worker-error, queue-backlog, and DLQ notifications are configured and test-confirmed.
