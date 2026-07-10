# Crossposter Keycast OAuth Client Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore Crossposter login by giving it a truthful, application-specific Keycast OAuth client identity and durably binding that identity to the production callback.

**Architecture:** Crossposter will send `Divine Crossposter` as the OAuth `client_id` during both authorization and token exchange. Keycast remains open OAuth, while an idempotent tenant-1 seed migration registers this first-party client with the exact `https://crossposter.divine.video/` redirect for defense in depth.

**Tech Stack:** TypeScript, Hono, Vitest, Rust integration tests, PostgreSQL/SQLx migrations.

---

### Task 1: Crossposter OAuth client identity

**Files:**
- Modify: `src/index.test.ts:17-33`
- Modify: `src/routes/health.ts:539-541`

- [ ] **Step 1: Write the failing regression test**

Change the root-page assertion to require the dedicated client identity and reject the copied verifier identity:

```ts
expect(html).toContain("const KEYCAST_CLIENT_ID = 'Divine Crossposter';")
expect(html).not.toContain("const KEYCAST_CLIENT_ID = 'Divine Identity Verification';")
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm run test:once -- src/index.test.ts`

Expected: FAIL because the rendered page still contains `Divine Identity Verification`.

- [ ] **Step 3: Apply the minimal implementation**

Set the embedded OAuth client constant to:

```ts
const KEYCAST_CLIENT_ID = 'Divine Crossposter';
```

- [ ] **Step 4: Run focused and full verification**

Run: `npm run test:once -- src/index.test.ts`

Expected: PASS.

Run: `npm run test:once && npm run typecheck`

Expected: 106 tests pass and TypeScript exits successfully.

### Task 2: Durable Keycast client registration

**Files:**
- Create: `database/migrations/20260710150000_seed_divine_crossposter_client.sql`
- Modify: `api/tests/registered_clients_migration_test.rs`

- [ ] **Step 1: Write the failing migration test**

Add an integration test that queries tenant 1 for `Divine Crossposter`, expects the exact callback, accepts the exact root URL, and rejects a different path:

```rust
#[tokio::test]
async fn migrations_register_divine_crossposter_oauth_client() {
    let pool = common::setup_test_db().await;
    let repo = RegisteredClientRepository::new(pool);

    let allowed_redirects = repo
        .get_allowed_redirect_uris("Divine Crossposter", 1)
        .await
        .unwrap()
        .expect("Divine Crossposter should be seeded as a registered OAuth client");

    assert_eq!(
        allowed_redirects,
        vec!["https://crossposter.divine.video/".to_string()]
    );

    repo.validate_redirect_uri(
        "Divine Crossposter",
        "https://crossposter.divine.video/",
        1,
    )
    .await
    .unwrap();

    assert!(repo
        .validate_redirect_uri(
            "Divine Crossposter",
            "https://crossposter.divine.video/callback",
            1,
        )
        .await
        .is_err());
}
```

- [ ] **Step 2: Verify RED**

Run: `cargo test -p keycast_api --test registered_clients_migration_test migrations_register_divine_crossposter_oauth_client -- --exact`

Expected: FAIL because no migration has registered `Divine Crossposter`. If local PostgreSQL is unavailable, record that environmental blocker and still compile the test with `--no-run`.

- [ ] **Step 3: Add the idempotent seed migration**

Create a tenant-1 seed mirroring the existing invite-admin migration:

```sql
-- Register Divine Crossposter as a first-party OAuth client.
-- The exact production callback prevents another origin or path from reusing
-- this client identity during the hosted login flow.
INSERT INTO public.registered_clients (
    tenant_id,
    client_id,
    name,
    allowed_redirect_uris
)
VALUES (
    1,
    'Divine Crossposter',
    'Divine Crossposter',
    ARRAY['https://crossposter.divine.video/']::TEXT[]
)
ON CONFLICT (tenant_id, client_id) DO UPDATE
SET
    name = EXCLUDED.name,
    allowed_redirect_uris = EXCLUDED.allowed_redirect_uris,
    updated_at = NOW();
```

- [ ] **Step 4: Verify GREEN**

Run the focused integration test against local PostgreSQL when available; otherwise compile it with:

`cargo test -p keycast_api --test registered_clients_migration_test --no-run`

Also run: `cargo fmt --all -- --check`

Expected: targeted test passes when PostgreSQL is available; compilation and formatting pass in all environments.

### Task 3: Cross-repository verification

**Files:**
- Review both task diffs; no new production files.

- [ ] **Step 1: Verify the production authorization tuple read-only**

Request Keycast authorization with `client_id=Divine Crossposter`, `redirect_uri=https://crossposter.divine.video/`, `scope=policy:social`, and PKCE S256.

Expected before registration deployment: HTTP 200 because Keycast intentionally permits unregistered HTTPS clients.

- [ ] **Step 2: Independent spec and quality review**

Review that Crossposter uses the same client ID for authorize and token exchange, and that Keycast registers the exact trailing-slash callback without broad wildcards or changes to the verifier client.

- [ ] **Step 3: Final verification**

Run the complete Crossposter test/typecheck suite plus Keycast targeted compile/test and formatting checks. Report database-dependent verification separately from compiled checks.
