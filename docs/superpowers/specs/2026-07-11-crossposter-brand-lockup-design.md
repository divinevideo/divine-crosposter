# Crossposter Brand and Connection-State Design

Date: 2026-07-11
Status: Approved

## Goal

Replace the typed `diVine Crossposter` imitation with Divine's official assets, make authentication controls reflect the real Keycast session, and make failed provider authorization actionable without exposing OAuth secrets.

## Header Lockup

The header will render three adjacent elements:

1. The canonical transparent app logo from `https://about.divine.video/wp-content/uploads/2026/01/diVine-3D-512.webp`.
2. The canonical green wordmark from `https://about.divine.video/wp-content/uploads/2025/11/Divine-Logo-Green.svg`.
3. A plain text `Crossposter` service label in Inter.

The app logo must remain transparent. It will not receive a tile, background, border, crop, recoloring, shadow, rotation, or other visual effect. Layout spacing will provide the logo's clear space.

## Brand Rules

- The wordmark is artwork, not recreated text.
- Written copy uses `Divine`, never `diVine` or `DiVine`.
- The existing Divine palette and Bricolage Grotesque/Inter typography remain unchanged.
- The lockup preserves each asset's aspect ratio and remains legible on narrow screens.
- The app logo is decorative inside the combined lockup and uses an empty alt attribute. The wordmark carries `alt="Divine"`; the visible `Crossposter` label completes the accessible name.

## Delivery

The Worker will reference the canonical media-kit URLs directly so the page uses the approved originals without shipping altered copies. The existing root-page test will assert both asset URLs, the `Divine` alternative text, the service label, and the absence of the typed `diVine` imitation.

## Authentication State

The page will have one authentication-state renderer used during boot, successful login, session expiry, and logout.

- Logged out: show the primary and setup-section `Login with Divine` actions; hide `Log out`.
- Logged in: hide both login actions; show `Log out` and the full signed-in pubkey.
- Session expiry or logout: clear account state and immediately return the controls to the logged-out state.

The Keycast authorization URL will no longer send `default_register=true`. Keycast's existing-user login view is the default; account creation remains available from that view.

## Instagram Authorization Failure

The production database confirms that Instagram state creation works and migrations are applied. Meta accepts the configured app ID, callback, and scopes far enough to present its login page. Provider cancellation or denial currently returns to Crossposter without an authorization code, but Crossposter discards the provider error and leaves the OAuth state behind.

The callback will consume a matching state even when Meta returns an OAuth error. It will redirect to the stored return URL with `connection=failed`, the platform name, and a small allowlisted reason such as `provider_denied`; raw provider error descriptions, authorization codes, tokens, and callback URLs will not be surfaced. The page will translate the allowlisted reason into clear copy and remove the connection-result parameters after displaying it.

This improves the failure path but does not claim to repair a rejected Facebook credential or Meta account/app-access restriction; those occur inside Meta before Crossposter receives a code.

## Verification

- Run the focused root-page test.
- Verify logged-in controls hide both login actions and expose logout; verify logged-out controls do the inverse.
- Verify the Keycast URL does not request registration-first behavior.
- Verify provider-denied callbacks consume state and redirect with only the allowlisted failure reason.
- Run the full Vitest suite and TypeScript typecheck.
- Render the root page at desktop and mobile widths and confirm that the transparent icon has no surrounding box, the wordmark is not distorted, and the service label does not collide with the opt-in pill.
