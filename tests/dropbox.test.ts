import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planGalleries, parseFolderName, altFromFileName, slugify, type DropboxEntry } from '../src/lib/dropbox/plan.ts';
import { mergeGalleries, type Gallery, type SyncedData } from '../src/lib/dropbox/merge.ts';
import { handleDropboxWebhook, signature } from '../api/dropbox-webhook.ts';

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
  const g = planGalleries(entries);
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

const SECRET = 'app-secret';
const hookEnv = { DROPBOX_APP_SECRET: SECRET, VERCEL_DEPLOY_HOOK_URL: 'https://api.vercel.com/v1/integrations/deploy/x/y' };
const mockFetch = (status = 201) => {
  const calls: string[] = [];
  const fn = (async (url: string) => { calls.push(url); return new Response('{}', { status }); }) as unknown as typeof fetch;
  return { fn, calls };
};
const silent = () => {};

test('webhook: answers the Dropbox verification challenge', async () => {
  const res = await handleDropboxWebhook(new Request('https://stefanborup.com/api/dropbox-webhook?challenge=abc123'), { env: hookEnv, fetch: mockFetch().fn });
  assert.equal(res.status, 200);
  assert.equal(await res.text(), 'abc123');
  assert.match(res.headers.get('content-type')!, /text\/plain/);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
});

test('webhook: valid signature triggers the deploy hook', async () => {
  const body = JSON.stringify({ list_folder: { accounts: ['dbid:1'] }, delta: { users: [1] } });
  const m = mockFetch();
  const res = await handleDropboxWebhook(new Request('https://stefanborup.com/api/dropbox-webhook', { method: 'POST', body, headers: { 'x-dropbox-signature': await signature(SECRET, body) } }), { env: hookEnv, fetch: m.fn });
  assert.equal(res.status, 200);
  assert.deepEqual(m.calls, [hookEnv.VERCEL_DEPLOY_HOOK_URL]);
});

test('webhook: wrong or missing signature is rejected without deploying', async () => {
  const m = mockFetch();
  for (const sig of ['deadbeef', '']) {
    const res = await handleDropboxWebhook(new Request('https://stefanborup.com/api/dropbox-webhook', { method: 'POST', body: '{}', headers: sig ? { 'x-dropbox-signature': sig } : {} }), { env: hookEnv, fetch: m.fn });
    assert.equal(res.status, 403);
  }
  assert.equal(m.calls.length, 0);
});

test('webhook: missing config and failing deploy hook', async () => {
  const body = '{}';
  const headers = { 'x-dropbox-signature': await signature(SECRET, body) };
  const r1 = await handleDropboxWebhook(new Request('https://x/api/dropbox-webhook', { method: 'POST', body, headers }), { env: {}, fetch: mockFetch().fn, log: silent });
  assert.equal(r1.status, 500);
  const r2 = await handleDropboxWebhook(new Request('https://x/api/dropbox-webhook', { method: 'POST', body, headers }), { env: hookEnv, fetch: mockFetch(500).fn, log: silent });
  assert.equal(r2.status, 502);
  const r3 = await handleDropboxWebhook(new Request('https://x/api/dropbox-webhook', { method: 'PUT' }), { env: hookEnv, fetch: mockFetch().fn });
  assert.equal(r3.status, 405);
});
