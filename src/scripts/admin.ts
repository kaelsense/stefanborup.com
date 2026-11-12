// Browser code for /admin (see src/pages/admin.astro and api/admin.ts).
import { upload } from '@vercel/blob/client';
import Sortable from 'sortablejs';
import { parseFolderName, slugify, naturalCompare, sha256Hex, isValidFolderName, sortByOrder, COVER_PREFIX, IMAGE_DIR, type GallerySettings } from '../lib/gallery/plan.ts';

type Service = { slug: string; name: string };
type Img = { pathname: string; name: string; etag: string; size: number };
type Folder = { folder: string; images: Img[] };
type Category = { folder: string; title: string; service: boolean; images: Img[] };

const API = '/api/admin';
const MAX_EDGE = 3200;
const JPEG_QUALITY = 0.9;
const UPLOAD_CONCURRENCY = 3;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const services: Service[] = JSON.parse($('services').textContent || '[]');
const extraFolders = new Set<string>(); // new categories without images yet
let folders: Folder[] = [];
let settings: GallerySettings = {};
let published = new Set<string>();

// ---------- helpers ----------

function setStatus(text: string, kind: 'ok' | 'err' | '' = '') {
  const el = $('status');
  el.hidden = !text;
  el.textContent = text;
  el.className = `status ${kind}`;
}

async function call<T>(action: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}?a=${action}`, body === undefined && action === 'list'
    ? { credentials: 'same-origin' }
    : { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && action !== 'login') { showLogin(); throw new Error(data.error || 'Logget ut'); }
  if (!res.ok) throw new Error(data.error || `Feil (${res.status})`);
  return data as T;
}

const matchesService = (folder: string, s: Service) => {
  const slug = slugify(parseFolderName(folder).name);
  return slug === s.slug || slug === slugify(s.name);
};

function categories(): Category[] {
  const used = new Set<string>();
  const cats: Category[] = services.map((s) => {
    const f = folders.find((x) => matchesService(x.folder, s));
    if (f) used.add(f.folder);
    const folder = f?.folder ?? s.slug.charAt(0).toUpperCase() + s.slug.slice(1);
    return { folder, title: s.name, service: true, images: f?.images ?? [] };
  });
  const rest = [...folders.filter((f) => !used.has(f.folder)).map((f) => f.folder), ...[...extraFolders].filter((f) => !folders.some((x) => x.folder === f))];
  for (const folder of [...new Set(rest)].sort(naturalCompare)) {
    cats.push({ folder, title: parseFolderName(folder).name, service: false, images: folders.find((f) => f.folder === folder)?.images ?? [] });
  }
  for (const c of cats) c.images = sortByOrder(c.images, settings[c.folder]?.order);
  return cats;
}

/** The starred (hero) image of a category: chosen with the star, or an older "forside--" file. */
function starred(cat: Category): string | null {
  const star = settings[cat.folder]?.star;
  if (star && cat.images.some((i) => i.name === star)) return star;
  return cat.images.find((i) => i.name.startsWith(COVER_PREFIX))?.name ?? null;
}

async function thumbUrl(img: Img): Promise<string> {
  const key = (await sha256Hex(`${img.pathname}|${img.etag}`)).slice(0, 16);
  return published.has(key) ? `${IMAGE_DIR}/${key}-900.webp` : `${API}?a=image&p=${encodeURIComponent(img.pathname)}`;
}

/** Downscale to at most MAX_EDGE px and re-encode as JPEG (also strips EXIF/GPS). */
async function shrink(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('kunne ikke lage JPEG'))), 'image/jpeg', JPEG_QUALITY));
}

const cleanName = (name: string) =>
  name.replace(/\.[^.]+$/, '').replace(/[\\/\u0000-\u001f]/g, ' ').replace(/^[._]+/, '').replace(/\s+/g, ' ').trim().slice(0, 120) || 'bilde';

let publishTimer: number | undefined;
async function publish() {
  try {
    await call('publish');
    setStatus('Lagret. Nettsiden oppdateres nå, og endringen er synlig om ca. 2 minutter.', 'ok');
  } catch (e) {
    setStatus(`Bildene er lagret, men nettsiden ble ikke oppdatert: ${(e as Error).message}`, 'err');
  }
}
/** Publish shortly after the last change, so several quick changes give one update. */
function schedulePublish() {
  clearTimeout(publishTimer);
  setStatus('Lagret. Oppdaterer nettsiden …');
  publishTimer = window.setTimeout(publish, 4000);
}

// ---------- rendering ----------

async function render() {
  const root = $('cats');
  root.replaceChildren();
  for (const cat of categories()) {
    const sec = document.createElement('section');
    sec.className = 'cat';
    const head = document.createElement('div');
    head.className = 'cat-head';
    const h = document.createElement('h2');
    h.textContent = cat.title;
    const info = document.createElement('small');
    info.textContent = cat.images.length ? `${cat.images.length} ${cat.images.length === 1 ? 'bilde' : 'bilder'}` : (cat.service ? 'Ingen bilder lastet opp: siden viser de gamle bildene' : 'Ingen bilder ennå');
    head.append(h, info);
    if (!cat.service && cat.images.length) {
      const delAll = document.createElement('button');
      delAll.className = 'danger';
      delAll.textContent = 'Slett kategorien';
      delAll.onclick = async () => {
        if (!confirm(`Slette kategorien «${cat.title}» og alle ${cat.images.length} bildene i den?`)) return;
        await runChange(() => call('delete', { pathnames: cat.images.map((i) => i.pathname) }));
      };
      head.append(delAll);
    }

    const drop = document.createElement('div');
    drop.className = 'drop';
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/jpeg,image/png,image/webp,image/heic,image/heif';
    input.multiple = true;
    input.hidden = true;
    input.onchange = () => { if (input.files?.length) uploadFiles(cat.folder, [...input.files]); input.value = ''; };
    const pick = document.createElement('button');
    pick.type = 'button';
    pick.className = 'primary';
    pick.textContent = 'Last opp nye bilder';
    pick.onclick = () => input.click();
    drop.append('Dra nye bilder inn hit', document.createElement('br'), pick, input);
    drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); };
    drop.ondragleave = () => drop.classList.remove('over');
    drop.ondrop = (e) => {
      e.preventDefault();
      drop.classList.remove('over');
      const files = [...(e.dataTransfer?.files ?? [])].filter((f) => f.type.startsWith('image/'));
      if (files.length) uploadFiles(cat.folder, files);
    };

    const grid = document.createElement('div');
    grid.className = 'grid';
    const star = starred(cat);
    for (const img of cat.images) grid.append(await tile(cat, img, img.name === star));
    if (!cat.images.length) {
      const p = document.createElement('p');
      p.className = 'empty';
      p.textContent = 'Ingen bilder her ennå.';
      grid.append(p);
    } else {
      Sortable.create(grid, {
        animation: 150,
        delay: 200,
        delayOnTouchOnly: true, // on phones: press and hold to drag, so the page still scrolls
        filter: 'button',
        preventOnFilter: false,
        ghostClass: 'ghost',
        onEnd: (e) => {
          if (e.oldIndex === e.newIndex) return;
          const names = [...grid.querySelectorAll<HTMLElement>('.tile')].map((t) => t.dataset.name!);
          saveSetting(cat.folder, { order: names });
        },
      });
    }
    sec.append(head, grid, drop);
    root.append(sec);
  }
}

const STAR_ON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.3 1.3-6.6L2.5 9.4l6.6-.8z"/></svg>';

async function tile(cat: Category, img: Img, isStar: boolean): Promise<HTMLElement> {
  const label = img.name.replace(COVER_PREFIX, '');
  const el = document.createElement('div');
  el.className = `tile${isStar ? ' starred' : ''}`;
  el.dataset.name = img.name;
  el.title = label;
  const pic = document.createElement('img');
  pic.loading = 'lazy';
  pic.alt = label;
  pic.draggable = false;
  pic.src = await thumbUrl(img);

  const starBtn = document.createElement('button');
  starBtn.type = 'button';
  starBtn.className = 'star';
  starBtn.innerHTML = STAR_ON;
  starBtn.setAttribute('aria-pressed', String(isStar));
  starBtn.title = isStar ? 'Fremhevet bilde (øverst på siden). Trykk for å fjerne.' : 'Fremhev dette bildet (vises øverst på siden)';
  starBtn.setAttribute('aria-label', starBtn.title);
  starBtn.onclick = () => saveSetting(cat.folder, { star: isStar ? null : img.name });

  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'del';
  del.textContent = '×';
  del.title = 'Slett bildet';
  del.setAttribute('aria-label', `Slett ${label}`);
  del.onclick = async () => {
    if (!confirm(`Slette «${label}» fra nettsiden?`)) return;
    await runChange(() => call('delete', { pathnames: [img.pathname] }));
  };
  el.append(pic, starBtn, del);
  return el;
}

/** Saves order or star for a category, updates the page right away and publishes shortly after. */
async function saveSetting(folder: string, change: { order?: string[]; star?: string | null }) {
  settings = { ...settings, [folder]: { ...settings[folder], ...change } };
  await render();
  try {
    setStatus('Lagrer …');
    const res = 'order' in change
      ? await call<{ settings: GallerySettings }>('order', { folder, names: change.order })
      : await call<{ settings: GallerySettings }>('star', { folder, name: change.star });
    settings = res.settings;
    schedulePublish();
  } catch (e) {
    setStatus(`Noe gikk galt: ${(e as Error).message}`, 'err');
    await refresh().catch(() => {});
  }
}

// ---------- actions ----------

async function refresh() {
  const data = await call<{ folders: Folder[]; settings: GallerySettings }>('list');
  folders = data.folders;
  settings = data.settings ?? {};
  await render();
}

async function runChange(fn: () => Promise<unknown>) {
  try {
    setStatus('Lagrer …');
    await fn();
    await refresh();
    schedulePublish();
  } catch (e) {
    setStatus(`Noe gikk galt: ${(e as Error).message}`, 'err');
  }
}

async function uploadFiles(folder: string, files: File[]) {
  const existing = new Set(folders.flatMap((f) => f.images.map((i) => i.pathname.toLowerCase())));
  let done = 0;
  const failed: string[] = [];
  const queue = [...files];
  const progress = () => setStatus(`Laster opp ${done + failed.length} av ${files.length} bilder …`);
  progress();
  await Promise.all(Array.from({ length: Math.min(UPLOAD_CONCURRENCY, files.length) }, async () => {
    for (let file = queue.shift(); file; file = queue.shift()) {
      try {
        const jpeg = await shrink(file);
        let base = cleanName(file.name);
        let pathname = `galleri/${folder}/${base}.jpg`;
        for (let i = 2; existing.has(pathname.toLowerCase()); i++) pathname = `galleri/${folder}/${base} (${i}).jpg`;
        existing.add(pathname.toLowerCase());
        await upload(pathname, jpeg, { access: 'private', handleUploadUrl: `${API}?a=upload`, contentType: 'image/jpeg' });
        done++;
      } catch (e) {
        console.error(file.name, e);
        failed.push(file.name);
      }
      progress();
    }
  }));
  await refresh().catch(() => {});
  if (done) schedulePublish();
  if (failed.length) {
    setStatus(`${done} bilder lastet opp. Disse kunne ikke lastes opp: ${failed.join(', ')}. Prøv å lagre dem som JPEG og last opp på nytt.`, 'err');
  }
}

// ---------- login ----------

function showLogin() {
  $('app').hidden = true;
  $('login').hidden = false;
  $<HTMLInputElement>('password').focus();
}

async function start() {
  try {
    const res = await fetch(`${IMAGE_DIR}/manifest.json`, { cache: 'no-store' });
    if (res.ok) published = new Set((await res.json()).keys);
  } catch { /* thumbnails fall back to the originals */ }
  await refresh();
  $('login').hidden = true;
  $('app').hidden = false;
}

$('login').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('login-error');
  err.hidden = true;
  try {
    await call('login', { password: $<HTMLInputElement>('password').value });
    await start();
  } catch (ex) {
    err.textContent = (ex as Error).message;
    err.hidden = false;
  }
});

$('logout').addEventListener('click', async () => {
  await call('logout').catch(() => {});
  showLogin();
});

$('new-cat').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = $<HTMLInputElement>('new-cat-name');
  const name = input.value.replace(/[\\/]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!isValidFolderName(name) || !slugify(name)) { setStatus('Bruk et vanlig navn med bokstaver, for eksempel «Bryllup».', 'err'); return; }
  if (categories().some((c) => slugify(parseFolderName(c.folder).name) === slugify(name))) { setStatus(`Kategorien «${name}» finnes allerede.`, 'err'); return; }
  extraFolders.add(name);
  input.value = '';
  await render();
  setStatus(`Kategorien «${name}» er lagt til. Last opp bilder i den, så vises den på nettsiden.`, 'ok');
});

// Logged in already? (the session cookie is HttpOnly, so just try.)
start().catch(() => showLogin());
