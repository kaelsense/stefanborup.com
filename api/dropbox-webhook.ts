// Vercel serverless function: /api/dropbox-webhook
//
// Dropbox calls this URL when anything changes in the app folder. We then start a new
// Vercel build through a deploy hook, and scripts/sync-dropbox.ts fetches the new images.
//
//   GET  ?challenge=...  Dropbox verifies the URL once: echo the challenge back as text/plain.
//   POST                 Change notification, signed with X-Dropbox-Signature (HMAC-SHA256 of the
//                        raw body with the app secret). Valid → POST to the deploy hook.
//
// Env vars (set in Vercel, never in the repo):
//   DROPBOX_APP_SECRET      App secret of the Dropbox app (to verify the signature)
//   VERCEL_DEPLOY_HOOK_URL  Deploy hook for the production branch (Project → Settings → Git)
//
// Self-contained on purpose (no local imports), so Vercel bundles it as is.

export type Env = { DROPBOX_APP_SECRET?: string; VERCEL_DEPLOY_HOOK_URL?: string };
type Deps = { env: Env; fetch: typeof fetch; log?: (msg: string, extra?: unknown) => void };

export const MAX_BODY_BYTES = 100_000;

const text = (status: number, body: string) =>
  new Response(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8', 'x-content-type-options': 'nosniff', 'cache-control': 'no-store' } });

const toHex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

export async function signature(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return toHex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)));
}

/** Constant-time string comparison. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function handleDropboxWebhook(request: Request, deps: Deps): Promise<Response> {
  const log = deps.log ?? ((m: string, e?: unknown) => console.error(m, e ?? ''));

  if (request.method === 'GET') {
    const challenge = new URL(request.url).searchParams.get('challenge');
    return challenge ? text(200, challenge) : text(400, 'missing challenge');
  }
  if (request.method !== 'POST') return new Response('method not allowed', { status: 405, headers: { allow: 'GET, POST' } });

  const { DROPBOX_APP_SECRET: secret, VERCEL_DEPLOY_HOOK_URL: hook } = deps.env;
  if (!secret || !hook) {
    log('[dropbox-webhook] DROPBOX_APP_SECRET or VERCEL_DEPLOY_HOOK_URL is not set');
    return text(500, 'not configured');
  }

  const body = await request.text();
  if (body.length > MAX_BODY_BYTES) return text(413, 'payload too large');
  const given = (request.headers.get('x-dropbox-signature') ?? '').toLowerCase();
  if (!given || !safeEqual(given, await signature(secret, body))) return text(403, 'invalid signature');

  try {
    const res = await deps.fetch(hook, { method: 'POST' });
    if (!res.ok) {
      log(`[dropbox-webhook] deploy hook answered ${res.status}`, await res.text().catch(() => ''));
      return text(502, 'deploy hook failed');
    }
  } catch (err) {
    log('[dropbox-webhook] deploy hook request failed', err);
    return text(502, 'deploy hook failed');
  }
  return text(200, 'ok');
}

// Vercel entry points (Web-standard Request/Response handlers).
const env = () => (globalThis as unknown as { process: { env: Env } }).process.env;
const live = (request: Request) => handleDropboxWebhook(request, { env: env(), fetch: globalThis.fetch });
export const GET = live;
export const POST = live;
