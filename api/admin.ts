// Vercel serverless function: /api/admin  (backend of the password-protected page /admin)
//
// Stefan uploads, deletes and picks cover images for the gallery categories here. Images are stored
// privately in Vercel Blob under "galleri/<category folder>/<file>"; scripts/sync-gallery.ts turns
// them into the public WebP files at build time. Every change ends with a call to `publish`, which
// starts a new production build through the deploy hook.
//
//   POST ?a=login    {password}          -> sets the session cookie (30 days)
//   POST ?a=logout                       -> clears it
//   GET  ?a=list                         -> {folders: [{folder, images: [{pathname, name, etag, size}]}]}
//   POST ?a=upload   (@vercel/blob/client handleUpload body) -> client upload token for one image
//   POST ?a=delete   {pathnames: [...]}
//   POST ?a=cover    {pathname}          -> makes this image the category cover ("forside--<name>")
//   POST ?a=publish                      -> triggers the deploy hook
//   GET  ?a=image&p=<pathname>           -> the private original (for thumbnails not yet published)
//
// Env vars (Vercel):
//   ADMIN_PASSWORD          The password for /admin (also signs the session cookie)
//   BLOB_READ_WRITE_TOKEN   Added by Vercel when the Blob store is connected
//   VERCEL_DEPLOY_HOOK_URL  Deploy hook for the production branch
//
// Self-contained on purpose (no local imports), so Vercel bundles it as is. The path rules mirror
// isGalleryImagePath / isValidFolderName in src/lib/gallery/plan.ts (tests check both agree).

import { list, del, rename, get } from '@vercel/blob';
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';

export type Env = { ADMIN_PASSWORD?: string; BLOB_READ_WRITE_TOKEN?: string; VERCEL_DEPLOY_HOOK_URL?: string };
type BlobItem = { pathname: string; etag: string; size: number };
export type Blob = {
  list: (prefix: string) => Promise<BlobItem[]>;
  del: (pathnames: string[]) => Promise<void>;
  rename: (from: string, to: string) => Promise<void>;
  get: (pathname: string) => Promise<{ stream: ReadableStream; contentType: string } | null>;
  uploadToken: (request: Request, body: HandleUploadBody, check: (pathname: string) => void) => Promise<unknown>;
};
export type Deps = { env: Env; blob: Blob; fetch: typeof fetch; now?: () => number; delay?: (ms: number) => Promise<void>; log?: (m: string, e?: unknown) => void };

const ROOT = 'galleri';
const COVER_PREFIX = 'forside--';
const COOKIE = 'sb_admin';
const SESSION_DAYS = 30;
const IMAGE_EXT = ['jpg', 'jpeg', 'png', 'webp', 'tif', 'tiff', 'avif'];
const MAX_UPLOAD_BYTES = 30 * 1024 * 1024;

export const isValidFolderName = (s: string) =>
  s.trim() === s && s.length > 0 && s.length <= 60 && !/[\\/\u0000-\u001f]/.test(s) && !s.startsWith('_') && !s.startsWith('.');

export function isGalleryImagePath(p: string): boolean {
  const parts = p.split('/');
  if (parts.length !== 3 || parts[0] !== ROOT) return false;
  const [, folder, file] = parts;
  const ext = file.includes('.') ? file.split('.').pop()!.toLowerCase() : '';
  return isValidFolderName(folder) && file.length > 0 && file.length <= 150 && !file.startsWith('.')
    && !/[\u0000-\u001f\\]/.test(file) && IMAGE_EXT.includes(ext);
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...headers } });

const toHex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return toHex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data)));
}

/** Constant-time comparison of two strings (compares HMACs so lengths never leak). */
async function safeEqual(a: string, b: string): Promise<boolean> {
  const [x, y] = await Promise.all([hmac('cmp', a), hmac('cmp', b)]);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}

export async function sessionValue(password: string, expires: number): Promise<string> {
  return `${expires}.${await hmac(password, `admin-session:${expires}`)}`;
}

async function isLoggedIn(request: Request, password: string, now: number): Promise<boolean> {
  const cookie = (request.headers.get('cookie') ?? '').split(/;\s*/).find((c) => c.startsWith(`${COOKIE}=`));
  if (!cookie) return false;
  const value = cookie.slice(COOKIE.length + 1);
  const expires = Number(value.split('.')[0]);
  if (!Number.isFinite(expires) || expires < now) return false;
  return safeEqual(value, await sessionValue(password, expires));
}

const cookieHeader = (value: string, maxAge: number) =>
  `${COOKIE}=${value}; Path=/api/admin; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;

async function readJson<T>(request: Request): Promise<T | null> {
  const text = await request.text();
  if (text.length > 100_000) return null;
  try { return JSON.parse(text) as T; } catch { return null; }
}

const fileName = (p: string) => p.split('/').pop()!;
const folderOf = (p: string) => p.split('/')[1];

export async function handleAdmin(request: Request, deps: Deps): Promise<Response> {
  const log = deps.log ?? ((m: string, e?: unknown) => console.error(m, e ?? ''));
  const now = (deps.now ?? Date.now)();
  const url = new URL(request.url);
  const action = url.searchParams.get('a') ?? '';
  const { ADMIN_PASSWORD: password, BLOB_READ_WRITE_TOKEN: token, VERCEL_DEPLOY_HOOK_URL: hook } = deps.env;
  if (!password || !token) {
    log('[admin] ADMIN_PASSWORD or BLOB_READ_WRITE_TOKEN is not set');
    return json(500, { error: 'Opplastingssiden er ikke satt opp ennå.' });
  }

  const expectPost = ['login', 'logout', 'upload', 'delete', 'cover', 'publish'].includes(action);
  const expectGet = ['list', 'image'].includes(action);
  if (!expectPost && !expectGet) return json(404, { error: 'unknown action' });
  if (request.method !== (expectPost ? 'POST' : 'GET')) return json(405, { error: 'method not allowed' });

  if (action === 'login') {
    const body = await readJson<{ password?: unknown }>(request);
    if (typeof body?.password !== 'string' || !(await safeEqual(body.password, password))) {
      await (deps.delay ?? ((ms) => new Promise((r) => setTimeout(r, ms))))(1000); // slows down guessing
      return json(401, { error: 'Feil passord.' });
    }
    const expires = now + SESSION_DAYS * 86_400_000;
    return json(200, { ok: true }, { 'set-cookie': cookieHeader(await sessionValue(password, expires), SESSION_DAYS * 86_400) });
  }
  if (action === 'logout') return json(200, { ok: true }, { 'set-cookie': cookieHeader('', 0) });

  if (!(await isLoggedIn(request, password, now))) return json(401, { error: 'Du er logget ut. Logg inn på nytt.' });

  try {
    switch (action) {
      case 'list': {
        const blobs = await deps.blob.list(`${ROOT}/`);
        const folders = new Map<string, BlobItem[]>();
        for (const b of blobs) {
          if (!isGalleryImagePath(b.pathname)) continue;
          const f = folderOf(b.pathname);
          folders.set(f, [...(folders.get(f) ?? []), b]);
        }
        return json(200, {
          folders: [...folders].map(([folder, items]) => ({
            folder,
            images: items.map((b) => ({ pathname: b.pathname, name: fileName(b.pathname), etag: b.etag, size: b.size })),
          })),
        });
      }
      case 'image': {
        const p = url.searchParams.get('p') ?? '';
        if (!isGalleryImagePath(p)) return json(400, { error: 'invalid path' });
        const res = await deps.blob.get(p);
        if (!res) return json(404, { error: 'not found' });
        return new Response(res.stream, { headers: { 'content-type': res.contentType, 'cache-control': 'private, max-age=86400', 'x-content-type-options': 'nosniff' } });
      }
      case 'upload': {
        const body = await readJson<HandleUploadBody>(request);
        if (!body || body.type !== 'blob.generate-client-token') return json(400, { error: 'invalid upload request' });
        const result = await deps.blob.uploadToken(request, body, (pathname) => {
          if (!isGalleryImagePath(pathname)) throw new Error('Ugyldig mappe eller filnavn.');
        });
        return json(200, result);
      }
      case 'delete': {
        const body = await readJson<{ pathnames?: unknown }>(request);
        const paths = Array.isArray(body?.pathnames) ? body.pathnames : [];
        if (paths.length === 0 || paths.length > 500 || !paths.every((p) => typeof p === 'string' && isGalleryImagePath(p))) return json(400, { error: 'invalid paths' });
        await deps.blob.del(paths as string[]);
        return json(200, { ok: true });
      }
      case 'cover': {
        const body = await readJson<{ pathname?: unknown }>(request);
        const p = typeof body?.pathname === 'string' ? body.pathname : '';
        if (!isGalleryImagePath(p)) return json(400, { error: 'invalid path' });
        const folder = folderOf(p);
        const inFolder = (await deps.blob.list(`${ROOT}/${folder}/`)).map((b) => b.pathname).filter(isGalleryImagePath);
        if (!inFolder.includes(p)) return json(404, { error: 'not found' });
        const free = (name: string) => {
          let candidate = name;
          for (let i = 2; inFolder.includes(`${ROOT}/${folder}/${candidate}`); i++) candidate = name.replace(/(\.[^.]+)$/, ` (${i})$1`);
          return candidate;
        };
        // Only one cover per folder: give the old one its own name back.
        for (const old of inFolder) {
          const name = fileName(old);
          if (old !== p && name.startsWith(COVER_PREFIX)) await deps.blob.rename(old, `${ROOT}/${folder}/${free(name.slice(COVER_PREFIX.length))}`);
        }
        const name = fileName(p);
        if (!name.startsWith(COVER_PREFIX)) await deps.blob.rename(p, `${ROOT}/${folder}/${free(COVER_PREFIX + name)}`);
        return json(200, { ok: true });
      }
      case 'publish': {
        if (!hook) {
          log('[admin] VERCEL_DEPLOY_HOOK_URL is not set');
          return json(500, { error: 'Publisering er ikke satt opp.' });
        }
        const res = await deps.fetch(hook, { method: 'POST' });
        if (!res.ok) {
          log(`[admin] deploy hook answered ${res.status}`);
          return json(502, { error: 'Kunne ikke starte publisering. Prøv igjen om litt.' });
        }
        return json(200, { ok: true });
      }
    }
  } catch (err) {
    log(`[admin] ${action} failed`, err);
    return json(500, { error: err instanceof Error ? err.message : 'Noe gikk galt.' });
  }
  return json(404, { error: 'unknown action' });
}

// Live dependencies: Vercel Blob (private store) and the real fetch.
const liveBlob: Blob = {
  async list(prefix) {
    const out: BlobItem[] = [];
    let cursor: string | undefined;
    do {
      const page = await list({ prefix, limit: 1000, cursor });
      out.push(...page.blobs.map((b) => ({ pathname: b.pathname, etag: b.etag, size: b.size })));
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
    return out;
  },
  del: (pathnames) => del(pathnames),
  rename: async (from, to) => { await rename(from, to, { access: 'private', addRandomSuffix: false }); },
  async get(pathname) {
    const res = await get(pathname, { access: 'private' });
    if (!res || res.statusCode !== 200 || !res.stream) return null;
    return { stream: res.stream, contentType: res.blob.contentType ?? 'application/octet-stream' };
  },
  uploadToken: (request, body, check) => handleUpload({
    request,
    body,
    onBeforeGenerateToken: async (pathname) => {
      check(pathname);
      return { allowedContentTypes: ['image/jpeg', 'image/png', 'image/webp'], maximumSizeInBytes: MAX_UPLOAD_BYTES, addRandomSuffix: false, allowOverwrite: true };
    },
  }),
};

const env = () => (globalThis as unknown as { process: { env: Env } }).process.env;
const live = (request: Request) => handleAdmin(request, { env: env(), blob: liveBlob, fetch: globalThis.fetch });
export const GET = live;
export const POST = live;
