# Crossposter Brand Lockup Design

Date: 2026-07-11
Status: Approved

## Goal

Replace the typed `diVine Crossposter` imitation in the Crossposter header with Divine's actual app logo and official wordmark from the media kit.

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

## Verification

- Run the focused root-page test.
- Run the full Vitest suite and TypeScript typecheck.
- Render the root page at desktop and mobile widths and confirm that the transparent icon has no surrounding box, the wordmark is not distorted, and the service label does not collide with the opt-in pill.
