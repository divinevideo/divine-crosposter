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
  const platformData = JSON.stringify(platforms).replaceAll('<', '\\u003c')
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

      button.button {
        cursor: pointer;
        font: inherit;
      }

      button.button:disabled {
        cursor: not-allowed;
        opacity: 0.55;
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

      .flow {
        grid-column: 1 / -1;
        display: grid;
        grid-template-columns: minmax(0, 0.9fr) minmax(320px, 1.1fr);
        gap: 28px;
        align-items: start;
      }

      .flow-section {
        border-top: 1px solid var(--line);
        padding: 22px;
      }

      .flow-section h2,
      .flow-section h3 {
        margin: 0;
        font-family: "Bricolage Grotesque", Inter, sans-serif;
        letter-spacing: 0;
      }

      .flow-section h2 {
        font-size: 36px;
        line-height: 1;
      }

      .flow-section h3 {
        font-size: 22px;
      }

      .flow-section p {
        margin: 10px 0 0;
        color: var(--ink-soft);
        line-height: 1.45;
      }

      .status-box {
        display: none;
        margin-top: 14px;
        padding: 12px;
        border: 1px solid var(--line);
        border-radius: 8px;
        color: var(--dark);
        background: rgba(208, 251, 203, 0.46);
        overflow-wrap: anywhere;
      }

      .pubkey-box {
        display: none;
        width: 100%;
        margin-top: 14px;
        padding: 12px;
        border: 1px solid var(--line);
        border-radius: 8px;
        background: var(--paper);
        color: var(--dark);
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 12px;
        line-height: 1.45;
        overflow-wrap: anywhere;
      }

      .connect-list {
        display: grid;
        gap: 12px;
        margin-top: 16px;
      }

      .connect-row {
        display: grid;
        grid-template-columns: 1fr auto;
        gap: 14px;
        align-items: center;
        border: 1px solid var(--line);
        border-radius: 8px;
        padding: 14px;
      }

      .connect-row strong,
      .connect-row small {
        display: block;
      }

      .connect-row small {
        margin-top: 4px;
        color: var(--ink-soft);
      }

      .mini-button {
        min-height: 38px;
        padding: 0 12px;
        border: 2px solid var(--dark);
        border-radius: 8px;
        background: var(--light);
        color: var(--dark);
        font-weight: 800;
        cursor: pointer;
      }

      .mini-button:disabled {
        cursor: not-allowed;
        opacity: 0.55;
      }

      .preference-list {
        display: grid;
        gap: 12px;
        margin-top: 16px;
      }

      .preference-row {
        display: grid;
        grid-template-columns: 1fr minmax(150px, auto);
        gap: 14px;
        align-items: center;
        border: 1px solid var(--line);
        border-radius: 8px;
        padding: 14px;
      }

      select {
        min-height: 38px;
        border: 2px solid var(--dark);
        border-radius: 8px;
        background: #fff;
        color: var(--dark);
        font: inherit;
        font-weight: 700;
        padding: 0 10px;
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

        .flow {
          grid-template-columns: 1fr;
        }

        .connect-row,
        .preference-row {
          grid-template-columns: 1fr;
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
            <button class="button primary" id="login-button" type="button">Login with Divine</button>
            <a class="button secondary" href="/platforms">Provider status</a>
          </div>
          <div class="status-box" id="ui-status" role="status"></div>
          <div class="pubkey-box" id="pubkey-box"></div>
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

        <section class="flow" aria-label="Crossposting setup">
          <div class="panel">
            <div class="flow-section">
              <h2>Set it up from here.</h2>
              <p>
                Sign in with your Divine/Nostr account, connect a publishing account,
                then choose manual or automatic crossposting. Nothing posts until you say so.
              </p>
            </div>
            <div class="flow-section">
              <h3>1. Sign in</h3>
              <p>We use login.divine.video so the same Nostr key works here, web, and mobile.</p>
              <div class="actions">
                <button class="button primary" id="login-button-secondary" type="button">Login with Divine</button>
                <button class="button secondary" id="logout-button" type="button">Log out</button>
              </div>
            </div>
            <div class="flow-section">
              <h3>2. Connect a platform</h3>
              <p>Provider keys are still off until we add the app credentials. Ready providers will unlock here.</p>
              <div class="connect-list" id="connect-list"></div>
            </div>
          </div>

          <div class="panel">
            <div class="flow-section">
              <h2>Your posting switches.</h2>
              <p>Manual means you press the button. Automatic only applies to future Divine videos.</p>
              <div class="preference-list" id="preference-list"></div>
            </div>
          </div>
        </section>
      </main>

      <footer>
        <span>No slop. All human. Crossposting starts only after you opt in.</span>
        <span><a href="/health">Health</a> / <a href="/platforms">Platforms</a></span>
      </footer>
    </div>
    <script id="platform-data" type="application/json">${platformData}</script>
    <script>
      const KEYCAST_BASE = 'https://login.divine.video';
      const KEYCAST_CLIENT_ID = 'Divine Identity Verification';
      const KEYCAST_SCOPE = 'policy:social';
      const SESSION_KEY = 'divine_crossposter_keycast_session_v1';
      const PKCE_KEY = 'divine_crossposter_pkce_v1';
      const STATE_KEY = 'divine_crossposter_state_v1';
      const RETURN_KEY = 'divine_crossposter_return_v1';
      const platforms = JSON.parse(document.getElementById('platform-data').textContent || '[]');
      let session = null;
      let pubkey = null;
      let connections = [];
      let preferences = [];

      function $(id) {
        return document.getElementById(id);
      }

      function setStatus(message, type = 'ok') {
        const el = $('ui-status');
        if (!el) return;
        el.style.display = 'block';
        el.textContent = message;
        el.style.background = type === 'error' ? 'rgba(255,127,175,0.18)' : 'rgba(208,251,203,0.46)';
        el.style.borderColor = type === 'error' ? 'rgba(255,127,175,0.55)' : 'rgba(39,197,139,0.45)';
      }

      function escapeHtml(value) {
        return String(value ?? '').replace(/[&<>"']/g, (char) => ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#39;',
        }[char]));
      }

      function bytesToBase64Url(bytes) {
        let binary = '';
        for (const byte of bytes) binary += String.fromCharCode(byte);
        return btoa(binary).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/g, '');
      }

      function randomBase64Url(size) {
        const bytes = new Uint8Array(size);
        crypto.getRandomValues(bytes);
        return bytesToBase64Url(bytes);
      }

      async function sha256Base64Url(text) {
        const data = new TextEncoder().encode(text);
        const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
        return bytesToBase64Url(digest);
      }

      async function createPkce() {
        const verifier = randomBase64Url(32);
        const challenge = await sha256Base64Url(verifier);
        return { verifier, challenge };
      }

      function normalizeSession(raw) {
        if (!raw || typeof raw !== 'object') return null;
        const accessToken = raw.accessToken || raw.access_token || '';
        if (!accessToken) return null;
        return {
          accessToken,
          refreshToken: raw.refreshToken || raw.refresh_token || '',
          expiresAt: raw.expiresAt || (raw.expires_in ? Date.now() + Number(raw.expires_in) * 1000 : null),
          authorizationHandle: raw.authorizationHandle || raw.authorization_handle || '',
        };
      }

      function loadSession() {
        try {
          return normalizeSession(JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'));
        } catch {
          return null;
        }
      }

      function saveSession(nextSession) {
        session = nextSession;
        localStorage.setItem(SESSION_KEY, JSON.stringify(nextSession));
      }

      function clearSession() {
        session = null;
        pubkey = null;
        connections = [];
        preferences = [];
        localStorage.removeItem(SESSION_KEY);
      }

      function isExpired(nextSession) {
        return !!nextSession?.expiresAt && Date.now() >= Number(nextSession.expiresAt);
      }

      async function tokenRequest(body) {
        const resp = await fetch(KEYCAST_BASE + '/api/oauth/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(data.error_description || data.error || 'login.divine.video did not finish sign-in.');
        return data;
      }

      async function getValidSession() {
        let nextSession = session || loadSession();
        if (!nextSession) return null;
        if (isExpired(nextSession)) {
          clearSession();
          return null;
        }
        return nextSession;
      }

      async function api(path, init = {}) {
        const active = await getValidSession();
        if (!active?.accessToken) throw new Error('Login with Divine first.');
        const headers = new Headers(init.headers || {});
        headers.set('Authorization', 'Bearer ' + active.accessToken);
        if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
        const resp = await fetch(path, { ...init, headers });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(data.error?.message || data.error?.code || 'Request failed.');
        return data;
      }

      async function keycastPublicKey() {
        const active = await getValidSession();
        if (!active?.accessToken) throw new Error('Login with Divine first.');
        const resp = await fetch(KEYCAST_BASE + '/api/nostr', {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer ' + active.accessToken,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ method: 'get_public_key', params: [] }),
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok || typeof data.result !== 'string') throw new Error(data.error || 'Could not read your Divine key.');
        return data.result.toLowerCase();
      }

      async function startLogin() {
        const pkce = await createPkce();
        const state = randomBase64Url(24);
        sessionStorage.setItem(PKCE_KEY, JSON.stringify(pkce));
        sessionStorage.setItem(STATE_KEY, state);
        sessionStorage.setItem(RETURN_KEY, window.location.pathname);
        const url = new URL(KEYCAST_BASE + '/api/oauth/authorize');
        url.searchParams.set('client_id', KEYCAST_CLIENT_ID);
        url.searchParams.set('redirect_uri', window.location.origin + window.location.pathname);
        url.searchParams.set('scope', KEYCAST_SCOPE);
        url.searchParams.set('code_challenge', pkce.challenge);
        url.searchParams.set('code_challenge_method', 'S256');
        url.searchParams.set('state', state);
        url.searchParams.set('default_register', 'true');
        if (session?.authorizationHandle) url.searchParams.set('authorization_handle', session.authorizationHandle);
        window.location.href = url.toString();
      }

      async function handleLoginCallback() {
        const params = new URLSearchParams(window.location.search);
        const code = params.get('code');
        const error = params.get('error');
        if (!code && !error) return false;
        try {
          if (error) throw new Error(params.get('error_description') || error);
          const expectedState = sessionStorage.getItem(STATE_KEY);
          if (!expectedState || expectedState !== params.get('state')) throw new Error('Login state did not match.');
          const pkce = JSON.parse(sessionStorage.getItem(PKCE_KEY) || 'null');
          if (!pkce?.verifier) throw new Error('Missing login verifier. Start again.');
          const tokenData = await tokenRequest({
            grant_type: 'authorization_code',
            code,
            client_id: KEYCAST_CLIENT_ID,
            redirect_uri: window.location.origin + window.location.pathname,
            code_verifier: pkce.verifier,
          });
          const nextSession = normalizeSession(tokenData);
          if (!nextSession) throw new Error('login.divine.video returned an unusable session.');
          saveSession(nextSession);
          setStatus('Signed in with Divine.');
        } catch (err) {
          clearSession();
          setStatus(err.message || 'Could not finish Divine login.', 'error');
        } finally {
          sessionStorage.removeItem(PKCE_KEY);
          sessionStorage.removeItem(STATE_KEY);
          sessionStorage.removeItem(RETURN_KEY);
          params.delete('code');
          params.delete('state');
          params.delete('error');
          params.delete('error_description');
          window.history.replaceState({}, '', window.location.pathname + (params.toString() ? '?' + params.toString() : ''));
        }
        return true;
      }

      function renderConnectRows() {
        const list = $('connect-list');
        if (!list) return;
        list.innerHTML = platforms.map((platform) => {
          const connection = connections.find((item) => item.platform === platform.platform && item.status === 'connected');
          const disabled = !session || !platform.enabled || !!connection;
          const label = connection ? 'Connected' : platform.enabled ? 'Connect' : 'Waiting';
          const accountLabel = connection
            ? (connection.externalAccountName || 'Connected account')
            : platform.enabled
              ? 'Ready when you are.'
              : 'Provider keys are not configured yet.';
          return '<div class="connect-row">' +
            '<span><strong>' + escapeHtml(platformName(platform.platform)) + '</strong><small>' +
            escapeHtml(accountLabel) +
            '</small></span>' +
            '<button class="mini-button" data-connect="' + escapeHtml(platform.platform) + '" ' + (disabled ? 'disabled' : '') + '>' + escapeHtml(label) + '</button>' +
          '</div>';
        }).join('');
      }

      function renderPreferenceRows() {
        const list = $('preference-list');
        if (!list) return;
        if (!session) {
          list.innerHTML = '<div class="connect-row"><span><strong>Login first</strong><small>Your posting switches appear after Divine login.</small></span></div>';
          return;
        }
        list.innerHTML = platforms.map((platform) => {
          const pref = preferences.find((item) => item.platform === platform.platform);
          const connection = connections.find((item) => item.platform === platform.platform && item.status === 'connected');
          const current = pref?.mode || 'disabled';
          const disabled = !connection;
          return '<div class="preference-row">' +
            '<span><strong>' + escapeHtml(platformName(platform.platform)) + '</strong><small>' +
            (connection ? 'Choose how this platform gets future loops.' : 'Connect this platform before changing switches.') +
            '</small></span>' +
            '<select data-preference="' + escapeHtml(platform.platform) + '" ' + (disabled ? 'disabled' : '') + '>' +
              '<option value="disabled" ' + (current === 'disabled' ? 'selected' : '') + '>Off</option>' +
              '<option value="manual" ' + (current === 'manual' ? 'selected' : '') + '>Manual</option>' +
              '<option value="automatic" ' + (current === 'automatic' ? 'selected' : '') + '>Automatic</option>' +
            '</select>' +
          '</div>';
        }).join('');
      }

      function platformName(platform) {
        if (platform === 'instagram') return 'Instagram Reels';
        if (platform === 'tiktok') return 'TikTok';
        if (platform === 'x') return 'X';
        if (platform === 'youtube') return 'YouTube Shorts';
        return platform;
      }

      async function refreshAccount() {
        session = await getValidSession();
        if (!session) {
          $('pubkey-box').style.display = 'none';
          renderConnectRows();
          renderPreferenceRows();
          return;
        }
        pubkey = await keycastPublicKey();
        const box = $('pubkey-box');
        box.style.display = 'block';
        box.textContent = 'Signed in pubkey: ' + pubkey;
        const [connectionData, preferenceData] = await Promise.all([
          api('/connections'),
          api('/preferences'),
        ]);
        connections = connectionData.connections || [];
        preferences = preferenceData.preferences || [];
        renderConnectRows();
        renderPreferenceRows();
      }

      async function connectPlatform(platform) {
        const data = await api('/connections/' + platform + '/start', {
          method: 'POST',
          body: JSON.stringify({ returnUrl: window.location.origin + '/' }),
        });
        window.location.href = data.authorizationUrl;
      }

      async function updatePreference(platform, mode) {
        await api('/preferences/' + platform, {
          method: 'PUT',
          body: JSON.stringify({ mode }),
        });
        setStatus(platformName(platform) + ' set to ' + mode + '.');
        await refreshAccount();
      }

      document.addEventListener('click', async (event) => {
        const target = event.target;
        try {
          if (target?.id === 'login-button' || target?.id === 'login-button-secondary') {
            await startLogin();
          }
          if (target?.id === 'logout-button') {
            clearSession();
            setStatus('Logged out.');
            renderConnectRows();
            renderPreferenceRows();
          }
          if (target?.dataset?.connect) {
            await connectPlatform(target.dataset.connect);
          }
        } catch (err) {
          setStatus(err.message || 'Something broke. Try again.', 'error');
        }
      });

      document.addEventListener('change', async (event) => {
        const target = event.target;
        if (!target?.dataset?.preference) return;
        try {
          await updatePreference(target.dataset.preference, target.value);
        } catch (err) {
          setStatus(err.message || 'Could not update posting switch.', 'error');
          await refreshAccount().catch(() => undefined);
        }
      });

      (async function boot() {
        renderConnectRows();
        renderPreferenceRows();
        await handleLoginCallback();
        await refreshAccount().catch((err) => {
          if (session) setStatus(err.message || 'Could not load your crossposting setup.', 'error');
        });
        const params = new URLSearchParams(window.location.search);
        if (params.get('connection') === 'connected') setStatus(platformName(params.get('platform')) + ' connected.');
        if (params.get('connection') === 'failed') setStatus('Platform connection failed. Try again when you are ready.', 'error');
      })();
    </script>
  </body>
</html>`
}

health.get('/', (c) => htmlResponse(renderHome(c.env)))
health.get('/health', (c) => c.json({ ok: true, service: 'divine-crossposter' }))
