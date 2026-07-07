# Crossposter Worker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `divine-crossposter`, a Cloudflare Worker service that lets Divine users opt in to manual or automatic crossposting of their own original Divine videos to Instagram Reels, TikTok, X, and YouTube Shorts.

**Architecture:** A TypeScript/Hono Worker owns HTTP APIs, OAuth publishing grants, encrypted token storage, D1-backed preferences/jobs, Cloudflare Queue publishing workers, and a Scheduled Worker reconciler. Web and mobile push new video event IDs after successful publish; the reconciler polls Funnelcake for missed future videos from users with automatic mode enabled.

**Tech Stack:** TypeScript, Hono, Cloudflare Workers, D1, Queues, Cron Triggers, Vitest with `@cloudflare/vitest-pool-workers`, Keycast HTTP RPC, Funnelcake REST, platform OAuth/publishing APIs.

---

## Source References

- Current design spec: `docs/superpowers/specs/2026-07-07-crossposter-worker-design.md`
- Divine context: `/Users/rabble/code/divine/divine-context/AGENT_CONTEXT.md`
- OAuth style reference: `/Users/rabble/code/divine/divine-identify-verification-service`
- Keycast token validation reference: `/Users/rabble/code/divine/divine-connect/src/services/keycast.rs`
- Cloudflare D1 migrations: https://developers.cloudflare.com/d1/reference/migrations/
- Cloudflare Queues: https://developers.cloudflare.com/queues/get-started/
- Cloudflare Cron Triggers: https://developers.cloudflare.com/workers/configuration/cron-triggers/
- Cloudflare Workers Vitest: https://developers.cloudflare.com/workers/testing/vitest-integration/
- Meta Instagram Content Publishing: https://developers.facebook.com/documentation/instagram-platform/content-publishing
- TikTok Direct Post: https://developers.tiktok.com/doc/content-posting-api-reference-direct-post
- YouTube uploads: https://developers.google.com/youtube/v3/docs/videos/insert
- X OAuth 2.0 PKCE: https://docs.x.com/fundamentals/authentication/oauth-2-0/authorization-code
- X chunked media upload: https://docs.x.com/x-api/media/quickstart/media-upload-chunked

## Plan Review Summary

- **Feasibility:** Pass. The repo is intentionally empty aside from the license and design spec, so this plan begins with Worker scaffolding and creates every referenced implementation path before use.
- **Completeness:** Pass. The tasks cover Worker scaffold, D1 schema, Keycast auth, encrypted token custody, OAuth connections, preferences, manual jobs, automatic jobs, Queue publishing, scheduled reconciliation, tests, README, and deployment notes.
- **Scope and alignment:** Pass. The plan implements the approved V1 crossposter service only. It does not include Divine web/mobile client integration, media transcoding, caption editing, archived Vine publishing, repost publishing, comments sync, analytics import, or paid campaign workflows.

## File Map

Create these files and keep responsibilities narrow:

- `package.json`: scripts and dependencies.
- `tsconfig.json`: strict TypeScript config for Workers.
- `vitest.config.ts`: Workers Vitest pool config.
- `wrangler.toml`: Worker, D1, Queue, cron, and env vars.
- `.gitignore`: Node, Wrangler, and generated artifacts.
- `README.md`: local dev, deployment, secrets, and API summary.
- `migrations/0001_initial.sql`: D1 schema.
- `src/index.ts`: Hono app wiring plus `fetch`, `queue`, and `scheduled` exports.
- `src/types.ts`: shared domain, Env, request, response, and storage types.
- `src/config.ts`: environment validation, feature flags, and constants.
- `src/utils/crypto.ts`: random IDs, PKCE, AES-GCM token encryption.
- `src/utils/http.ts`: JSON responses, error mapping, URL allowlist helpers.
- `src/utils/validation.ts`: pubkey, event ID, platform, mode, and URL validation.
- `src/auth/keycast.ts`: Bearer-token authentication through Keycast `get_public_key`.
- `src/db/client.ts`: D1 helpers and transaction wrapper.
- `src/db/oauth-states.ts`: OAuth state repository.
- `src/db/connections.ts`: connection and encrypted token repository.
- `src/db/preferences.ts`: per-platform manual/automatic preferences.
- `src/db/jobs.ts`: idempotent job creation, lookup, status updates.
- `src/db/attempts.ts`: append-only job attempt records.
- `src/db/cursors.ts`: scheduled reconciler cursor state.
- `src/platforms/adapter.ts`: platform adapter interface and normalized errors.
- `src/platforms/registry.ts`: feature-flagged adapter registry.
- `src/platforms/instagram.ts`: Meta OAuth/account/publish adapter.
- `src/platforms/tiktok.ts`: TikTok OAuth/account/publish adapter.
- `src/platforms/x.ts`: X OAuth/account/publish adapter.
- `src/platforms/youtube.ts`: Google/YouTube OAuth/account/publish adapter.
- `src/funnelcake/client.ts`: event and recent-video fetcher.
- `src/services/connections.ts`: connect/callback/disconnect orchestration.
- `src/services/crossposts.ts`: manual and automatic job creation.
- `src/services/publisher.ts`: queue message processing and retries.
- `src/services/reconciler.ts`: scheduled automatic trigger reconciliation.
- `src/routes/health.ts`: health route.
- `src/routes/platforms.ts`: platform capabilities.
- `src/routes/connections.ts`: OAuth and connection routes.
- `src/routes/preferences.ts`: preference routes.
- `src/routes/crossposts.ts`: crosspost/job routes.
- `src/test/fixtures.ts`: reusable test event/user fixtures.
- `src/**/*.test.ts`: focused unit and integration tests beside implementation files.

## Shared Contracts

Use these exact public concepts in implementation:

- Platforms: `instagram`, `tiktok`, `x`, `youtube`.
- Modes: `manual`, `automatic`, `disabled`.
- Job statuses: `queued`, `uploading`, `processing`, `posted`, `failed`, `needs_reauth`, `skipped`.
- Normalized error codes: `rate_limited`, `needs_reauth`, `media_rejected`, `platform_review_required`, `processing_timeout`, `expired`, `not_connected`, `not_owner`, `not_eligible`, `unknown_platform_error`.
- Idempotency key: `(pubkey, video_event_id, platform, external_account_id)`.
- V1 auth: Divine clients send `Authorization: Bearer <Keycast access token>`. The Worker calls Keycast `POST /api/nostr` with `{"method":"get_public_key","params":[]}` and uses the returned full hex pubkey as the authenticated user.
- V1 automatic trigger: clients call the auto endpoint after successful Divine publish; scheduled reconciliation polls recent Funnelcake videos as backup.
- V1 content: original Divine caption and media are snapshotted from the kind-34236 event; no caption editing or media transformation.

## API Contract

All authenticated JSON endpoints require `Authorization: Bearer <token>`.

- `GET /health`
  - Response: `{ "ok": true, "service": "divine-crossposter" }`
- `GET /platforms`
  - Response: `{ "platforms": [{ "platform": "tiktok", "enabled": true, "supportsAutomatic": true }] }`
- `GET /connections`
  - Response: `{ "connections": ConnectionSummary[] }`
- `POST /connections/:platform/start`
  - Body: `{ "returnUrl": "https://divine.video/settings/crossposting" }`
  - Response: `{ "authorizationUrl": "https://...", "state": "..." }`
- `GET /connections/:platform/callback?code=...&state=...`
  - Redirects to the stored return URL with `connection=connected` or `connection=failed`.
- `DELETE /connections/:platform/:connection_id`
  - Response: `{ "disconnected": true }`
- `GET /preferences`
  - Response: `{ "preferences": PreferenceSummary[] }`
- `PUT /preferences/:platform`
  - Body: `{ "mode": "manual" | "automatic" | "disabled" }`
  - Response: `{ "preference": PreferenceSummary }`
- `POST /videos/:event_id/crossposts`
  - Body: `{ "platforms": ["tiktok", "youtube"] }`
  - Response: `{ "jobs": JobSummary[] }`
- `POST /videos/:event_id/auto-crosspost`
  - Body: `{}`
  - Response: `{ "jobs": JobSummary[] }`
- `GET /videos/:event_id/crossposts`
  - Response: `{ "jobs": JobSummary[] }`
- `GET /jobs/:job_id`
  - Response: `{ "job": JobSummary, "attempts": JobAttemptSummary[] }`

## D1 Schema

Create `migrations/0001_initial.sql` with:

```sql
PRAGMA foreign_keys = ON;

CREATE TABLE oauth_states (
  state_id TEXT PRIMARY KEY,
  pubkey TEXT NOT NULL,
  platform TEXT NOT NULL,
  code_verifier TEXT,
  return_url TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX idx_oauth_states_expires_at ON oauth_states(expires_at);

CREATE TABLE connections (
  id TEXT PRIMARY KEY,
  pubkey TEXT NOT NULL,
  platform TEXT NOT NULL,
  external_account_id TEXT NOT NULL,
  external_account_name TEXT NOT NULL,
  encrypted_access_token TEXT NOT NULL,
  encrypted_refresh_token TEXT,
  token_expires_at INTEGER,
  granted_scopes TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'connected',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_refresh_at INTEGER,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  UNIQUE(pubkey, platform, external_account_id)
);

CREATE INDEX idx_connections_pubkey ON connections(pubkey);
CREATE INDEX idx_connections_status ON connections(status);

CREATE TABLE preferences (
  pubkey TEXT NOT NULL,
  platform TEXT NOT NULL,
  connection_id TEXT,
  mode TEXT NOT NULL DEFAULT 'manual',
  automatic_enabled_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(pubkey, platform),
  FOREIGN KEY(connection_id) REFERENCES connections(id) ON DELETE SET NULL
);

CREATE TABLE auto_cursors (
  pubkey TEXT PRIMARY KEY,
  cursor TEXT,
  last_checked_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  pubkey TEXT NOT NULL,
  video_event_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  connection_id TEXT NOT NULL,
  external_account_id TEXT NOT NULL,
  source_media_url TEXT NOT NULL,
  source_media_hash TEXT NOT NULL,
  caption TEXT NOT NULL,
  status TEXT NOT NULL,
  error_code TEXT,
  error_message TEXT,
  external_post_id TEXT,
  external_post_url TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  next_retry_at INTEGER,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(pubkey, video_event_id, platform, external_account_id),
  FOREIGN KEY(connection_id) REFERENCES connections(id) ON DELETE CASCADE
);

CREATE INDEX idx_jobs_pubkey_video ON jobs(pubkey, video_event_id);
CREATE INDEX idx_jobs_status_retry ON jobs(status, next_retry_at);
CREATE INDEX idx_jobs_expires_at ON jobs(expires_at);

CREATE TABLE job_attempts (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  status TEXT NOT NULL,
  error_code TEXT,
  error_message TEXT,
  provider_status INTEGER,
  provider_response_json TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(job_id) REFERENCES jobs(id) ON DELETE CASCADE
);

CREATE INDEX idx_job_attempts_job_id ON job_attempts(job_id);
```

## Tasks

### Task 1: Project Scaffold

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `wrangler.toml`
- Create: `.gitignore`
- Create: `src/index.ts`
- Create: `src/types.ts`
- Create: `src/routes/health.ts`
- Test: `src/index.test.ts`

- [ ] **Step 1: Add package scripts and dependencies**

Use the same dependency family as `divine-identify-verification-service`:

```json
{
  "name": "divine-crossposter",
  "version": "0.1.0",
  "description": "Cloudflare Worker service for opt-in Divine video crossposting",
  "main": "src/index.ts",
  "type": "commonjs",
  "scripts": {
    "dev": "wrangler dev",
    "dev:scheduled": "wrangler dev --test-scheduled",
    "deploy": "wrangler deploy",
    "typecheck": "tsc --noEmit",
    "test": "vitest",
    "test:once": "vitest run"
  },
  "dependencies": {
    "hono": "^4.10.6"
  },
  "devDependencies": {
    "@cloudflare/vitest-pool-workers": "^0.8.0",
    "@cloudflare/workers-types": "^4.20251115.0",
    "typescript": "^5.7.0",
    "vitest": "^3.0.0",
    "wrangler": "^4.0.0"
  }
}
```

- [ ] **Step 2: Add TypeScript and Vitest config**

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "types": ["@cloudflare/workers-types", "vitest"],
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*.ts", "vitest.config.ts"]
}
```

`vitest.config.ts`:

```ts
import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config'

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.toml' },
      },
    },
  },
})
```

- [ ] **Step 3: Add Worker config**

`wrangler.toml`:

```toml
name = "divine-crossposter"
main = "src/index.ts"
compatibility_date = "2026-07-07"

[vars]
KEYCAST_URL = "https://login.divine.video"
FUNNELCAKE_URL = "https://api.divine.video"
OAUTH_REDIRECT_BASE = "https://crossposter.divine.video"
ENABLE_INSTAGRAM = "false"
ENABLE_TIKTOK = "false"
ENABLE_X = "false"
ENABLE_YOUTUBE = "false"

[[d1_databases]]
binding = "DB"
database_name = "divine-crossposter"
database_id = "00000000-0000-0000-0000-000000000000"
migrations_dir = "migrations"

[[queues.producers]]
binding = "CROSSPOST_QUEUE"
queue = "divine-crossposter-jobs"

[[queues.consumers]]
queue = "divine-crossposter-jobs"
max_batch_size = 10
max_batch_timeout = 30

[triggers]
crons = ["*/5 * * * *"]
```

- [ ] **Step 4: Add minimal Worker and health route**

`src/types.ts`:

```ts
export type Platform = 'instagram' | 'tiktok' | 'x' | 'youtube'
export type PreferenceMode = 'manual' | 'automatic' | 'disabled'
export type JobStatus = 'queued' | 'uploading' | 'processing' | 'posted' | 'failed' | 'needs_reauth' | 'skipped'

export type Env = {
  DB: D1Database
  CROSSPOST_QUEUE: Queue<{ jobId: string }>
  KEYCAST_URL: string
  FUNNELCAKE_URL: string
  OAUTH_REDIRECT_BASE: string
  TOKEN_ENCRYPTION_KEY: string
  INSTAGRAM_CLIENT_ID?: string
  INSTAGRAM_CLIENT_SECRET?: string
  TWITTER_CLIENT_ID?: string
  TWITTER_CLIENT_SECRET?: string
  GOOGLE_CLIENT_ID?: string
  GOOGLE_CLIENT_SECRET?: string
  TIKTOK_CLIENT_KEY?: string
  TIKTOK_CLIENT_SECRET?: string
  ENABLE_INSTAGRAM?: string
  ENABLE_TIKTOK?: string
  ENABLE_X?: string
  ENABLE_YOUTUBE?: string
}
```

`src/routes/health.ts`:

```ts
import { Hono } from 'hono'
import type { Env } from '../types'

export const health = new Hono<{ Bindings: Env }>()

health.get('/health', (c) => c.json({ ok: true, service: 'divine-crossposter' }))
```

`src/index.ts`:

```ts
import { Hono } from 'hono'
import type { Env } from './types'
import { health } from './routes/health'

const app = new Hono<{ Bindings: Env }>()
app.route('/', health)

export { app }

export default {
  fetch: app.fetch,
  async queue(batch: MessageBatch<{ jobId: string }>, env: Env, ctx: ExecutionContext): Promise<void> {
    for (const message of batch.messages) {
      message.ack()
    }
  },
  async scheduled(_event: ScheduledEvent, _env: Env, _ctx: ExecutionContext): Promise<void> {
    return
  },
}
```

`src/index.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { app } from './index'

describe('health route', () => {
  it('returns service health', async () => {
    const res = await app.request('/health')
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ ok: true, service: 'divine-crossposter' })
  })
})
```

- [ ] **Step 5: Verify scaffold**

Run:

```bash
npm install
npm run typecheck
npm run test:once
```

Expected: typecheck exits 0 and Vitest reports the health test passing.

- [ ] **Step 6: Commit scaffold**

```bash
git add .gitignore package.json package-lock.json tsconfig.json vitest.config.ts wrangler.toml src
git commit -m "feat: scaffold crossposter worker"
```

### Task 2: D1 Migration and Repositories

**Files:**
- Create: `migrations/0001_initial.sql`
- Create: `src/db/client.ts`
- Create: `src/db/oauth-states.ts`
- Create: `src/db/connections.ts`
- Create: `src/db/preferences.ts`
- Create: `src/db/jobs.ts`
- Create: `src/db/attempts.ts`
- Create: `src/db/cursors.ts`
- Test: `src/db/*.test.ts`

- [ ] **Step 1: Add the schema**

Create `migrations/0001_initial.sql` exactly as defined in the D1 Schema section.

- [ ] **Step 2: Add repository contracts**

Implement repository modules using D1 prepared statements. Use Unix seconds for every timestamp. Every repository function accepts `db: D1Database` as its first argument.

Required functions:

```ts
// src/db/oauth-states.ts
export async function createOAuthState(db: D1Database, input: OAuthStateRecord): Promise<void>
export async function consumeOAuthState(db: D1Database, stateId: string, now: number): Promise<OAuthStateRecord | null>
export async function deleteExpiredOAuthStates(db: D1Database, now: number): Promise<number>

// src/db/connections.ts
export async function upsertConnection(db: D1Database, input: ConnectionRecord): Promise<ConnectionRecord>
export async function listConnections(db: D1Database, pubkey: string): Promise<ConnectionRecord[]>
export async function getConnection(db: D1Database, id: string, pubkey: string): Promise<ConnectionRecord | null>
export async function getActiveConnectionForPlatform(db: D1Database, pubkey: string, platform: Platform): Promise<ConnectionRecord | null>
export async function markConnectionNeedsReauth(db: D1Database, id: string, now: number): Promise<void>
export async function disconnectConnection(db: D1Database, id: string, pubkey: string, now: number): Promise<boolean>

// src/db/preferences.ts
export async function getPreferences(db: D1Database, pubkey: string): Promise<PreferenceRecord[]>
export async function setPreference(db: D1Database, input: PreferenceRecord): Promise<PreferenceRecord>
export async function listAutomaticPreferences(db: D1Database, limit: number, offset: number): Promise<PreferenceRecord[]>

// src/db/jobs.ts
export async function createOrGetJob(db: D1Database, input: CreateJobInput): Promise<{ job: JobRecord; created: boolean }>
export async function listJobsForVideo(db: D1Database, pubkey: string, videoEventId: string): Promise<JobRecord[]>
export async function getJob(db: D1Database, id: string, pubkey?: string): Promise<JobRecord | null>
export async function updateJobStatus(db: D1Database, input: UpdateJobStatusInput): Promise<void>
export async function listRunnableJobs(db: D1Database, now: number, limit: number): Promise<JobRecord[]>

// src/db/attempts.ts
export async function recordAttempt(db: D1Database, input: JobAttemptRecord): Promise<void>
export async function listAttempts(db: D1Database, jobId: string): Promise<JobAttemptRecord[]>

// src/db/cursors.ts
export async function getCursor(db: D1Database, pubkey: string): Promise<AutoCursorRecord | null>
export async function upsertCursor(db: D1Database, input: AutoCursorRecord): Promise<void>
```

- [ ] **Step 3: Test repository behavior**

Write Vitest tests that apply the migration to the isolated D1 test database and verify:

- OAuth state can be consumed once and expires.
- `upsertConnection` preserves one active row per `(pubkey, platform, external_account_id)`.
- `setPreference` stores `automatic_enabled_at` when mode is `automatic`.
- `createOrGetJob` returns `created: false` on duplicate idempotency input.
- `recordAttempt` appends attempt rows without mutating jobs.
- `upsertCursor` overwrites cursor for the same pubkey.

- [ ] **Step 4: Verify D1 layer**

Run:

```bash
npm run typecheck
npm run test:once -- src/db
```

Expected: all repository tests pass.

- [ ] **Step 5: Commit D1 layer**

```bash
git add migrations src/db src/types.ts
git commit -m "feat: add d1 storage layer"
```

### Task 3: Auth, Validation, and Encryption

**Files:**
- Create: `src/auth/keycast.ts`
- Create: `src/config.ts`
- Create: `src/utils/crypto.ts`
- Create: `src/utils/http.ts`
- Create: `src/utils/validation.ts`
- Test: corresponding `*.test.ts`

- [ ] **Step 1: Implement validation helpers**

Required behavior:

- `isValidHexPubkey(value)` accepts exactly 64 lowercase or uppercase hex chars.
- `normalizePubkey(value)` lowercases valid hex pubkeys and throws on invalid values.
- `isValidEventId(value)` accepts exactly 64 hex chars.
- `parsePlatform(value)` returns a `Platform` or throws a `400`-mapped error.
- `parsePreferenceMode(value)` returns `manual`, `automatic`, or `disabled`.
- `assertAllowedReturnUrl(url, oauthRedirectBase)` allows `https://divine.video`, `https://www.divine.video`, exact `OAUTH_REDIRECT_BASE` origin, `localhost`, and `127.0.0.1`.

- [ ] **Step 2: Implement AES-GCM helpers**

`src/utils/crypto.ts` exports:

```ts
export function generateRandomId(bytes?: number): string
export async function generatePKCE(): Promise<{ verifier: string; challenge: string }>
export async function encryptToken(plaintext: string, keyMaterial: string): Promise<string>
export async function decryptToken(ciphertext: string, keyMaterial: string): Promise<string>
```

Use Web Crypto AES-GCM with a random 12-byte IV. Store ciphertext as `v1.<base64url iv>.<base64url ciphertext>`. `TOKEN_ENCRYPTION_KEY` must be at least 32 characters.

- [ ] **Step 3: Implement Keycast auth**

`src/auth/keycast.ts` exports:

```ts
export async function authenticateRequest(request: Request, env: Env): Promise<{ pubkey: string; token: string }>
```

Behavior:

- Missing `Authorization` returns an auth error that maps to `401`.
- Non-Bearer auth returns `401`.
- Calls `${KEYCAST_URL}/api/nostr` with Bearer token and JSON `{ "method": "get_public_key", "params": [] }`.
- Accepts RPC response `{ "result": "<hex pubkey>" }`.
- Normalizes and returns the full pubkey.
- Maps upstream `401` to local `401`, upstream `403` to local `403`, and other upstream failures to `502`.

- [ ] **Step 4: Test auth and crypto**

Use mocked `fetch` to verify Keycast calls and response mapping. Verify encrypted token output never contains plaintext and decrypts back to the original value.

- [ ] **Step 5: Verify auth layer**

Run:

```bash
npm run typecheck
npm run test:once -- src/auth src/utils src/config
```

Expected: auth, crypto, and validation tests pass.

- [ ] **Step 6: Commit auth layer**

```bash
git add src/auth src/config.ts src/utils src/types.ts
git commit -m "feat: add auth and token security"
```

### Task 4: Platform Adapter Contract and Registry

**Files:**
- Create: `src/platforms/adapter.ts`
- Create: `src/platforms/registry.ts`
- Create: `src/platforms/instagram.ts`
- Create: `src/platforms/tiktok.ts`
- Create: `src/platforms/x.ts`
- Create: `src/platforms/youtube.ts`
- Test: `src/platforms/*.test.ts`

- [ ] **Step 1: Define adapter interface**

`src/platforms/adapter.ts` exports:

```ts
export type PlatformAccount = {
  id: string
  name: string
  metadata: Record<string, unknown>
}

export type TokenSet = {
  accessToken: string
  refreshToken?: string
  expiresAt?: number
  scopes: string[]
  metadata: Record<string, unknown>
}

export type PublishInput = {
  accessToken: string
  videoUrl: string
  mediaHash: string
  caption: string
  externalAccountId: string
}

export type PublishResult = {
  status: 'posted' | 'processing'
  externalPostId?: string
  externalPostUrl?: string
  providerResponse: Record<string, unknown>
}

export interface PlatformAdapter {
  platform: Platform
  buildAuthorizationUrl(input: { state: string; redirectUri: string; codeChallenge?: string }): string
  exchangeCallback(input: { code: string; redirectUri: string; codeVerifier?: string }): Promise<TokenSet>
  refreshToken(input: { refreshToken: string }): Promise<TokenSet>
  fetchAccount(input: { accessToken: string }): Promise<PlatformAccount>
  publishVideo(input: PublishInput): Promise<PublishResult>
  pollPublishStatus?(input: { accessToken: string; providerResponse: Record<string, unknown> }): Promise<PublishResult>
  revoke?(input: { accessToken: string; refreshToken?: string }): Promise<void>
}
```

- [ ] **Step 2: Implement feature-flagged registry**

`getEnabledAdapters(env)` returns only configured platforms:

- `ENABLE_INSTAGRAM === "true"` and Meta credentials exist.
- `ENABLE_TIKTOK === "true"` and TikTok credentials exist.
- `ENABLE_X === "true"` and X credentials exist.
- `ENABLE_YOUTUBE === "true"` and Google credentials exist.

`GET /platforms` must expose disabled providers with `enabled: false` so clients can render future support without attempting connection.

- [ ] **Step 3: Implement provider modules**

Implement real OAuth URL/token/account/publish request shapes with `fetch`, but keep tests fully mocked. Use normalized adapter errors for provider failures.

V1 provider behavior:

- Instagram: container create with `media_type=REELS` and `video_url`; poll container status; publish container.
- TikTok: creator info query; publish init; direct post/export to TikTok servers.
- X: OAuth 2.0 PKCE scopes include `tweet.read tweet.write users.read media.write offline.access`; upload video with chunked media upload; create post with media ID.
- YouTube: OAuth scopes include upload permission; upload through `videos.insert`; set title/description from Divine caption and privacy from platform default config.

- [ ] **Step 4: Test registry and adapter errors**

Tests:

- disabled platform does not return adapter.
- missing credentials disables platform even if flag is true.
- provider `401` maps to `needs_reauth`.
- provider `429` maps to `rate_limited`.
- provider media rejection maps to `media_rejected`.
- unexpected non-2xx maps to `unknown_platform_error`.

- [ ] **Step 5: Verify adapters**

Run:

```bash
npm run typecheck
npm run test:once -- src/platforms
```

Expected: adapter contract and registry tests pass.

- [ ] **Step 6: Commit adapters**

```bash
git add src/platforms src/types.ts
git commit -m "feat: add platform adapter contract"
```

### Task 5: Connection and Preference Routes

**Files:**
- Create: `src/services/connections.ts`
- Create: `src/routes/connections.ts`
- Create: `src/routes/platforms.ts`
- Create: `src/routes/preferences.ts`
- Modify: `src/index.ts`
- Test: `src/routes/connections.test.ts`
- Test: `src/routes/preferences.test.ts`

- [ ] **Step 1: Implement platform routes**

`GET /platforms` returns every platform and whether it is enabled.

- [ ] **Step 2: Implement connection start**

`POST /connections/:platform/start`:

- authenticates user
- validates platform is enabled
- validates `returnUrl`
- generates OAuth state and PKCE verifier/challenge
- stores state in `oauth_states` with 10-minute expiry
- returns adapter authorization URL

- [ ] **Step 3: Implement connection callback**

`GET /connections/:platform/callback`:

- consumes state exactly once
- exchanges code through adapter
- fetches account identity
- encrypts access/refresh tokens
- upserts connection
- creates default `manual` preference if one does not exist
- redirects to stored return URL with `connection=connected&platform=<platform>`

On failure, redirect to stored or base return URL with `connection=failed&platform=<platform>`.

- [ ] **Step 4: Implement list and disconnect**

`GET /connections` lists only the authenticated user's connections with token fields omitted.

`DELETE /connections/:platform/:connection_id`:

- authenticates user
- calls adapter revoke when supported
- marks connection disconnected
- sets matching preference mode to `disabled`

- [ ] **Step 5: Implement preferences**

`GET /preferences` returns all current preferences.

`PUT /preferences/:platform`:

- validates mode
- requires active connection for `manual` or `automatic`
- sets `automatic_enabled_at = now` when mode changes to `automatic`
- clears `automatic_enabled_at` for `manual` or `disabled`

- [ ] **Step 6: Test connection and preference flows**

Tests:

- connection start stores state and returns authorization URL.
- callback consumes state once and stores encrypted tokens.
- callback rejects expired state.
- listing connections never includes encrypted token fields.
- disconnect disables preference.
- automatic mode requires a connected platform and stores `automatic_enabled_at`.

- [ ] **Step 7: Verify routes**

Run:

```bash
npm run typecheck
npm run test:once -- src/routes/connections.test.ts src/routes/preferences.test.ts src/routes/platforms.test.ts
```

Expected: connection and preference route tests pass.

- [ ] **Step 8: Commit routes**

```bash
git add src/routes src/services/connections.ts src/index.ts src/types.ts
git commit -m "feat: add connection and preference api"
```

### Task 6: Funnelcake Client and Crosspost Job Creation

**Files:**
- Create: `src/funnelcake/client.ts`
- Create: `src/services/crossposts.ts`
- Create: `src/routes/crossposts.ts`
- Modify: `src/index.ts`
- Test: `src/funnelcake/client.test.ts`
- Test: `src/services/crossposts.test.ts`
- Test: `src/routes/crossposts.test.ts`

- [ ] **Step 1: Implement Funnelcake client**

Functions:

```ts
export async function fetchVideoEvent(env: Env, eventId: string): Promise<DivineVideoEvent | null>
export async function listRecentUserVideos(env: Env, input: { pubkey: string; cursor?: string; limit: number }): Promise<{ events: DivineVideoEvent[]; nextCursor?: string }>
```

Use `FUNNELCAKE_URL`, the user videos endpoint pattern from `divine-connect`, and support either bare event or `{ event: ... }` envelope responses.

- [ ] **Step 2: Implement event eligibility**

Accepted event:

- kind is `34236`
- `pubkey` equals authenticated user
- event ID matches request
- event has a usable media URL tag and sha256/hash tag
- event is not archive-labeled and not a repost
- automatic mode requires `created_at >= automatic_enabled_at`

Caption snapshot comes from event `content` exactly as stored.

- [ ] **Step 3: Implement manual job creation**

`POST /videos/:event_id/crossposts`:

- authenticates user
- validates selected platforms are enabled and connected
- fetches and validates event
- creates or returns idempotent jobs
- enqueues newly created jobs with `{ jobId }`

- [ ] **Step 4: Implement automatic job creation**

`POST /videos/:event_id/auto-crosspost`:

- authenticates user
- fetches and validates event
- loads automatic preferences
- ignores disabled/manual preferences
- creates or returns idempotent jobs
- enqueues newly created jobs

- [ ] **Step 5: Implement job reads**

`GET /videos/:event_id/crossposts` returns jobs for the authenticated user and event.

`GET /jobs/:job_id` returns the authenticated user's job plus attempts.

- [ ] **Step 6: Test job creation**

Tests:

- manual crosspost creates one job per selected connected platform.
- duplicate manual request returns the same jobs and does not enqueue duplicates.
- auto endpoint uses only automatic preferences.
- auto endpoint ignores events older than `automatic_enabled_at`.
- non-owner event returns `403`.
- unsupported event kind returns `400` with `not_eligible`.
- missing media URL/hash returns `400` with `not_eligible`.

- [ ] **Step 7: Verify crosspost job creation**

Run:

```bash
npm run typecheck
npm run test:once -- src/funnelcake src/services/crossposts.test.ts src/routes/crossposts.test.ts
```

Expected: crosspost creation tests pass.

- [ ] **Step 8: Commit crosspost job creation**

```bash
git add src/funnelcake src/services/crossposts.ts src/routes/crossposts.ts src/index.ts src/types.ts
git commit -m "feat: add crosspost job creation"
```

### Task 7: Queue Publisher

**Files:**
- Create: `src/services/publisher.ts`
- Modify: `src/index.ts`
- Test: `src/services/publisher.test.ts`

- [ ] **Step 1: Implement queue entrypoint**

`src/index.ts` `queue()` calls `processCrosspostJob(env, message.body.jobId)` for each message.

Ack only after successful processing or a terminal non-retryable update. Retry transient errors by throwing from the consumer after recording the attempt.

- [ ] **Step 2: Implement publisher service**

`processCrosspostJob`:

- loads job and connection
- skips if job is expired past 48 hours
- decrypts access token
- refreshes token when expired and refresh token exists
- marks connection/job `needs_reauth` when refresh fails with auth error
- marks job `uploading`
- calls adapter `publishVideo`
- records provider response in `job_attempts`
- marks job `posted` or `processing`
- schedules retry with exponential backoff for retryable errors

Backoff seconds: `60`, `300`, `900`, `1800`, `3600`; cap retry count at 5.

- [ ] **Step 3: Implement processing poll path**

For adapters returning `processing`, subsequent queue attempts call `pollPublishStatus` when present. If no `pollPublishStatus` exists, leave status `processing` and set `next_retry_at` using the same backoff table.

- [ ] **Step 4: Test publisher**

Tests:

- success marks job `posted` and records attempt.
- processing state records attempt and schedules retry.
- revoked token marks job and connection `needs_reauth`.
- transient `rate_limited` schedules retry.
- expired job marks `skipped`.
- terminal `media_rejected` marks `failed`.

- [ ] **Step 5: Verify publisher**

Run:

```bash
npm run typecheck
npm run test:once -- src/services/publisher.test.ts
```

Expected: publisher tests pass.

- [ ] **Step 6: Commit publisher**

```bash
git add src/services/publisher.ts src/index.ts src/types.ts
git commit -m "feat: add crosspost queue publisher"
```

### Task 8: Scheduled Reconciler

**Files:**
- Create: `src/services/reconciler.ts`
- Modify: `src/index.ts`
- Test: `src/services/reconciler.test.ts`

- [ ] **Step 1: Implement scheduled entrypoint**

`src/index.ts` `scheduled()` calls `runAutoCrosspostReconciliation(env, { now })`.

- [ ] **Step 2: Implement reconciler**

`runAutoCrosspostReconciliation`:

- pages through automatic preferences in batches of 100
- groups by pubkey
- reads `auto_cursors`
- calls `listRecentUserVideos`
- filters events older than each platform's `automatic_enabled_at`
- uses the same automatic job creation function as the client endpoint
- advances cursor after inspected events are handled

- [ ] **Step 3: Add reconciliation limits**

Each scheduled invocation processes at most 500 users and 25 videos per user. Store these as constants in `src/config.ts`.

- [ ] **Step 4: Test reconciler**

Tests:

- missed eligible video enqueues exactly one job.
- duplicate reconciler runs do not duplicate jobs.
- manual-only preferences are ignored.
- cursor advances after inspected videos.
- cursor does not advance past a failed Funnelcake response.

- [ ] **Step 5: Verify reconciler**

Run:

```bash
npm run typecheck
npm run test:once -- src/services/reconciler.test.ts
```

Expected: reconciler tests pass.

- [ ] **Step 6: Commit reconciler**

```bash
git add src/services/reconciler.ts src/index.ts src/config.ts src/types.ts
git commit -m "feat: add automatic crosspost reconciler"
```

### Task 9: README, Deployment, and Final Verification

**Files:**
- Create: `README.md`
- Modify: `.gitignore`
- Modify: `docs/superpowers/specs/2026-07-07-crossposter-worker-design.md` only if implementation decisions changed.

- [ ] **Step 1: Write README**

Include:

- service purpose
- API summary
- local setup
- D1 creation and migration commands
- Queue creation command
- scheduled trigger testing
- secrets list
- deployment command
- manual test checklist

Required commands:

```bash
npm install
npm run dev
npm run dev:scheduled
npx wrangler d1 create divine-crossposter
npx wrangler d1 migrations apply divine-crossposter --local
npx wrangler d1 migrations apply divine-crossposter --remote
npx wrangler queues create divine-crossposter-jobs
npm run deploy
```

Required secrets:

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

- [ ] **Step 2: Add final tests for route wiring**

Add an integration test that mounts the full app and verifies:

- unauthenticated protected routes return `401`
- `/health` works without auth
- `/platforms` returns all four providers
- unknown route returns `404`

- [ ] **Step 3: Run final verification**

Run:

```bash
npm run typecheck
npm run test:once
git status --short
```

Expected:

- typecheck exits 0
- all tests pass
- only intended tracked files are modified before commit

- [ ] **Step 4: Commit docs and final verification**

```bash
git add README.md .gitignore src docs migrations package.json package-lock.json tsconfig.json vitest.config.ts wrangler.toml
git commit -m "docs: add crossposter worker operations guide"
```

- [ ] **Step 5: Push branch**

If working on `main` with explicit maintainer approval:

```bash
git push origin main
```

If working on a branch:

```bash
git push -u origin HEAD
gh pr create --title "feat: implement crossposter worker" --body "Implements the Cloudflare Worker crossposting service with D1 storage, Queue publishing, and scheduled reconciliation."
```

## Acceptance Criteria

- The repo contains a working Cloudflare Worker scaffold.
- D1 migrations define every required table and uniqueness rule.
- Auth validates Keycast bearer tokens and never truncates pubkeys.
- OAuth connection flow stores encrypted publish tokens and never exposes token fields in JSON responses.
- Users can set manual, automatic, or disabled mode per connected platform.
- Manual crosspost creates idempotent jobs for selected platforms.
- Automatic crosspost creates idempotent jobs for future eligible videos only.
- Scheduled reconciliation catches missed automatic triggers without double-posting.
- Queue consumer handles success, processing, retry, expired, failed, and `needs_reauth` outcomes.
- All platform publishing code is behind feature flags and mocked in automated tests.
- `npm run typecheck` and `npm run test:once` pass.

## Risks and Guardrails

- Do not log OAuth codes, access tokens, refresh tokens, encrypted token blobs, or full callback URLs.
- Do not mutate or rewrite Blossom media in the Worker.
- Do not post archived Vine imports, reposts, or videos not owned by the authenticated pubkey in V1.
- Do not infer posting permission from identity verification.
- Keep provider app-review failures visible as `platform_review_required` or `needs_reauth`; do not retry forever.
- Do not directly integrate Divine web/mobile in this repo; expose stable HTTP contracts for those clients.
