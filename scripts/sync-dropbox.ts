// Fetches the gallery images from Dropbox before `astro build`.
//
//   node --experimental-strip-types scripts/sync-dropbox.ts
//
// Env vars (set in Vercel; see README "Bildegalleri fra Dropbox"):
//   DROPBOX_APP_KEY        App key of the Dropbox app (access type "App folder")
//   DROPBOX_REFRESH_TOKEN  Long-lived refresh token for the account that holds the photos
//   DROPBOX_APP_SECRET     Optional here (needed by api/dropbox-webhook.ts)
//   DROPBOX_ROOT_PATH      Optional: subfolder inside the app folder, default '' (the app folder itself)
//
// Without DROPBOX_APP_KEY / DROPBOX_REFRESH_TOKEN the script does nothing and the site uses
// the images listed in src/content/galleries/*.json (local dev, tests).
// With them, a Dropbox error fails the build, so Vercel keeps the previous deployment live.
//
// Output (both gitignored):
//   public/images/dropbox/<key>-900.webp and <key>-2560.webp, plus manifest.json
//   src/generated/dropbox-galleries.json  (read by src/lib/content.ts)
//
// To avoid downloading every original on every build, images already published on the live site
// (listed in its /images/dropbox/manifest.json) are copied from there instead of re-processed.

import { mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { planGalleries, imagePaths, type DropboxEntry, type PlannedImage } from '../src/lib/dropbox/plan.ts';

const OUT_DIR = 'public/images/dropbox';
const DATA_FILE = 'src/generated/dropbox-galleries.json';
const SIZES = [{ suffix: '900', width: 900, quality: 80 }, { suffix: '2560', width: 2560, quality: 82 }];
const CONCURRENCY = 4;

const env = process.env;
const log = (...a: unknown[]) => console.log('[dropbox]', ...a);

async function accessToken(): Promise<string> {
  const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: env.DROPBOX_REFRESH_TOKEN!, client_id: env.DROPBOX_APP_KEY! });
  if (env.DROPBOX_APP_SECRET) body.set('client_secret', env.DROPBOX_APP_SECRET);
  let res = await fetch('https://api.dropboxapi.com/oauth2/token', { method: 'POST', body });
  if (!res.ok && env.DROPBOX_APP_SECRET) {
    // Tokens issued with PKCE are refreshed without the secret.
    body.delete('client_secret');
    res = await fetch('https://api.dropboxapi.com/oauth2/token', { method: 'POST', body });
  }
  if (!res.ok) throw new Error(`token refresh failed: ${res.status} ${await res.text()}`);
  return (await res.json() as { access_token: string }).access_token;
}

async function api<T>(token: string, endpoint: string, args: unknown): Promise<T> {
  const res = await fetch(`https://api.dropboxapi.com/2/${endpoint}`, {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(args),
  });
  if (!res.ok) throw new Error(`${endpoint} failed: ${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

async function listAll(token: string, path: string): Promise<DropboxEntry[]> {
  type Page = { entries: DropboxEntry[]; cursor: string; has_more: boolean };
  let page = await api<Page>(token, 'files/list_folder', { path, recursive: true, limit: 2000 });
  const entries = [...page.entries];
  while (page.has_more) {
    page = await api<Page>(token, 'files/list_folder/continue', { cursor: page.cursor });
    entries.push(...page.entries);
  }
  return entries;
}

async function download(token: string, id: string): Promise<Buffer> {
  const res = await fetch('https://content.dropboxapi.com/2/files/download', {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'dropbox-api-arg': JSON.stringify({ path: id }) },
  });
  if (!res.ok) throw new Error(`download ${id} failed: ${res.status} ${await res.text()}`);
  return Buffer.from(await res.arrayBuffer());
}

/** Keys already processed and published on the live site, to skip re-downloading originals. */
async function liveManifest(): Promise<{ origin: string; keys: Set<string> } | null> {
  const host = env.DROPBOX_CACHE_ORIGIN || env.VERCEL_PROJECT_PRODUCTION_URL;
  if (!host) return null;
  const origin = host.startsWith('http') ? host.replace(/\/$/, '') : `https://${host}`;
  try {
    const res = await fetch(`${origin}/images/dropbox/manifest.json`, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    return { origin, keys: new Set((await res.json() as { keys: string[] }).keys) };
  } catch { return null; }
}

async function fromLive(origin: string, key: string): Promise<boolean> {
  try {
    const files = await Promise.all(SIZES.map(async (s) => {
      const res = await fetch(`${origin}/images/dropbox/${key}-${s.suffix}.webp`, { signal: AbortSignal.timeout(30_000) });
      if (!res.ok) throw new Error(String(res.status));
      return { s, buf: Buffer.from(await res.arrayBuffer()) };
    }));
    for (const { s, buf } of files) writeFileSync(join(OUT_DIR, `${key}-${s.suffix}.webp`), buf);
    return true;
  } catch { return false; }
}

async function processImage(token: string, img: PlannedImage) {
  const original = await download(token, img.id);
  for (const s of SIZES) {
    await sharp(original, { failOn: 'none' })
      .rotate() // respect EXIF orientation; metadata (incl. GPS) is stripped
      .resize({ width: s.width, withoutEnlargement: true })
      .webp({ quality: s.quality })
      .toFile(join(OUT_DIR, `${img.key}-${s.suffix}.webp`));
  }
}

async function pool<T>(items: T[], fn: (item: T) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    while (i < items.length) await fn(items[i++]);
  }));
}

async function main() {
  if (!env.DROPBOX_APP_KEY || !env.DROPBOX_REFRESH_TOKEN) {
    log('DROPBOX_APP_KEY / DROPBOX_REFRESH_TOKEN not set: using the images in src/content/galleries/*.json');
    rmSync(DATA_FILE, { force: true });
    return;
  }
  const root = (env.DROPBOX_ROOT_PATH ?? '').replace(/\/$/, '');
  const token = await accessToken();
  const galleries = planGalleries(await listAll(token, root), root);
  log(`found ${galleries.length} categories:`, galleries.map((g) => `${g.name} (${g.images.length})`).join(', ') || '-');

  rmSync(OUT_DIR, { recursive: true, force: true });
  mkdirSync(OUT_DIR, { recursive: true });
  mkdirSync('src/generated', { recursive: true });

  const unique = new Map<string, PlannedImage>();
  for (const g of galleries) for (const img of [...(g.cover ? [g.cover] : []), ...g.images]) unique.set(img.key, img);

  const live = await liveManifest();
  let reused = 0, processed = 0;
  await pool([...unique.values()], async (img) => {
    if (live?.keys.has(img.key) && await fromLive(live.origin, img.key)) { reused++; return; }
    await processImage(token, img);
    processed++;
  });
  log(`${processed} images processed from Dropbox, ${reused} reused from ${live?.origin ?? '-'}`);

  const toImg = (img: PlannedImage) => { const p = imagePaths(img.key); return { key: img.key, src: p.full, thumb: p.thumb, alt: img.alt }; };
  const data = {
    syncedAt: new Date().toISOString(),
    galleries: galleries.map((g) => ({ slug: g.slug, name: g.name, order: g.order, cover: g.cover ? toImg(g.cover) : null, images: g.images.map(toImg) })),
  };
  writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  writeFileSync(join(OUT_DIR, 'manifest.json'), JSON.stringify({ keys: [...unique.keys()] }));
  if (!existsSync(DATA_FILE)) throw new Error('could not write ' + DATA_FILE);
}

main().catch((err) => {
  console.error('[dropbox] sync failed:', err);
  process.exit(1);
});
