import { Hono } from 'hono'
import { getProviderSummaries } from '../platforms/registry'
import type { Env } from '../types'

export const health = new Hono<{ Bindings: Env }>()

function htmlResponse(body: string): Response {
  return new Response(body, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'public, max-age=60',
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

function renderHome(env: Env): string {
  const platforms = getProviderSummaries(env)
  const readyCount = platforms.filter((platform) => platform.enabled).length
  const platformRows = platforms
    .map(
      (platform) => `
        <li class="platform-row">
          <span class="platform-mark" aria-hidden="true"></span>
          <span>
            <strong>${platformName(platform.platform)}</strong>
            <small>${platform.enabled ? 'Ready for opt-in publishing' : 'Waiting on provider keys'}</small>
          </span>
          <span class="status ${platform.enabled ? 'ready' : 'waiting'}">${platform.enabled ? 'Ready' : 'Soon'}</span>
        </li>
      `,
    )
    .join('')

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Divine Crossposter</title>
    <meta name="description" content="Opt-in crossposting for Divine creators.">
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
        display: grid;
        grid-template-rows: auto 1fr auto;
      }

      header,
      main,
      footer {
        width: min(1120px, calc(100% - 40px));
        margin: 0 auto;
      }

      header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 24px;
        padding: 28px 0 18px;
      }

      .brand {
        font-family: "Bricolage Grotesque", Inter, sans-serif;
        font-size: 28px;
        font-weight: 800;
        letter-spacing: 0;
      }

      .brand span { color: var(--green); }

      .pill {
        display: inline-flex;
        align-items: center;
        min-height: 34px;
        padding: 7px 12px;
        border: 1px solid var(--line);
        border-radius: 999px;
        color: var(--ink-soft);
        font-size: 14px;
        font-weight: 700;
        white-space: nowrap;
      }

      main {
        display: grid;
        grid-template-columns: minmax(0, 1.08fr) minmax(320px, 0.72fr);
        gap: 40px;
        align-items: center;
        padding: 28px 0 42px;
      }

      .hero h1 {
        margin: 0;
        max-width: 720px;
        font-family: "Bricolage Grotesque", Inter, sans-serif;
        font-size: clamp(52px, 8vw, 116px);
        line-height: 0.9;
        font-weight: 800;
        letter-spacing: 0;
      }

      .hero p {
        max-width: 620px;
        margin: 28px 0 0;
        font-size: clamp(18px, 2vw, 24px);
        line-height: 1.35;
        color: var(--ink-soft);
      }

      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        margin-top: 34px;
      }

      .button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: 48px;
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

      .panel {
        border: 2px solid var(--dark);
        border-radius: 8px;
        background: #fff;
        box-shadow: 10px 10px 0 var(--dark);
        overflow: hidden;
      }

      .panel-head {
        display: flex;
        justify-content: space-between;
        gap: 20px;
        padding: 22px;
        background: var(--light);
        border-bottom: 2px solid var(--dark);
      }

      .panel-head strong {
        display: block;
        font-size: 18px;
      }

      .panel-head small {
        display: block;
        margin-top: 4px;
        color: var(--ink-soft);
        font-weight: 600;
      }

      .count {
        min-width: 64px;
        height: 64px;
        display: grid;
        place-items: center;
        border: 2px solid var(--dark);
        border-radius: 8px;
        background: var(--yellow);
        font-family: "Bricolage Grotesque", Inter, sans-serif;
        font-size: 28px;
        font-weight: 800;
      }

      .platforms {
        list-style: none;
        margin: 0;
        padding: 0;
      }

      .platform-row {
        display: grid;
        grid-template-columns: 16px 1fr auto;
        gap: 14px;
        align-items: center;
        padding: 18px 22px;
        border-bottom: 1px solid var(--line);
      }

      .platform-row:last-child { border-bottom: 0; }

      .platform-mark {
        width: 14px;
        height: 14px;
        border: 2px solid var(--dark);
        border-radius: 50%;
        background: var(--pink);
      }

      .platform-row:nth-child(2) .platform-mark { background: var(--blue); }
      .platform-row:nth-child(3) .platform-mark { background: var(--yellow); }
      .platform-row:nth-child(4) .platform-mark { background: var(--green); }

      .platform-row strong,
      .platform-row small {
        display: block;
      }

      .platform-row small {
        margin-top: 3px;
        color: var(--ink-soft);
      }

      .status {
        padding: 6px 10px;
        border: 1px solid var(--line);
        border-radius: 999px;
        font-size: 13px;
        font-weight: 800;
      }

      .status.ready {
        background: var(--light);
      }

      .status.waiting {
        background: rgba(7, 36, 27, 0.06);
        color: var(--ink-soft);
      }

      footer {
        display: flex;
        justify-content: space-between;
        gap: 18px;
        padding: 18px 0 28px;
        color: var(--ink-soft);
        font-size: 14px;
      }

      footer a {
        color: var(--dark);
        font-weight: 800;
      }

      @media (max-width: 860px) {
        header {
          align-items: flex-start;
          flex-direction: column;
        }

        main {
          grid-template-columns: 1fr;
          gap: 30px;
          padding-top: 18px;
        }

        .panel {
          box-shadow: 6px 6px 0 var(--dark);
        }

        footer {
          flex-direction: column;
        }
      }
    </style>
  </head>
  <body>
    <div class="page">
      <header>
        <div class="brand">di<span>V</span>ine Crossposter</div>
        <div class="pill">Opt-in only. No surprise posts.</div>
      </header>

      <main>
        <section class="hero" aria-labelledby="headline">
          <h1 id="headline">Send your loops farther.</h1>
          <p>
            Crossposter lets Divine creators choose where their original videos travel next:
            Reels, TikTok, X, and Shorts. You connect the account. You choose manual or automatic.
          </p>
          <div class="actions" aria-label="Service links">
            <a class="button primary" href="https://divine.video">Open Divine</a>
            <a class="button secondary" href="/platforms">Provider status</a>
          </div>
        </section>

        <aside class="panel" aria-label="Crossposting provider readiness">
          <div class="panel-head">
            <span>
              <strong>Publishing rails</strong>
              <small>${readyCount} of ${platforms.length} providers ready</small>
            </span>
            <span class="count">${readyCount}/${platforms.length}</span>
          </div>
          <ul class="platforms">
            ${platformRows}
          </ul>
        </aside>
      </main>

      <footer>
        <span>No slop. All human. Crossposting starts only after you opt in.</span>
        <span><a href="/health">Health</a> / <a href="/platforms">Platforms</a></span>
      </footer>
    </div>
  </body>
</html>`
}

health.get('/', (c) => htmlResponse(renderHome(c.env)))
health.get('/health', (c) => c.json({ ok: true, service: 'divine-crossposter' }))
