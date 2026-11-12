import { getCollection, getEntry } from 'astro:content';
import { existsSync, readFileSync } from 'node:fs';
import { mergeGalleries, type SyncedData } from './dropbox/merge.ts';

/** Written by scripts/sync-dropbox.ts before the build. Missing when Dropbox is not configured. */
export const DROPBOX_DATA_FILE = 'src/generated/dropbox-galleries.json';

function readDropboxData(): SyncedData | null {
  if (!existsSync(DROPBOX_DATA_FILE)) return null;
  return JSON.parse(readFileSync(DROPBOX_DATA_FILE, 'utf8')) as SyncedData;
}

/** Slugs that have their own top-level URL on the live site. */
export const RESERVED_GALLERY_SLUGS = ['arkitektur', 'produktbilder', 'portretter'];

/** Same rule as the original router: reserved slugs at /<slug>, others at /galleri/<slug>. */
export const galleryHref = (slug: string) =>
  RESERVED_GALLERY_SLUGS.includes(slug) ? `/${slug}` : `/galleri/${slug}`;

export async function getGalleries() {
  const all = await getCollection('galleries');
  return mergeGalleries(all.map((g) => g.data), readDropboxData());
}

export async function getSite() {
  const entry = await getEntry('site', 'main');
  if (!entry) throw new Error('src/content/site.json is missing the "main" entry');
  return entry.data;
}

/** Split CMS text into paragraphs on blank lines (same as the original). */
export const paragraphs = (text: string) =>
  text.split(/\n\s*\n/).map((t) => t.trim()).filter(Boolean);

export type GalleryItem = { id: string; src: string; full: string; title: string; description: string | null; category: string | null };

export function galleryItems(g: { name: string; images: { key: string; src: string; thumb?: string; alt: string; caption?: string }[] }, withCategory = false): GalleryItem[] {
  return g.images.map((i) => ({
    id: i.key,
    src: i.thumb || i.src,
    full: i.src,
    title: i.alt || i.caption || g.name,
    description: i.caption || null,
    category: withCategory ? g.name : null,
  }));
}
