// Fetches the gallery images from the Vercel Blob store before `astro build`.
//
//   node --experimental-strip-types scripts/sync-gallery.ts
//
// The images are uploaded through the password-protected page /admin (api/admin.ts) and stored
// privately in Blob under "galleri/<category folder>/<file>". See README "Gallery and /admin".
//
// Env vars (set in Vercel):
//   BLOB_READ_WRITE_TOKEN  Added by Vercel when the Blob store is connected to the project
//   DROPBOX_APP_KEY, DROPBOX_REFRESH_TOKEN, DROPBOX_APP_SECRET, DROPBOX_ROOT_PATH
//                          Optional, only for the one-time import of the earlier Dropbox folder
//
// Without BLOB_READ_WRITE_TOKEN the script does nothing and the site uses the images listed in
// src/content/galleries/*.json (local dev, tests). With it, an error fails the build, so Vercel
// keeps the previous deployment live.
//
// Output (both gitignored):
//   public/images/galleri/<key>-900.webp and <key>-2560.webp, plus manifest.json
//   src/generated/galleries.json  (read by src/lib/content.ts)
//
// To avoid processing every original on every build, images already published on the live site
// (listed in its /images/galleri/manifest.json) are copied from there instead.

import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { list, get, put } from '@vercel/blob';
import { planGalleries, imagePaths, blobEntries, BLOB_ROOT, IMAGE_DIR, type PlannedImage } from '../src/lib/gallery/plan.ts';
import { importFromDropbox } from './dropbox-import.ts';

const OUT_DIR = join('public', IMAGE_DIR);
const DATA_FILE = 'src/generated/galleries.json';
/** Marker blob: the Dropbox folder has been imported, never import it again. */
const IMPORT_MARKER = `${BLOB_ROOT}/.importert-fra-dropbox`;
const SIZES = [{ suffix: '900', width: 900, quality: 80 }, { suffix: '2560', width: 2560, quality: 82 }];
const CONCURRENCY = 4;

const env = process.env;
const log = (...a: unknown[]) => console.log('[galleri]', ...a);

async function listAll() {
  const blobs: { pathname: string; etag: string; size: number }[] = [];
  let cursor: string | undefined;
  do {
    const page = await list({ prefix: `${BLOB_ROOT}/`, limit: 1000, cursor });
    blobs.push(...page.blobs.map((b) => ({ pathname: b.pathname, etag: b.etag, size: b.size })));
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return blobs;
}

async function download(pathname: string): Promise<Buffer> {
  const res = await get(pathname, { access: 'private', useCache: false });
  if (!res || res.statusCode !== 200 || !res.stream) throw new Error(`download ${pathname} failed`);
  return Buffer.from(await new Response(res.stream).arrayBuffer());
}

/** Keys already processed and published on the live site, to skip re-processing originals. */
async function liveManifest(): Promise<{ origin: string; keys: Set<string> } | null> {
  const host = env.GALLERY_CACHE_ORIGIN || env.VERCEL_PROJECT_PRODUCTION_URL;
  if (!host) return null;
  const origin = host.startsWith('http') ? host.replace(/\/$/, '') : `https://${host}`;
  try {
    const res = await fetch(`${origin}${IMAGE_DIR}/manifest.json`, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    return { origin, keys: new Set((await res.json() as { keys: string[] }).keys) };
  } catch { return null; }
}

async function fromLive(origin: string, key: string): Promise<boolean> {
  try {
    const files = await Promise.all(SIZES.map(async (s) => {
      const res = await fetch(`${origin}${IMAGE_DIR}/${key}-${s.suffix}.webp`, { signal: AbortSignal.timeout(30_000) });
      if (!res.ok) throw new Error(String(res.status));
      return { s, buf: Buffer.from(await res.arrayBuffer()) };
    }));
    for (const { s, buf } of files) writeFileSync(join(OUT_DIR, `${key}-${s.suffix}.webp`), buf);
    return true;
  } catch { return false; }
}

async function processImage(img: PlannedImage) {
  const original = await download(img.id);
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

/** One-time import of the earlier Dropbox folder into Blob (only while the marker is missing). */
async function maybeImportDropbox(blobs: { pathname: string }[]): Promise<boolean> {
  if (blobs.some((b) => b.pathname === IMPORT_MARKER)) return false;
  if (!env.DROPBOX_APP_KEY || !env.DROPBOX_REFRESH_TOKEN) return false;
  log('importing the Dropbox folder into Blob (one time)');
  const files = await importFromDropbox(env);
  let n = 0;
  await pool(files, async (f) => {
    const pathname = `${BLOB_ROOT}/${f.folder}/${f.name.replace(/\//g, ' ').replace(/\.[^.]+$/, '')}.jpg`;
    if (blobs.some((b) => b.pathname === pathname)) return; // already there
    const jpeg = await sharp(await f.download(), { failOn: 'none' })
      .rotate().resize({ width: 3200, height: 3200, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer();
    await put(pathname, jpeg, { access: 'private', contentType: 'image/jpeg', addRandomSuffix: false, allowOverwrite: true });
    n++;
  });
  await put(IMPORT_MARKER, new Date().toISOString(), { access: 'private', contentType: 'text/plain', addRandomSuffix: false, allowOverwrite: true });
  log(`imported ${n} images from Dropbox`);
  return true;
}

async function main() {
  if (!env.BLOB_READ_WRITE_TOKEN) {
    log('BLOB_READ_WRITE_TOKEN not set: using the images in src/content/galleries/*.json');
    rmSync(DATA_FILE, { force: true });
    return;
  }
  let blobs = await listAll();
  if (await maybeImportDropbox(blobs)) blobs = await listAll();

  const galleries = planGalleries(await blobEntries(blobs.filter((b) => b.pathname !== IMPORT_MARKER)), BLOB_ROOT);
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
    await processImage(img);
    processed++;
  });
  log(`${processed} images processed, ${reused} reused from ${live?.origin ?? '-'}`);

  const toImg = (img: PlannedImage) => { const p = imagePaths(img.key); return { key: img.key, src: p.full, thumb: p.thumb, alt: img.alt }; };
  const data = {
    syncedAt: new Date().toISOString(),
    galleries: galleries.map((g) => ({ slug: g.slug, name: g.name, order: g.order, cover: g.cover ? toImg(g.cover) : null, images: g.images.map(toImg) })),
  };
  writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  writeFileSync(join(OUT_DIR, 'manifest.json'), JSON.stringify({ keys: [...unique.keys()] }));
}

main().catch((err) => {
  console.error('[galleri] sync failed:', err);
  process.exit(1);
});
