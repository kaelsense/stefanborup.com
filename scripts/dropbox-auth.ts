// One-time helper: get a Dropbox refresh token for the account that holds the photos.
//
//   npm run dropbox:auth -- <DROPBOX_APP_KEY>
//
// 1. Open the printed link, log in to Dropbox with the account that should hold the photos and approve.
// 2. Paste the code Dropbox shows back here.
// 3. Put the printed refresh token in Vercel as DROPBOX_REFRESH_TOKEN.
//
// Uses PKCE, so the app secret is not needed. Moving the photos to another Dropbox account later
// means running this again with that account and replacing DROPBOX_REFRESH_TOKEN.

import { createHash, randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline/promises';

const appKey = process.argv[2] || process.env.DROPBOX_APP_KEY;
if (!appKey) {
  console.error('Usage: npm run dropbox:auth -- <DROPBOX_APP_KEY>');
  process.exit(1);
}

const verifier = randomBytes(48).toString('base64url');
const challenge = createHash('sha256').update(verifier).digest('base64url');
const url = new URL('https://www.dropbox.com/oauth2/authorize');
url.search = new URLSearchParams({
  client_id: appKey, response_type: 'code', token_access_type: 'offline',
  code_challenge: challenge, code_challenge_method: 'S256',
}).toString();

console.log('\n1) Open this link and approve the app:\n\n   ' + url + '\n');
const rl = createInterface({ input: process.stdin, output: process.stdout });
const code = (await rl.question('2) Paste the code from Dropbox: ')).trim();
rl.close();

const res = await fetch('https://api.dropboxapi.com/oauth2/token', {
  method: 'POST',
  body: new URLSearchParams({ code, grant_type: 'authorization_code', client_id: appKey, code_verifier: verifier }),
});
const data = await res.json() as { refresh_token?: string; error_description?: string };
if (!res.ok || !data.refresh_token) {
  console.error('\nDropbox said:', data.error_description ?? JSON.stringify(data));
  process.exit(1);
}
console.log('\n3) DROPBOX_REFRESH_TOKEN =\n\n   ' + data.refresh_token + '\n');
