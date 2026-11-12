// One-time import of the earlier Dropbox app folder (used by scripts/sync-gallery.ts).
// Can be deleted together with the DROPBOX_* env vars once the import has run.

import { planGalleries, type DropboxEntry } from '../src/lib/gallery/plan.ts';

type Env = Record<string, string | undefined>;
export type ImportFile = { folder: string; name: string; download: () => Promise<Buffer> };

async function accessToken(env: Env): Promise<string> {
  const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: env.DROPBOX_REFRESH_TOKEN!, client_id: env.DROPBOX_APP_KEY! });
  if (env.DROPBOX_APP_SECRET) body.set('client_secret', env.DROPBOX_APP_SECRET);
  let res = await fetch('https://api.dropboxapi.com/oauth2/token', { method: 'POST', body });
  if (!res.ok && env.DROPBOX_APP_SECRET) {
    body.delete('client_secret'); // PKCE tokens are refreshed without the secret
    res = await fetch('https://api.dropboxapi.com/oauth2/token', { method: 'POST', body });
  }
  if (!res.ok) throw new Error(`Dropbox token refresh failed: ${res.status} ${await res.text()}`);
  return (await res.json() as { access_token: string }).access_token;
}

async function api<T>(token: string, endpoint: string, args: unknown): Promise<T> {
  const res = await fetch(`https://api.dropboxapi.com/2/${endpoint}`, {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(args),
  });
  if (!res.ok) throw new Error(`Dropbox ${endpoint} failed: ${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

export async function importFromDropbox(env: Env): Promise<ImportFile[]> {
  const token = await accessToken(env);
  const root = (env.DROPBOX_ROOT_PATH ?? '').replace(/\/$/, '');
  type Page = { entries: DropboxEntry[]; cursor: string; has_more: boolean };
  let page = await api<Page>(token, 'files/list_folder', { path: root, recursive: true, limit: 2000 });
  const entries = [...page.entries];
  while (page.has_more) {
    page = await api<Page>(token, 'files/list_folder/continue', { cursor: page.cursor });
    entries.push(...page.entries);
  }
  const download = (id: string) => async () => {
    const res = await fetch('https://content.dropboxapi.com/2/files/download', {
      method: 'POST', headers: { authorization: `Bearer ${token}`, 'dropbox-api-arg': JSON.stringify({ path: id }) },
    });
    if (!res.ok) throw new Error(`Dropbox download ${id} failed: ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  };
  return planGalleries(entries, root).flatMap((g) =>
    [...(g.cover ? [g.cover] : []), ...g.images].map((img) => ({ folder: g.folder, name: img.name, download: download(img.id) })));
}
