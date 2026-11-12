// Pure logic for the gallery sync (no I/O, so it is easy to test).
//
// The images live in a Vercel Blob store under "galleri/<folder>/<file>" (uploaded through /admin).
// The same rules worked for the earlier Dropbox folder, which is imported once (scripts/sync-gallery.ts).
//
// Folder convention:
//   01 Portretter/         -> category "Portretter", order 1, slug "portretter"
//   02 Produktbilder/      -> category "Produktbilder", order 2
//   Arkitektur/            -> no number: sorted after the numbered ones, alphabetically
//   _Utkast/               -> starts with "_": ignored
//   <category>/cover.jpg   -> (or forside.jpg, or "forside--<name>") the category's hero image, not in the grid
// Images are sorted by file name ("01 ...", "02 ..." or camera numbers both work).
// The file name becomes the alt text, unless it looks like a camera name (IMG_1234).
// Files directly in the root and files in subfolders starting with "_" are ignored.
// Deeper subfolders inside a category are included in that category.

/** A file or folder from the image source (shape of a Dropbox list_folder entry). */
export type DropboxEntry = {
  '.tag': 'file' | 'folder' | 'deleted';
  name: string;
  path_display?: string;
  id?: string;
  content_hash?: string;
  size?: number;
};

export type PlannedImage = {
  /** Where to download the file: the blob pathname (or a Dropbox file id). */
  id: string;
  /** Changes when the file content changes. */
  hash: string;
  name: string;
  alt: string;
  /** Short stable key derived from the content hash, used in file names. */
  key: string;
};

export type PlannedGallery = {
  folder: string;
  slug: string;
  name: string;
  order: number;
  cover: PlannedImage | null;
  images: PlannedImage[];
};

export const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'tif', 'tiff', 'avif'];
const COVER_NAMES = ['cover', 'forside'];
/** Prefix the admin page puts on the file chosen as cover: "forside--Kari.jpg". */
export const COVER_PREFIX = 'forside--';
/** Folders without a number prefix are sorted after numbered ones. */
const UNNUMBERED_ORDER = 1000;

export const slugify = (s: string) =>
  s.toLowerCase()
    .replace(/æ/g, 'ae').replace(/ø/g, 'o').replace(/å/g, 'a')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/** "01 Portretter" -> { order: 1, name: "Portretter" }; "Arkitektur" -> { order: null, name: "Arkitektur" }. */
export function parseFolderName(folder: string): { order: number | null; name: string } {
  const m = folder.trim().match(/^(\d+)[\s._-]+(.+)$/);
  return m ? { order: Number(m[1]), name: m[2].trim() } : { order: null, name: folder.trim() };
}

const extension = (name: string) => (name.includes('.') ? name.split('.').pop()!.toLowerCase() : '');
const baseName = (name: string) => name.replace(/\.[^.]+$/, '');

/** Readable alt text from a file name, or '' when the name is just a camera/number name. */
export function altFromFileName(name: string): string {
  const base = baseName(name).replace(/^\d+[\s._-]+/, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!base || /^\d+$/.test(base)) return '';
  if (/^(img|dsc|dscf|dscn|dji|mg|_mg|pxl|p|mvi|photo|image|bilde|foto|screenshot)\s?\d/i.test(base)) return '';
  return base;
}

export const naturalCompare = (a: string, b: string) => a.localeCompare(b, 'nb', { numeric: true, sensitivity: 'base' });

/**
 * Turns a recursive list_folder result into galleries.
 * `root` is the path the listing started from ('' for the app folder root).
 */
export function planGalleries(entries: DropboxEntry[], root = ''): PlannedGallery[] {
  const rootDepth = root.split('/').filter(Boolean).length;
  const byFolder = new Map<string, DropboxEntry[]>();
  const folders = new Set<string>();

  for (const e of entries) {
    if (!e.path_display) continue;
    const parts = e.path_display.split('/').filter(Boolean).slice(rootDepth);
    if (parts.length === 0) continue;
    if (e['.tag'] === 'folder') {
      if (parts.length === 1) folders.add(parts[0]);
      continue;
    }
    if (e['.tag'] !== 'file' || parts.length < 2) continue; // files in the root are ignored
    if (parts.slice(0, -1).some((p) => p.startsWith('_') || p.startsWith('.'))) continue;
    if (e.name.startsWith('.') || !IMAGE_EXTENSIONS.includes(extension(e.name))) continue;
    if (!e.id || !e.content_hash) continue;
    folders.add(parts[0]);
    const list = byFolder.get(parts[0]) ?? [];
    list.push({ ...e, name: parts.slice(1).join('/') });
    byFolder.set(parts[0], list);
  }

  const galleries: PlannedGallery[] = [];
  const usedSlugs = new Set<string>();
  for (const folder of [...folders].sort(naturalCompare)) {
    if (folder.startsWith('_') || folder.startsWith('.')) continue;
    const { order, name } = parseFolderName(folder);
    let slug = slugify(name) || 'galleri';
    while (usedSlugs.has(slug)) slug += '-2';
    usedSlugs.add(slug);

    const files = (byFolder.get(folder) ?? []).sort((a, b) => naturalCompare(a.name, b.name));
    const toImage = (f: DropboxEntry): PlannedImage => ({
      id: f.id!, hash: f.content_hash!, name: f.name,
      alt: altFromFileName(f.name.split('/').pop()!.replace(COVER_PREFIX, '')),
      key: f.content_hash!.slice(0, 16),
    });
    const isCover = (f: DropboxEntry) => {
      const base = baseName(f.name.split('/').pop()!).toLowerCase();
      return COVER_NAMES.includes(base) || base.startsWith(COVER_PREFIX);
    };
    const coverFile = files.find(isCover);
    const images = files.filter((f) => f !== coverFile).map(toImage);
    galleries.push({ folder, slug, name, order: order ?? UNNUMBERED_ORDER, cover: coverFile ? toImage(coverFile) : null, images });
  }
  return galleries.sort((a, b) => a.order - b.order || naturalCompare(a.folder, b.folder));
}

/** Where the generated WebP files are published. */
export const IMAGE_DIR = '/images/galleri';

/** Public paths of the two sizes generated for every image. */
export const imagePaths = (key: string, dir = IMAGE_DIR) => ({
  thumb: `${dir}/${key}-900.webp`,
  full: `${dir}/${key}-2560.webp`,
});

/** Blob pathname prefix that holds the category folders. */
export const BLOB_ROOT = 'galleri';

export type BlobListItem = { pathname: string; etag: string; size?: number };

/** SHA-256 hex of a string (Web Crypto, works in Node, Vercel Functions and browsers). */
export async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Turns a Blob store listing into source entries for planGalleries(entries, BLOB_ROOT).
 * The content hash is derived from pathname + ETag, so it changes when a file is replaced.
 */
export async function blobEntries(blobs: BlobListItem[]): Promise<DropboxEntry[]> {
  return Promise.all(blobs.map(async (b) => ({
    '.tag': 'file' as const,
    name: b.pathname.split('/').pop()!,
    path_display: `/${b.pathname}`,
    id: b.pathname,
    content_hash: await sha256Hex(`${b.pathname}|${b.etag}`),
    size: b.size,
  })));
}

/** True for a folder name the admin page may create: no slashes, not hidden, not too long. */
export const isValidFolderName = (s: string) =>
  s.trim() === s && s.length > 0 && s.length <= 60 && !/[\\/\u0000-\u001f]/.test(s) && !s.startsWith('_') && !s.startsWith('.');

/** True for a blob pathname inside a category folder: "galleri/<folder>/<file>" with an image extension. */
export function isGalleryImagePath(p: string): boolean {
  const parts = p.split('/');
  if (parts.length !== 3 || parts[0] !== BLOB_ROOT) return false;
  const [, folder, file] = parts;
  return isValidFolderName(folder) && file.length > 0 && file.length <= 150 && !file.startsWith('.')
    && !/[\u0000-\u001f\\]/.test(file) && IMAGE_EXTENSIONS.includes(extension(file));
}
