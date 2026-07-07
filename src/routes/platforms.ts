import { Hono } from 'hono'
import { getProviderSummaries } from '../platforms/registry'
import type { Env } from '../types'

export const platforms = new Hono<{ Bindings: Env }>()

function htmlResponse(body: string): Response {
  return new Response(body, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      vary: 'Accept',
    },
  })
}

function platformJsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      vary: 'Accept',
    },
  })
}

function platformName(platform: string): string {
  switch (platform) {
    case 'instagram':
      return 'Instagram Reels'
    case 'tiktok':
      return 'TikTok'
    case 'x':
      return 'X'
    case 'youtube':
      return 'YouTube Shorts'
    default:
      return platform
  }
}

function renderPlatforms(env: Env): string {
  const summaries = getProviderSummaries(env)
  const readyCount = summaries.filter((platform) => platform.enabled).length
  const rows = summaries
    .map(
      (platform) => `
        <li class="platform-card">
          <span class="mark" aria-hidden="true"></span>
          <span>
            <strong>${platformName(platform.platform)}</strong>
            <small>${platform.enabled ? 'Ready for opt-in publishing' : 'Waiting on keys'}</small>
          </span>
          <span class="status ${platform.enabled ? 'ready' : 'waiting'}">${platform.enabled ? 'Ready' : 'Waiting'}</span>
        </li>
      `,
    )
    .join('')

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Divine Crossposter Platforms</title>
    <meta name="description" content="Provider readiness for Divine Crossposter.">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:wght@700;800&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
    <style>
      :root {
        color-scheme: light;
        --green: #27C58B;
        --dark: #07241B;
        --light: #D0FBCB;
        --paper: #F9F7F6;
        --yellow: #FFF140;
        --pink: #FF7FAF;
        --blue: #34BBF1;
        --ink-soft: rgba(7, 36, 27, 0.72);
        --line: rgba(7, 36, 27, 0.16);
      }

      * { box-sizing: border-box; }

      body {
        margin: 0;
        font-family: Inter, system-ui, sans-serif;
        background: var(--paper);
        color: var(--dark);
      }

      .page {
        min-height: 100vh;
        width: min(1060px, calc(100% - 40px));
        margin: 0 auto;
        display: grid;
        grid-template-rows: auto 1fr auto;
      }

      header,
      footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 18px;
      }

      header {
        padding: 28px 0 18px;
      }

      .brand {
        font-family: "Bricolage Grotesque", Inter, sans-serif;
        font-size: 28px;
        font-weight: 800;
        letter-spacing: 0;
      }

      .brand span { color: var(--green); }

      main {
        padding: 34px 0 44px;
      }

      .hero {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 24px;
        align-items: end;
        margin-bottom: 30px;
      }

      h1 {
        margin: 0;
        max-width: 760px;
        font-family: "Bricolage Grotesque", Inter, sans-serif;
        font-size: clamp(48px, 7vw, 96px);
        line-height: 0.92;
        letter-spacing: 0;
      }

      p {
        max-width: 620px;
        margin: 18px 0 0;
        color: var(--ink-soft);
        font-size: 18px;
        line-height: 1.45;
      }

      .count {
        width: 104px;
        height: 104px;
        display: grid;
        place-items: center;
        border: 2px solid var(--dark);
        border-radius: 8px;
        background: var(--yellow);
        box-shadow: 8px 8px 0 var(--dark);
        font-family: "Bricolage Grotesque", Inter, sans-serif;
        font-size: 34px;
        font-weight: 800;
      }

      .platforms {
        list-style: none;
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 16px;
        margin: 0;
        padding: 0;
      }

      .platform-card {
        min-height: 110px;
        display: grid;
        grid-template-columns: 18px minmax(0, 1fr) auto;
        gap: 14px;
        align-items: center;
        border: 2px solid var(--dark);
        border-radius: 8px;
        background: #fff;
        padding: 18px;
        box-shadow: 6px 6px 0 var(--dark);
      }

      .mark {
        width: 16px;
        height: 16px;
        border: 2px solid var(--dark);
        border-radius: 50%;
        background: var(--pink);
      }

      .platform-card:nth-child(2) .mark { background: var(--blue); }
      .platform-card:nth-child(3) .mark { background: var(--yellow); }
      .platform-card:nth-child(4) .mark { background: var(--green); }

      strong,
      small {
        display: block;
      }

      strong {
        font-size: 20px;
      }

      small {
        margin-top: 4px;
        color: var(--ink-soft);
        font-weight: 600;
      }

      .status {
        padding: 7px 10px;
        border: 1px solid var(--line);
        border-radius: 999px;
        font-size: 13px;
        font-weight: 800;
        white-space: nowrap;
      }

      .status.ready {
        background: var(--light);
      }

      .status.waiting {
        background: rgba(7, 36, 27, 0.06);
        color: var(--ink-soft);
      }

      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        margin-top: 28px;
      }

      .button {
        min-height: 48px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 0 18px;
        border: 2px solid var(--dark);
        border-radius: 8px;
        color: var(--dark);
        font-weight: 800;
        text-decoration: none;
      }

      .button.primary {
        background: var(--green);
      }

      .button.secondary {
        background: transparent;
      }

      footer {
        padding: 18px 0 28px;
        color: var(--ink-soft);
        font-size: 14px;
      }

      footer a {
        color: var(--dark);
        font-weight: 800;
      }

      @media (max-width: 780px) {
        header,
        footer,
        .hero {
          align-items: flex-start;
          flex-direction: column;
        }

        .hero {
          display: flex;
        }

        .platforms {
          grid-template-columns: 1fr;
        }

        .platform-card {
          grid-template-columns: 18px minmax(0, 1fr);
        }

        .status {
          grid-column: 2;
          width: max-content;
        }
      }
    </style>
  </head>
  <body>
    <div class="page">
      <header>
        <div class="brand">di<span>V</span>ine Crossposter</div>
        <a class="button secondary" href="/">Back to setup</a>
      </header>

      <main>
        <section class="hero" aria-labelledby="headline">
          <div>
            <h1 id="headline">Provider status</h1>
            <p>
              These are the publishing rails Crossposter can use after a creator opts in.
              Disabled providers are waiting on app credentials, not user action.
            </p>
            <div class="actions">
              <a class="button primary" href="/">Back to setup</a>
              <a class="button secondary" href="/platforms?format=json">JSON</a>
            </div>
          </div>
          <div class="count" aria-label="${readyCount} of ${summaries.length} providers ready">${readyCount}/${summaries.length}</div>
        </section>

        <ul class="platforms">
          ${rows}
        </ul>
      </main>

      <footer>
        <span>No slop. All human. Crossposting starts only after opt-in.</span>
        <span><a href="/health">Health</a></span>
      </footer>
    </div>
  </body>
</html>`
}

function wantsJson(request: Request): boolean {
  const url = new URL(request.url)
  if (url.searchParams.get('format') === 'json') return true
  return request.headers.get('accept')?.includes('application/json') ?? false
}

platforms.get('/platforms', (c) => {
  const summaries = getProviderSummaries(c.env)
  if (wantsJson(c.req.raw)) return platformJsonResponse({ platforms: summaries })
  return htmlResponse(renderPlatforms(c.env))
})
