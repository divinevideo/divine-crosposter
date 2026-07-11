# Crossposter Brand, Session, and Provider Error Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the official Divine header assets, truthful login/logout controls, login-first Keycast authorization, and a safe Instagram denial path.

**Architecture:** Keep the self-contained Hono page, adding one client-side auth-control renderer and small callback failure-reason helpers. Provider error details remain server-side; redirects expose only allowlisted reason codes.

**Tech Stack:** TypeScript, Hono, browser JavaScript embedded in the Worker response, D1, Vitest.

---

### Task 1: Official Divine header lockup

**Files:**
- Modify: `src/index.test.ts`
- Modify: `src/routes/health.ts`

- [ ] **Step 1: Add root-page assertions for the canonical WebP icon and green SVG wordmark, and reject the typed imitation.**
- [ ] **Step 2: Run `npm run test:once -- src/index.test.ts` and verify it fails on the missing asset URLs.**
- [ ] **Step 3: Replace the `.brand` text with an image lockup that preserves aspect ratios and has no icon background, border, crop, or shadow.**
- [ ] **Step 4: Run `npm run test:once -- src/index.test.ts` and verify it passes.**

### Task 2: Truthful Keycast session controls

**Files:**
- Modify: `src/index.test.ts`
- Modify: `src/routes/health.ts`

- [ ] **Step 1: Add assertions for a shared `renderAuthControls` function, logged-in hiding rules, and the absence of `default_register`.**
- [ ] **Step 2: Run `npm run test:once -- src/index.test.ts` and verify the new assertions fail.**
- [ ] **Step 3: Add `renderAuthControls`, invoke it after session load/save/clear, and remove `default_register=true` from `startLogin`.**
- [ ] **Step 4: Run `npm run test:once -- src/index.test.ts` and verify it passes.**

### Task 3: Safe provider-denial callback

**Files:**
- Modify: `src/routes/connections.test.ts`
- Modify: `src/routes/connections.ts`
- Modify: `src/services/connections.ts`
- Modify: `src/routes/health.ts`

- [ ] **Step 1: Add a callback test where `error=access_denied`, `error_reason=user_denied`, and a valid state redirect with `reason=provider_denied` while consuming that state.**
- [ ] **Step 2: Run `npm run test:once -- src/routes/connections.test.ts` and verify the callback test fails because error parameters are ignored.**
- [ ] **Step 3: Pass provider error fields into `completeConnectionCallback`, consume matching state before the no-code return, and emit only an allowlisted reason.**
- [ ] **Step 4: Render a specific denial message and remove `connection`, `platform`, and `reason` parameters after use.**
- [ ] **Step 5: Run `npm run test:once -- src/routes/connections.test.ts src/index.test.ts` and verify both pass.**

### Task 4: Full verification and delivery

**Files:**
- Review all changed files; no new production files.

- [ ] **Step 1: Run `npm run typecheck`.**
- [ ] **Step 2: Run `npm run test:once`.**
- [ ] **Step 3: Render desktop and mobile screenshots and inspect the transparent icon, wordmark, responsive lockup, and logged-out controls.**
- [ ] **Step 4: Commit only the implementation, tests, spec, and plan; exclude existing screenshots and tool artifacts.**
- [ ] **Step 5: Push a branch and open a PR with production evidence and verification results.**
