import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planGalleries, parseFolderName, altFromFileName, slugify, blobEntries, isGalleryImagePath as planPathOk, isValidFolderName as planFolderOk, BLOB_ROOT, type DropboxEntry } from '../src/lib/gallery/plan.ts';
import { mergeGalleries, type Gallery, type SyncedData } from '../src/lib/gallery/merge.ts';
import { handleAdmin, sessionValue, isGalleryImagePath, isValidFolderName, type Blob, type Deps } from '../api/admin.ts';

let n = 0;
const file = (path: string): DropboxEntry => ({ '.tag': 'file', name: path.split('/').pop()!, path_display: path, id: `id:${++n}`, content_hash: `${String(n).padStart(4, '0')}${'a'.repeat(60)}` });
const folder = (path: string): DropboxEntry => ({ '.tag': 'folder', name: path.split('/').pop()!, path_display: path });

test('slugify handles Norwegian letters', () => {
  assert.equal(slugify('Portretter og Miljøbilder'), 'portretter-og-miljobilder');
  assert.equal(slugify('Bryllup & Fest'), 'bryllup-fest');
  assert.equal(slugify('Små Ærender'), 'sma-aerender');
});

test('folder names: number prefix sets the order', () => {
  assert.deepEqual(parseFolderName('01 Portretter'), { order: 1, name: 'Portretter' });
  assert.deepEqual(parseFolderName('2_Produktbilder'), { order: 2, name: 'Produktbilder' });
  assert.deepEqual(parseFolderName('Arkitektur'), { order: null, name: 'Arkitektur' });
});

test('alt text from file names, but not camera names', () => {
  assert.equal(altFromFileName('03 Kari-Nordmann_kontor.jpg'), 'Kari Nordmann kontor');
  assert.equal(altFromFileName('IMG_1234.JPG'), '');
  assert.equal(altFromFileName('DSC01234.jpg'), '');
  assert.equal(altFromFileName('_MG_5555.jpg'), '');
  assert.equal(altFromFileName('0042.jpg'), '');
});

test('planGalleries: categories, order, hidden folders, covers and file filtering', () => {
  const entries = [
    folder('/02 Produktbilder'), folder('/01 Portretter'), folder('/Arkitektur'), folder('/_Utkast'), folder('/Tom'),
    file('/01 Portretter/10 b.jpg'), file('/01 Portretter/2 a.jpg'), file('/01 Portretter/cover.jpg'),
    file('/01 Portretter/notater.txt'), file('/01 Portretter/.DS_Store'),
    file('/01 Portretter/_skjult/x.jpg'), file('/01 Portretter/Sub/c.png'),
    file('/02 Produktbilder/klokke.webp'),
    file('/Arkitektur/hus.jpeg'),
    file('/_Utkast/hemmelig.jpg'),
    file('/løs fil i roten.jpg'),
    { '.tag': 'deleted', name: 'borte.jpg', path_display: '/Arkitektur/borte.jpg' },
  ];
  const g = planGalleries(entries as DropboxEntry[]);
  assert.deepEqual(g.map((x) => [x.slug, x.order]), [['portretter', 1], ['produktbilder', 2], ['arkitektur', 1000], ['tom', 1000]]);
  const p = g[0];
  assert.equal(p.cover?.name, 'cover.jpg');
  assert.deepEqual(p.images.map((i) => i.name), ['2 a.jpg', '10 b.jpg', 'Sub/c.png']);
  assert.equal(p.images[0].key.length, 16);
  assert.equal(g[3].images.length, 0);
});

test('planGalleries respects a root path', () => {
  const g = planGalleries([file('/Nettside/01 Portretter/a.jpg'), file('/Annet/b.jpg')], '/Nettside');
  assert.deepEqual(g.map((x) => x.slug), ['portretter']);
});

const jsonGallery = (slug: string, name: string, order: number): Gallery => ({
  slug, name, order, visible: true, layout: 'natural', cover: { src: `/${slug}.webp`, alt: '' },
  heroSubtitle: 'hero', introHeading: '', intro: 'intro', ctaHeading: 'cta', ctaText: 'tekst', ctaLabel: 'Book',
  seoTitle: 'seo', seoDescription: 'desc', images: [{ key: 'old', src: '/old.jpg', alt: '' }],
});
const JSON_GALLERIES = [jsonGallery('portretter', 'Portretter og Miljøbilder', 0), jsonGallery('produktbilder', 'Produktbilder', 1), jsonGallery('arkitektur', 'Arkitektur', 2)];
const img = (key: string) => ({ key, src: `/images/dropbox/${key}-2560.webp`, thumb: `/images/dropbox/${key}-900.webp`, alt: '' });

test('merge: without Dropbox data the JSON galleries are used unchanged', () => {
  assert.deepEqual(mergeGalleries(JSON_GALLERIES, null).map((g) => g.slug), ['portretter', 'produktbilder', 'arkitektur']);
  const empty: SyncedData = { syncedAt: '', galleries: [{ slug: 'portretter', name: 'Portretter', order: 1, cover: null, images: [] }] };
  assert.equal(mergeGalleries(JSON_GALLERIES, empty)[0].images[0].key, 'old');
});

test('merge: each service takes its own folder; JSON keeps the texts; new folders become categories', () => {
  const synced: SyncedData = { syncedAt: '', galleries: [
    { slug: 'arkitektur', name: 'Arkitektur', order: 1, cover: img('c1'), images: [img('a1')] },
    { slug: 'portretter', name: 'Portretter', order: 2, cover: null, images: [img('p1'), img('p2')] },
    { slug: 'bryllup', name: 'Bryllup', order: 3, cover: null, images: [img('b1')] },
    { slug: 'tom', name: 'Tom', order: 4, cover: null, images: [] },
  ] };
  const out = mergeGalleries(JSON_GALLERIES, synced);
  // Services keep their order; produktbilder has no folder and keeps its JSON images; tom is empty.
  assert.deepEqual(out.map((g) => g.slug), ['portretter', 'produktbilder', 'arkitektur', 'bryllup']);
  assert.equal(out[1].images[0].key, 'old');
  assert.equal(out[2].cover.src, '/images/dropbox/c1-2560.webp');
  assert.equal(out[3].order, 3);
  assert.equal(out[0].name, 'Portretter og Miljøbilder');
  assert.equal(out[0].intro, 'intro');
  assert.equal(out[0].cover.src, '/portretter.webp');
  assert.deepEqual(out[0].images.map((i) => i.key), ['p1', 'p2']);
  assert.equal(out[3].name, 'Bryllup');
  assert.equal(out[3].cover.src, '/images/dropbox/b1-2560.webp');
  assert.equal(out[3].seoTitle, 'Bryllup | Stefan Borup Foto');
});

test('merge: a folder named like the long service name also matches', () => {
  const synced: SyncedData = { syncedAt: '', galleries: [
    { slug: 'portretter-og-miljobilder', name: 'Portretter og Miljøbilder', order: 1000, cover: null, images: [img('p1')] },
  ] };
  const out = mergeGalleries(JSON_GALLERIES, synced);
  assert.deepEqual(out.map((g) => g.slug), ['portretter', 'produktbilder', 'arkitektur']);
  assert.equal(out[0].images[0].key, 'p1');
});

test('blob listing: folders, covers chosen in /admin and keys that change with the file', async () => {
  const blobs = [
    { pathname: 'galleri/01 Portretter/b.jpg', etag: '"1"' },
    { pathname: 'galleri/01 Portretter/forside--Kari Nordmann.jpg', etag: '"2"' },
    { pathname: 'galleri/Bryllup/a.jpg', etag: '"3"' },
    { pathname: 'galleri/.importert-fra-dropbox', etag: '"4"' },
  ];
  const g = planGalleries(await blobEntries(blobs), BLOB_ROOT);
  assert.deepEqual(g.map((x) => [x.slug, x.images.length]), [['portretter', 2], ['bryllup', 1]]);
  assert.equal(g[0].cover?.alt, 'Kari Nordmann');
  assert.equal(g[0].images[0].id, 'galleri/01 Portretter/b.jpg');
  const again = planGalleries(await blobEntries([{ pathname: 'galleri/01 Portretter/b.jpg', etag: '"9"' }]), BLOB_ROOT);
  assert.notEqual(again[0].images[0].key, g[0].images[0].key);
  assert.equal(g[0].images[0].key.length, 16);
});

test('saved order and star: starred image is the hero and stays in the grid; new files go last', async () => {
  const blobs = ['a.jpg', 'b.jpg', 'c.jpg', 'ny.jpg', 'cover.jpg'].map((n, i) => ({ pathname: `galleri/Bryllup/${n}`, etag: String(i) }));
  const [g] = planGalleries(await blobEntries(blobs), BLOB_ROOT, { Bryllup: { order: ['c.jpg', 'a.jpg', 'b.jpg', 'slettet.jpg'], star: 'a.jpg' } });
  assert.deepEqual(g.images.map((i) => i.name), ['c.jpg', 'a.jpg', 'b.jpg', 'ny.jpg']);
  assert.equal(g.cover?.name, 'a.jpg');
  const [h] = planGalleries(await blobEntries(blobs), BLOB_ROOT, { Bryllup: { star: null } });
  assert.equal(h.cover?.name, 'cover.jpg');
  assert.deepEqual(h.images.map((i) => i.name), ['a.jpg', 'b.jpg', 'c.jpg', 'ny.jpg']);
});

test('path rules: api/admin.ts and plan.ts agree', () => {
  const paths = ['galleri/01 Portretter/a.jpg', 'galleri/Bryllup/Kari (2).JPG', 'galleri/a/b/c.jpg', 'galleri/_skjult/a.jpg', 'galleri/../a.jpg',
    'annet/x/a.jpg', 'galleri/x/a.txt', 'galleri/x/.a.jpg', 'galleri/x/', 'galleri/.importert-fra-dropbox', 'galleri/x\\y/a.jpg'];
  for (const p of paths) assert.equal(isGalleryImagePath(p), planPathOk(p), p);
  assert.deepEqual(paths.map(isGalleryImagePath), [true, true, false, false, false, false, false, false, false, false, false]);
  for (const f of ['Bryllup', ' x', '_a', '.a', 'a/b', '', 'x'.repeat(61)]) assert.equal(isValidFolderName(f), planFolderOk(f), f);
});

// ---------- api/admin.ts ----------

const PASSWORD = 'riktig hest batteri';
const NOW = 1_800_000_000_000;
function fakeBlob(initial: string[] = []) {
  const store = new Map(initial.map((p, i) => [p, String(i)]));
  const texts = new Map<string, string>();
  const calls: string[] = [];
  const blob: Blob = {
    list: async (prefix) => [...store].filter(([p]) => p.startsWith(prefix)).map(([pathname, etag]) => ({ pathname, etag, size: 1 })),
    del: async (ps) => { calls.push(`del ${ps.join(',')}`); ps.forEach((p) => store.delete(p)); },
    readText: async (p) => texts.get(p) ?? null,
    writeText: async (p, t) => { calls.push(`write ${p}`); texts.set(p, t); },
    get: async (p) => (store.has(p) ? { stream: new Response('jpeg').body!, contentType: 'image/jpeg' } : null),
    uploadToken: async (_r, body, check) => { check((body as { payload: { pathname: string } }).payload.pathname); return { type: 'blob.generate-client-token', clientToken: 't' }; },
  };
  return { blob, store, calls, texts };
}
const deps = (blob: Blob, extra: Partial<Deps> = {}): Deps => ({
  env: { ADMIN_PASSWORD: PASSWORD, BLOB_READ_WRITE_TOKEN: 'tok', VERCEL_DEPLOY_HOOK_URL: 'https://hook' },
  blob, fetch: (async () => new Response('{}', { status: 201 })) as unknown as typeof fetch,
  now: () => NOW, delay: async () => {}, log: () => {}, ...extra,
});
const req = (action: string, init: RequestInit & { cookie?: string } = {}) => {
  const headers = new Headers(init.headers);
  if (init.cookie) headers.set('cookie', init.cookie);
  return new Request(`https://stefanborup.com/api/admin?a=${action}`, { ...init, headers });
};
const session = async () => `sb_admin=${await sessionValue(PASSWORD, NOW + 1000)}`;
const post = (action: string, body: unknown, cookie?: string) => req(action, { method: 'POST', body: JSON.stringify(body), cookie });

test('admin: login sets a secure session cookie; wrong password is refused', async () => {
  const { blob } = fakeBlob();
  const bad = await handleAdmin(post('login', { password: 'feil' }), deps(blob));
  assert.equal(bad.status, 401);
  assert.equal(bad.headers.get('set-cookie'), null);
  const ok = await handleAdmin(post('login', { password: PASSWORD }), deps(blob));
  assert.equal(ok.status, 200);
  const cookie = ok.headers.get('set-cookie')!;
  assert.match(cookie, /^sb_admin=\d+\.[0-9a-f]{64}; Path=\/api\/admin; HttpOnly; Secure; SameSite=Strict; Max-Age=2592000$/);
  const list = await handleAdmin(req('list', { cookie: cookie.split(';')[0] }), deps(blob));
  assert.equal(list.status, 200);
});

test('admin: everything except login needs a valid, unexpired session', async () => {
  const { blob, calls } = fakeBlob(['galleri/A/a.jpg']);
  const forged = `sb_admin=${NOW + 1000}.${'0'.repeat(64)}`;
  const expired = `sb_admin=${await sessionValue(PASSWORD, NOW - 1)}`;
  const otherPassword = `sb_admin=${await sessionValue('annet', NOW + 1000)}`;
  for (const cookie of [undefined, forged, expired, otherPassword]) {
    assert.equal((await handleAdmin(req('list', { cookie }), deps(blob))).status, 401);
    assert.equal((await handleAdmin(post('delete', { pathnames: ['galleri/A/a.jpg'] }, cookie), deps(blob))).status, 401);
  }
  assert.deepEqual(calls, []);
});

test('admin: list groups images by folder and skips other files', async () => {
  const { blob } = fakeBlob(['galleri/01 Portretter/a.jpg', 'galleri/01 Portretter/forside--b.jpg', 'galleri/Bryllup/c.jpg', 'galleri/.importert-fra-dropbox']);
  const res = await handleAdmin(req('list', { cookie: await session() }), deps(blob));
  const data = await res.json() as { folders: { folder: string; images: { name: string }[] }[] };
  assert.deepEqual(data.folders.map((f) => [f.folder, f.images.map((i) => i.name)]), [['01 Portretter', ['a.jpg', 'forside--b.jpg']], ['Bryllup', ['c.jpg']]]);
});

test('admin: upload tokens only for image paths inside a category folder', async () => {
  const { blob } = fakeBlob();
  const body = (pathname: string) => ({ type: 'blob.generate-client-token', payload: { pathname, callbackUrl: '', clientPayload: null, multipart: false } });
  assert.equal((await handleAdmin(post('upload', body('galleri/Bryllup/a.jpg'), await session()), deps(blob))).status, 200);
  for (const p of ['galleri/a.jpg', 'galleri/_x/a.jpg', 'annet/a.jpg', 'galleri/x/a.html']) {
    assert.equal((await handleAdmin(post('upload', body(p), await session()), deps(blob))).status, 500, p);
  }
});

test('admin: delete validates paths; order and star are saved per folder', async () => {
  const { blob, calls, texts } = fakeBlob(['galleri/A/a.jpg', 'galleri/A/b.jpg']);
  const c = await session();
  assert.equal((await handleAdmin(post('delete', { pathnames: ['../etc'] }, c), deps(blob))).status, 400);
  assert.equal((await handleAdmin(post('order', { folder: 'A', names: ['b.jpg', 'a.jpg'] }, c), deps(blob))).status, 200);
  assert.equal((await handleAdmin(post('star', { folder: 'A', name: 'b.jpg' }, c), deps(blob))).status, 200);
  assert.deepEqual(JSON.parse(texts.get('galleri/.oppsett.json')!), { A: { order: ['b.jpg', 'a.jpg'], star: 'b.jpg' } });
  const list = await (await handleAdmin(req('list', { cookie: c }), deps(blob))).json() as { settings: unknown };
  assert.deepEqual(list.settings, { A: { order: ['b.jpg', 'a.jpg'], star: 'b.jpg' } });
  assert.equal((await handleAdmin(post('star', { folder: 'A', name: null }, c), deps(blob))).status, 200);
  assert.equal(JSON.parse(texts.get('galleri/.oppsett.json')!).A.star, null);
  for (const bad of [{ folder: '_x', names: [] }, { folder: 'A', names: ['../x.jpg'] }, { folder: 'A', names: 'a.jpg' }]) {
    assert.equal((await handleAdmin(post('order', bad, c), deps(blob))).status, 400);
  }
  assert.equal((await handleAdmin(post('star', { folder: 'A', name: 'x.txt' }, c), deps(blob))).status, 400);
  assert.equal((await handleAdmin(post('delete', { pathnames: ['galleri/A/a.jpg'] }, c), deps(blob))).status, 200);
  assert.equal(calls.at(-1), 'del galleri/A/a.jpg');
});

test('admin: publish calls the deploy hook; image proxies the private original', async () => {
  const hooks: string[] = [];
  const { blob } = fakeBlob(['galleri/A/a.jpg']);
  const d = deps(blob, { fetch: (async (u: string) => { hooks.push(u); return new Response('{}', { status: 201 }); }) as unknown as typeof fetch });
  const c = await session();
  assert.equal((await handleAdmin(post('publish', {}, c), d)).status, 200);
  assert.deepEqual(hooks, ['https://hook']);
  const img = await handleAdmin(req('image&p=' + encodeURIComponent('galleri/A/a.jpg'), { cookie: c }), d);
  assert.equal(img.status, 200);
  assert.equal(img.headers.get('content-type'), 'image/jpeg');
  assert.equal((await handleAdmin(req('image&p=' + encodeURIComponent('annet/x.jpg'), { cookie: c }), d)).status, 400);
});

test('admin: wrong method, unknown action and missing config', async () => {
  const { blob } = fakeBlob();
  assert.equal((await handleAdmin(req('list', { method: 'POST', cookie: await session() }), deps(blob))).status, 405);
  assert.equal((await handleAdmin(req('nope'), deps(blob))).status, 404);
  assert.equal((await handleAdmin(post('login', { password: PASSWORD }), deps(blob, { env: {} }))).status, 500);
});
