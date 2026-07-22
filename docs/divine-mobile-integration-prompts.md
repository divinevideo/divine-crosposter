# Divine-mobile integration prompts for Crossposter

Copy-paste prompts for Claude sessions in the divine-mobile repo. Nothing exists in
divine-mobile for crossposting yet — every prompt assumes zero prior support.

Shared API contract is embedded in each prompt so they are independently usable.

---

## Prompt 1 — Crossposting settings: login, connect platforms, posting mode

```
Add crossposting settings to divine-mobile. Nothing exists for this yet — do not
assume any crossposter code, screens, or API clients are present.

Background: Divine runs a crossposting service at https://crossposter.divine.video
(Cloudflare Worker, source: divine-crossposter repo). A creator connects an external
platform account (Instagram Reels live now; X ready; TikTok/YouTube staged) and picks
a posting mode per platform. The service owns all OAuth and publishing server-side.

Auth: every API call uses the same Divine/Keycast bearer token the app already holds
for login.divine.video — header `Authorization: Bearer <token>`. No new login flow.

API contract (base https://crossposter.divine.video, all JSON):
- GET /platforms?format=json
  -> { platforms: [{ platform: "instagram"|"tiktok"|"x"|"youtube", enabled: boolean, supportsAutomatic: boolean }] }
  Only show platforms with enabled=true.
- GET /connections (auth)
  -> { connections: [{ id, platform, externalAccountId, externalAccountName, status:
     "connected"|"needs_reauth"|"disconnected", tokenExpiresAt, ... }] }
- POST /connections/{platform}/start (auth) body { "returnUrl": "<https url>" }
  -> { authorizationUrl, state }
  Open authorizationUrl in the system browser (ASWebAuthenticationSession on iOS /
  Custom Tabs on Android). IMPORTANT: returnUrl must be an https URL on divine.video,
  www.divine.video, or crossposter.divine.video — custom app schemes are rejected by
  the server. Use a universal link the app claims on divine.video if available;
  otherwise use https://crossposter.divine.video/ and let the user close the browser.
  After OAuth the browser lands on returnUrl with query params
  ?connection=connected&platform=instagram or ?connection=failed[&reason=provider_denied].
- DELETE /connections/{platform}/{connection_id} (auth) -> { disconnected: true }
- GET /preferences (auth)
  -> { preferences: [{ platform, connectionId, mode, automaticEnabledAt, ... }] }
- PUT /preferences/{platform} (auth) body { "mode": "manual"|"automatic"|"disabled" }
  Server rejects manual/automatic if the platform is not connected (400 not_connected).

Build:
1. A "Crossposting" screen reachable from settings: list enabled platforms with
   connection state (account name when connected), a Connect/Disconnect action, and a
   per-platform mode selector (Off = disabled / Manual / Automatic).
2. Connect flow per above (browser round-trip, then re-fetch GET /connections and
   refresh UI).
3. Mode copy: Manual = "you choose per video"; Automatic = "future videos post
   automatically — only videos published after you turn this on".
4. Handle needs_reauth status by showing a Reconnect action (same start flow).
Errors come as { error: { code, message } } with 4xx/5xx status.

Keep it native to the app's existing architecture and design system. Verify against
the live service with a real login before calling it done.
```

---

## Prompt 2 — Manual crosspost from a video's share sheet

```
Add manual crossposting to divine-mobile's video share sheet. Nothing exists for this
yet — do not assume any crossposter code is present. (If the crossposting settings
screen from the companion prompt exists, reuse its API client; otherwise create one.)

Background: https://crossposter.divine.video crossposts a creator's own Divine videos
to connected external platforms (Instagram Reels live today). Manual mode means the
user triggers each crosspost per video. Jobs are idempotent server-side — repeat
requests return the existing job, never double-post.

Auth: `Authorization: Bearer <token>` — the app's existing Divine/Keycast token.

API contract (base https://crossposter.divine.video, all JSON):
- GET /connections (auth) -> which platforms the user has connected (status "connected").
- POST /videos/{event_id}/crossposts (auth) body { "platforms": ["instagram", ...] }
  event_id = the Divine video's Nostr event id. Server verifies the video belongs to
  the authenticated pubkey and is eligible (original, public); 4xx codes include
  not_owner, not_eligible, not_connected.
  -> { jobs: [{ id, platform, status, externalPostId, externalPostUrl, errorCode, ... }] }
- GET /videos/{event_id}/crossposts (auth) -> { jobs: [...] } same shape, for status.
- GET /jobs/{job_id} (auth) -> single job.
Job status values: queued, uploading, processing, posted, failed, needs_reauth, skipped.
Publishing is async (queue + provider processing): expect queued/processing for up to
a few minutes before posted. externalPostUrl carries the platform permalink when posted.

Build:
1. On the share sheet of the user's OWN videos only, add "Crosspost to …" showing the
   user's connected platforms (from GET /connections; hide the action entirely when
   none are connected).
2. Selecting platform(s) fires POST /videos/{event_id}/crossposts, then shows
   non-blocking progress (poll GET /videos/{event_id}/crossposts every few seconds
   while any job is queued/uploading/processing; stop on terminal states).
3. Surface results: posted -> success with a tappable permalink; failed -> show the
   error message; needs_reauth -> prompt to reconnect the platform in crossposting
   settings.
4. Repeat triggers are safe (idempotent) — reflect the existing job instead of
   erroring.

Match the app's existing share-sheet patterns. Verify end-to-end against the live
service with a real video before calling it done.
```

---

## Automatic publishing — no mobile work

There is no prompt 3. Automatic mode is entirely server-side by design: the
crossposter service polls Funnelcake (api.divine.video, which indexes the relays) on a
cron and creates crosspost jobs for any user whose per-platform mode is "automatic".
The app publishes to the relays exactly as it does today and never calls the
crossposter about new videos.

The only mobile surface for automatic mode is the settings toggle from Prompt 1
(`PUT /preferences/{platform} {"mode":"automatic"}`), and its UI copy must say it
applies only to videos published AFTER enabling — the server never backfills old
videos.
