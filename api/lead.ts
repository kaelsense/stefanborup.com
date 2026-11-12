// Vercel serverless function: POST /api/lead
//
// Receives the booking form from the front page (#kontakt), validates it again
// on the server and sends ONE email through Resend (https://resend.com) with
// reply-to set to the visitor. Replaces the old Supabase Edge Function the Lovable site posted to.
//
// Env vars (set in Vercel, never in the repo):
//   RESEND_API_KEY   Resend API key (re_...)
//   LEAD_TO_EMAIL    Who receives leads; several addresses may be comma-separated
//   LEAD_FROM_EMAIL  Sender on a domain verified in Resend, e.g. "Nettside <...>"
//   TURNSTILE_SECRET_KEY  Cloudflare Turnstile secret key. When set, every lead
//                    must carry a valid Turnstile token (field `turnstile_token`).
//                    When missing, the check is skipped and a warning is logged.
//
// Self-contained on purpose (no local imports), so Vercel bundles it as is.

export const MAX_BODY_BYTES = 20_000;

export const PHOTO_PACKAGE_LABELS: Record<string, string> = {
  leilighet: 'Leilighet',
  rekkehus: 'Rekkehus/tomannsbolig',
  enebolig: 'Enebolig',
  fasadebilder: 'Fasadebilder',
};

export const SERVICE_LABELS: Record<string, string> = {
  kveldsfoto_7_10: 'Kveldsfoto 7-10 bilder',
  kveldsfoto_hel: 'Kveldsfoto hel bolig',
  drone: 'Drone',
  plantegning: 'Plantegning',
};

/** Hidden field in the form. People never fill it; simple bots do. */
export const HONEYPOT_FIELD = 'website';

/** Field carrying the Cloudflare Turnstile token from the widget. */
export const TURNSTILE_FIELD = 'turnstile_token';
export const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

const EMAIL = /^(?!\.)(?!.*\.\.)([A-Z0-9_'+\-.]*)[A-Z0-9_+-]@([A-Z0-9][A-Z0-9-]*\.)+[A-Z]{2,}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;

export type Lead = {
  name: string;
  first_name: string;
  last_name: string | null;
  email: string;
  phone: string | null;
  photo_package: string | null;
  additional_services: string[] | null;
  floor_plan: boolean;
  seller_name: string | null;
  seller_address: string | null;
  seller_email: string | null;
  seller_phone: string | null;
  assignment_number: string | null;
  message: string | null;
  preferred_date: string | null;
  photo_datetime: string | null;
};

// Same length limits as the client form (src/lib/forms/lead.ts).
const TEXT_LIMITS = {
  first_name: 100, last_name: 100, email: 255, phone: 20, seller_name: 200, seller_address: 300,
  seller_email: 255, seller_phone: 20, assignment_number: 50, message: 2000,
} as const;

export type ValidationResult = { ok: true; lead: Lead } | { ok: false; errors: Record<string, string> };

export function validateLeadPayload(input: unknown): ValidationResult {
  const errors: Record<string, string> = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, errors: { body: 'Expected a JSON object' } };
  const raw = input as Record<string, unknown>;

  const text = (key: keyof typeof TEXT_LIMITS): string | null => {
    const v = raw[key];
    if (v === undefined || v === null) return null;
    if (typeof v !== 'string') { errors[key] = 'Must be a string'; return null; }
    const t = v.trim();
    if (t.length > TEXT_LIMITS[key]) errors[key] = `Max ${TEXT_LIMITS[key]} characters`;
    return t === '' ? null : t;
  };

  const first_name = text('first_name');
  if (!first_name && !errors.first_name) errors.first_name = 'Required';
  const last_name = text('last_name');
  const email = text('email');
  if (!errors.email && (!email || !EMAIL.test(email))) errors.email = 'Invalid email';
  const seller_email = text('seller_email');
  if (seller_email && !errors.seller_email && !EMAIL.test(seller_email)) errors.seller_email = 'Invalid email';

  let photo_package: string | null = null;
  if (raw.photo_package !== undefined && raw.photo_package !== null && raw.photo_package !== '') {
    if (typeof raw.photo_package === 'string' && raw.photo_package in PHOTO_PACKAGE_LABELS) photo_package = raw.photo_package;
    else errors.photo_package = 'Unknown photo package';
  }

  let additional_services: string[] | null = null;
  if (raw.additional_services !== undefined && raw.additional_services !== null) {
    const v = raw.additional_services;
    if (!Array.isArray(v) || v.length > Object.keys(SERVICE_LABELS).length || !v.every((s) => typeof s === 'string' && s in SERVICE_LABELS)) {
      errors.additional_services = 'Unknown service';
    } else if (v.length) additional_services = [...new Set(v as string[])];
  }

  let floor_plan = false;
  if (raw.floor_plan !== undefined && raw.floor_plan !== null) {
    if (typeof raw.floor_plan === 'boolean') floor_plan = raw.floor_plan;
    else errors.floor_plan = 'Must be a boolean';
  }

  const dateField = (key: 'preferred_date' | 'photo_datetime', re: RegExp): string | null => {
    const v = raw[key];
    if (v === undefined || v === null || v === '') return null;
    if (typeof v !== 'string' || !re.test(v) || Number.isNaN(Date.parse(v.length === 10 ? `${v}T00:00:00Z` : `${v}Z`))) {
      errors[key] = 'Invalid date';
      return null;
    }
    return v;
  };
  const preferred_date = dateField('preferred_date', DATE);
  const photo_datetime = dateField('photo_datetime', DATETIME);

  const lead: Lead = {
    name: `${first_name ?? ''} ${last_name ?? ''}`.trim(),
    first_name: first_name ?? '',
    last_name,
    email: email ?? '',
    phone: text('phone'),
    photo_package,
    additional_services,
    floor_plan,
    seller_name: text('seller_name'),
    seller_address: text('seller_address'),
    seller_email,
    seller_phone: text('seller_phone'),
    assignment_number: text('assignment_number'),
    message: text('message'),
    preferred_date,
    photo_datetime,
  };
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, lead };
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
// Keeps header-like values (subject) on one line.
const oneLine = (s: string) => s.replace(/[\r\n]+/g, ' ').trim();

export function formatDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.toLocaleDateString('nb-NO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

export function formatLeadEmail(lead: Lead): { subject: string; text: string; html: string } {
  const time = lead.photo_datetime ? lead.photo_datetime.slice(11, 16) : null;
  const sections: [string, [string, string | null][]][] = [
    ['Kontakt', [
      ['Navn', lead.name],
      ['E-post', lead.email],
      ['Telefon', lead.phone],
    ]],
    ['Oppdrag', [
      ['Ønsket dato', lead.preferred_date ? formatDate(lead.preferred_date) : null],
      ['Ønsket klokkeslett', lead.preferred_date ? time : null],
      ['Fotopakke', lead.photo_package ? PHOTO_PACKAGE_LABELS[lead.photo_package] : null],
      ['Tilleggstjenester', lead.additional_services?.map((s) => SERVICE_LABELS[s]).join(', ') ?? null],
      ['Plantegning', lead.floor_plan ? 'Ja' : null],
    ]],
    ['Selger', [
      ['Selgers navn', lead.seller_name],
      ['Oppdragsnummer', lead.assignment_number],
      ['Selgers adresse', lead.seller_address],
      ['Selgers e-post', lead.seller_email],
      ['Selgers telefon', lead.seller_phone],
    ]],
    ['Spesielle ønsker eller kommentarer', [['', lead.message]]],
  ];
  const dash = '–';
  const subject = oneLine(`Ny forespørsel fra stefanborup.com ${dash} ${lead.name}`);

  const text = [
    'Ny forespørsel fra kontaktskjemaet på stefanborup.com',
    '',
    ...sections.flatMap(([title, rows]) => [
      title.toUpperCase(),
      ...rows.map(([k, v]) => (k ? `${k}: ${v ?? dash}` : v ?? dash)),
      '',
    ]),
    'Svar på denne e-posten for å svare kunden direkte.',
  ].join('\n');

  const td = 'padding:4px 12px 4px 0;vertical-align:top;';
  const html = `<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#111;line-height:1.5">`
    + `<h2 style="margin:0 0 16px">Ny forespørsel fra stefanborup.com</h2>`
    + sections.map(([title, rows]) => `<h3 style="margin:20px 0 6px;font-size:15px">${esc(title)}</h3>`
      + (rows.length === 1 && rows[0][0] === ''
        ? `<p style="margin:0;white-space:pre-wrap">${esc(rows[0][1] ?? dash)}</p>`
        : `<table cellpadding="0" cellspacing="0">${rows.map(([k, v]) => `<tr><td style="${td}color:#555">${esc(k)}</td><td style="${td}">${v ? esc(v).replace(/\n/g, '<br>') : dash}</td></tr>`).join('')}</table>`)).join('')
    + `<p style="margin-top:24px;color:#555">Svar på denne e-posten for å svare kunden direkte.</p></body></html>`;
  return { subject, text, html };
}

export type Env = { RESEND_API_KEY?: string; LEAD_TO_EMAIL?: string; LEAD_FROM_EMAIL?: string; TURNSTILE_SECRET_KEY?: string };
type Deps = { env: Env; fetch: typeof fetch; log?: (msg: string, extra?: unknown) => void };

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

/** Visitor IP as Vercel reports it; passed to Turnstile as an extra signal. */
const clientIp = (request: Request): string | null =>
  request.headers.get('x-real-ip') ?? request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;

/**
 * Asks Cloudflare whether the Turnstile token is valid. Tokens are single use
 * and expire after 5 minutes. Any network or parse error counts as "not valid".
 */
export async function verifyTurnstile(token: string, secret: string, ip: string | null, fetchImpl: typeof fetch): Promise<{ ok: boolean; codes: string[] }> {
  const form = new URLSearchParams({ secret, response: token });
  if (ip) form.set('remoteip', ip);
  try {
    const res = await fetchImpl(TURNSTILE_VERIFY_URL, { method: 'POST', body: form });
    const data = (await res.json()) as { success?: boolean; 'error-codes'?: string[] };
    return { ok: data.success === true, codes: data['error-codes'] ?? [] };
  } catch (err) {
    return { ok: false, codes: ['request_failed', String(err)] };
  }
}

export async function handleLead(request: Request, deps: Deps): Promise<Response> {
  const log = deps.log ?? ((m: string, e?: unknown) => console.error(m, e ?? ''));
  if (request.method !== 'POST') return new Response(JSON.stringify({ ok: false, error: 'method_not_allowed' }), { status: 405, headers: { allow: 'POST', 'content-type': 'application/json; charset=utf-8' } });
  if (!(request.headers.get('content-type') ?? '').toLowerCase().includes('application/json')) return json(415, { ok: false, error: 'unsupported_media_type' });
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > MAX_BODY_BYTES) return json(413, { ok: false, error: 'payload_too_large' });

  const raw = await request.text();
  if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) return json(413, { ok: false, error: 'payload_too_large' });
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return json(400, { ok: false, error: 'invalid_json' }); }

  // Honeypot filled: pretend success so the bot learns nothing, send nothing.
  if (body && typeof body === 'object' && typeof (body as Record<string, unknown>)[HONEYPOT_FIELD] === 'string' && ((body as Record<string, string>)[HONEYPOT_FIELD]).trim() !== '') {
    return json(200, { ok: true });
  }

  const result = validateLeadPayload(body);
  if ('errors' in result) return json(422, { ok: false, error: 'validation_failed', fields: result.errors });

  const { RESEND_API_KEY, LEAD_TO_EMAIL, LEAD_FROM_EMAIL, TURNSTILE_SECRET_KEY } = deps.env;
  if (TURNSTILE_SECRET_KEY) {
    const token = (body as Record<string, unknown>)[TURNSTILE_FIELD];
    if (typeof token !== 'string' || token.length === 0 || token.length > 2048) return json(403, { ok: false, error: 'captcha_failed' });
    const check = await verifyTurnstile(token, TURNSTILE_SECRET_KEY, clientIp(request), deps.fetch);
    if (!check.ok) {
      log('[lead] Turnstile rejected the token', check.codes);
      return json(403, { ok: false, error: 'captcha_failed' });
    }
  } else {
    log('[lead] TURNSTILE_SECRET_KEY not set, skipping the Turnstile check');
  }

  const to = (LEAD_TO_EMAIL ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!RESEND_API_KEY || !LEAD_FROM_EMAIL || !to.length) {
    log('[lead] Missing RESEND_API_KEY, LEAD_TO_EMAIL or LEAD_FROM_EMAIL');
    return json(500, { ok: false, error: 'not_configured' });
  }

  const { subject, text, html } = formatLeadEmail(result.lead);
  let res: Response;
  try {
    res = await deps.fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${RESEND_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: LEAD_FROM_EMAIL, to, reply_to: result.lead.email, subject, text, html }),
    });
  } catch (err) {
    log('[lead] Resend request failed', err);
    return json(502, { ok: false, error: 'email_failed' });
  }
  if (!res.ok) {
    log(`[lead] Resend answered ${res.status}`, await res.text().catch(() => ''));
    return json(502, { ok: false, error: 'email_failed' });
  }
  return json(200, { ok: true });
}

// Vercel entry points (Web-standard Request/Response handlers).
// Read through globalThis so the file type-checks without @types/node.
const env = () => (globalThis as unknown as { process: { env: Env } }).process.env;
const live = (request: Request) => handleLead(request, { env: env(), fetch: globalThis.fetch });
export const POST = live;
export const GET = live;
