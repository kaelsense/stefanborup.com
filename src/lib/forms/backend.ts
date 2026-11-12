// FORM BACKEND SEAM: the only place in the browser code that knows where form data is sent.
//
// Chosen backend: Resend, through the Vercel serverless function api/lead.ts
// (POST /api/lead). The function validates again, sends one email and answers
// JSON { ok: true } or { ok: false, error }. The UI (success / "Noe gikk galt"
// toasts) is unchanged and only looks at `ok`.
import type { LeadPayload } from './lead.ts';

export const LEAD_ENDPOINT = '/api/lead';

export type SubmitResult = { ok: boolean; reason?: string };

/**
 * `website` is the hidden honeypot field; real visitors leave it empty.
 * `turnstileToken` comes from the Cloudflare Turnstile widget and is checked by the server.
 */
export async function submitLead(payload: LeadPayload, honeypot = '', fetchImpl: typeof fetch = fetch, turnstileToken = ''): Promise<SubmitResult> {
  const res = await fetchImpl(LEAD_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ ...payload, website: honeypot, turnstile_token: turnstileToken }),
  });
  let body: { ok?: boolean; error?: string } = {};
  try { body = await res.json(); } catch { /* non-JSON answer counts as failure */ }
  return res.ok && body.ok === true ? { ok: true } : { ok: false, reason: body.error ?? `http_${res.status}` };
}
