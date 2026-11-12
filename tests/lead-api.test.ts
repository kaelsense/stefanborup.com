import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleLead, validateLeadPayload, formatLeadEmail, PHOTO_PACKAGE_LABELS, SERVICE_LABELS, MAX_BODY_BYTES, TURNSTILE_VERIFY_URL, type Env } from '../api/lead.ts';
import { buildLeadPayload, emptyLeadForm, PHOTO_PACKAGES, ADDITIONAL_SERVICES } from '../src/lib/forms/lead.ts';
import { submitLead } from '../src/lib/forms/backend.ts';

const ENV: Env = { RESEND_API_KEY: 're_test', LEAD_TO_EMAIL: 'mottaker@example.test', LEAD_FROM_EMAIL: 'Nettside <skjema@example.test>' };

/** A payload exactly as the browser builds it. */
const fullPayload = () => buildLeadPayload({
  ...emptyLeadForm(),
  firstName: 'Ola', lastName: 'Nordmann', email: 'ola@example.no', phone: '12345678',
  photoPackage: 'enebolig', additionalServices: ['drone', 'kveldsfoto_hel'],
  sellerName: 'Kari Selger', sellerAddress: 'Storgata 1, 2000 Lillestrøm', sellerEmail: 'kari@example.no', sellerPhone: '87654321',
  assignmentNumber: 'A-123', message: 'Ring før du kommer.\n<b>Takk</b>',
}, new Date(2026, 10, 11), '14:30');

type Call = { url: string; init: RequestInit };
const mockFetch = (status = 200) => {
  const calls: Call[] = [];
  const fn = (async (url: string, init: RequestInit) => { calls.push({ url, init }); return new Response(JSON.stringify({ id: 'email_1' }), { status }); }) as unknown as typeof fetch;
  return { fn, calls };
};
const req = (body: unknown, headers: Record<string, string> = {}, method = 'POST') =>
  new Request('https://stefanborup.com/api/lead', { method, headers: { 'content-type': 'application/json', ...headers }, body: method === 'GET' ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
const silent = () => {};

test('server lists match the form lists (labels and values)', () => {
  assert.deepEqual(PHOTO_PACKAGES.map((p) => [p.value, p.label]), Object.entries(PHOTO_PACKAGE_LABELS));
  assert.deepEqual(ADDITIONAL_SERVICES.map((s) => [s.id, s.label]), Object.entries(SERVICE_LABELS));
});

test('validation: first name and email are required, like the client', () => {
  const r = validateLeadPayload({ first_name: '  ', email: 'nope' });
  assert.equal(r.ok, false);
  if (!r.ok) assert.deepEqual(Object.keys(r.errors).sort(), ['email', 'first_name']);
  assert.equal(validateLeadPayload({ first_name: 'Ola', email: 'ola@example.no' }).ok, true);
});

test('validation: types, enums, dates and length limits', () => {
  const base = { first_name: 'Ola', email: 'ola@example.no' };
  const bad = validateLeadPayload({
    ...base, phone: '1'.repeat(21), message: 'm'.repeat(2001), photo_package: 'slott', additional_services: ['drone', 'hacking'],
    floor_plan: 'yes', preferred_date: '11.11.2026', photo_datetime: '2026-11-11 14:30', seller_email: 'x@', last_name: 42,
  });
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.deepEqual(Object.keys(bad.errors).sort(),
    ['additional_services', 'floor_plan', 'last_name', 'message', 'phone', 'photo_datetime', 'photo_package', 'preferred_date', 'seller_email']);
  assert.equal(validateLeadPayload([]).ok, false);
  assert.equal(validateLeadPayload(null).ok, false);
});

test('validation: the real browser payload passes and is normalised', () => {
  const r = validateLeadPayload(fullPayload());
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.lead.name, 'Ola Nordmann');
    assert.equal(r.lead.preferred_date, '2026-11-11');
    assert.equal(r.lead.photo_datetime, '2026-11-11T14:30:00');
    assert.deepEqual(r.lead.additional_services, ['drone', 'kveldsfoto_hel']);
  }
});

test('email formatting: all fields, Norwegian labels, HTML escaped', () => {
  const r = validateLeadPayload(fullPayload());
  assert.ok(r.ok);
  const { subject, text, html } = formatLeadEmail(r.lead);
  assert.equal(subject, 'Ny forespørsel fra stefanborup.com – Ola Nordmann');
  for (const s of ['Navn: Ola Nordmann', 'E-post: ola@example.no', 'Telefon: 12345678', 'Ønsket dato: onsdag 11. november 2026',
    'Ønsket klokkeslett: 14:30', 'Fotopakke: Enebolig', 'Tilleggstjenester: Drone, Kveldsfoto hel bolig', 'Selgers navn: Kari Selger',
    'Oppdragsnummer: A-123', 'Adresse for fotografering: Storgata 1, 2000 Lillestrøm', 'Selgers e-post: kari@example.no', 'Selgers telefon: 87654321',
    'Ring før du kommer.']) assert.ok(text.includes(s), `text missing: ${s}`);
  assert.ok(html.includes('&lt;b&gt;Takk&lt;/b&gt;'));
  assert.ok(!html.includes('<b>Takk</b>'));
  const minimal = validateLeadPayload({ first_name: 'Ola', email: 'ola@example.no' });
  assert.ok(minimal.ok);
  assert.ok(formatLeadEmail(minimal.lead).text.includes('Telefon: –'));
});

test('subject cannot carry line breaks', () => {
  const r = validateLeadPayload({ first_name: 'Ola\r\nBcc: x@example.test', email: 'ola@example.no' });
  assert.ok(r.ok);
  assert.ok(!/[\r\n]/.test(formatLeadEmail(r.lead).subject));
});

test('handler: valid lead sends one Resend email with reply-to the visitor', async () => {
  const m = mockFetch();
  const res = await handleLead(req({ ...fullPayload(), website: '' }), { env: { ...ENV, LEAD_TO_EMAIL: 'a@example.test, b@example.test' }, fetch: m.fn, log: silent });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
  assert.equal(m.calls.length, 1);
  assert.equal(m.calls[0].url, 'https://api.resend.com/emails');
  assert.equal((m.calls[0].init.headers as Record<string, string>).authorization, 'Bearer re_test');
  const sent = JSON.parse(String(m.calls[0].init.body));
  assert.deepEqual(sent.to, ['a@example.test', 'b@example.test']);
  assert.equal(sent.from, ENV.LEAD_FROM_EMAIL);
  assert.equal(sent.reply_to, 'ola@example.no');
  assert.ok(sent.subject.includes('Ola Nordmann'));
  assert.ok(sent.text && sent.html);
});

test('handler: honeypot filled answers ok but sends nothing', async () => {
  const m = mockFetch();
  const res = await handleLead(req({ ...fullPayload(), website: 'http://spam.example' }), { env: ENV, fetch: m.fn, log: silent });
  assert.equal(res.status, 200);
  assert.equal(m.calls.length, 0);
});

test('handler: JSON errors for bad requests, never calls Resend', async () => {
  const m = mockFetch();
  const deps = { env: ENV, fetch: m.fn, log: silent };
  const cases: [Request, number, string][] = [
    [req(null, {}, 'GET'), 405, 'method_not_allowed'],
    [req('{}', { 'content-type': 'text/plain' }), 415, 'unsupported_media_type'],
    [req('{not json'), 400, 'invalid_json'],
    [req({ first_name: 'Ola', email: 'ola@example.no', message: 'x'.repeat(MAX_BODY_BYTES) }), 413, 'payload_too_large'],
    [req({ first_name: '', email: 'bad' }), 422, 'validation_failed'],
  ];
  for (const [r, status, error] of cases) {
    const res = await handleLead(r, deps);
    assert.equal(res.status, status, error);
    assert.match(res.headers.get('content-type') ?? '', /application\/json/);
    const body = await res.json();
    assert.equal(body.ok, false);
    assert.equal(body.error, error);
  }
  assert.equal(m.calls.length, 0);
});

test('handler: missing env vars -> 500 not_configured; Resend failure -> 502', async () => {
  const valid = () => req(fullPayload());
  for (const env of [{}, { ...ENV, RESEND_API_KEY: '' }, { ...ENV, LEAD_TO_EMAIL: ' , ' }, { ...ENV, LEAD_FROM_EMAIL: undefined }]) {
    const m = mockFetch();
    const res = await handleLead(valid(), { env, fetch: m.fn, log: silent });
    assert.equal(res.status, 500);
    assert.equal((await res.json()).error, 'not_configured');
    assert.equal(m.calls.length, 0);
  }
  const failing = mockFetch(403);
  const res = await handleLead(valid(), { env: ENV, fetch: failing.fn, log: silent });
  assert.equal(res.status, 502);
  assert.equal((await res.json()).error, 'email_failed');
  const throwing = (async () => { throw new Error('network'); }) as unknown as typeof fetch;
  assert.equal((await handleLead(valid(), { env: ENV, fetch: throwing, log: silent })).status, 502);
});

test('browser seam: posts JSON to /api/lead and maps the answer to ok', async () => {
  const seen: Call[] = [];
  const answer = (status: number, body: unknown) => (async (url: string, init: RequestInit) => { seen.push({ url, init }); return new Response(JSON.stringify(body), { status }); }) as unknown as typeof fetch;
  assert.deepEqual(await submitLead(fullPayload(), '', answer(200, { ok: true })), { ok: true });
  assert.equal(seen[0].url, '/api/lead');
  assert.equal(seen[0].init.method, 'POST');
  const body = JSON.parse(String(seen[0].init.body));
  assert.equal(body.first_name, 'Ola');
  assert.equal(body.website, '');
  assert.deepEqual(await submitLead(fullPayload(), '', answer(502, { ok: false, error: 'email_failed' })), { ok: false, reason: 'email_failed' });
  const notJson = (async () => new Response('<html>', { status: 404 })) as unknown as typeof fetch;
  assert.deepEqual(await submitLead(fullPayload(), '', notJson), { ok: false, reason: 'http_404' });
});

test('end to end: browser seam -> handler -> mocked Resend', async () => {
  const resend = mockFetch();
  const viaHandler = (async (url: string, init: RequestInit) =>
    handleLead(new Request(`https://stefanborup.com${url}`, init), { env: ENV, fetch: resend.fn, log: silent })) as unknown as typeof fetch;
  assert.deepEqual(await submitLead(fullPayload(), '', viaHandler), { ok: true });
  assert.equal(resend.calls.length, 1);
});

// ---- Cloudflare Turnstile ---------------------------------------------
const TS_ENV: Env = { ...ENV, TURNSTILE_SECRET_KEY: '0x4AAA-secret' };
/** Mocks both Cloudflare siteverify and Resend; `verdict` is what siteverify answers. */
const mockBoth = (verdict: unknown | Error) => {
  const calls: Call[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    if (url === TURNSTILE_VERIFY_URL) {
      if (verdict instanceof Error) throw verdict;
      return new Response(JSON.stringify(verdict), { status: 200 });
    }
    return new Response(JSON.stringify({ id: 'email_1' }), { status: 200 });
  }) as unknown as typeof fetch;
  return { fn, calls };
};

test('turnstile: valid token is verified with secret, token and visitor IP, then the email is sent', async () => {
  const m = mockBoth({ success: true });
  const res = await handleLead(req({ ...fullPayload(), turnstile_token: 'tok-1' }, { 'x-forwarded-for': '203.0.113.7, 10.0.0.1' }), { env: TS_ENV, fetch: m.fn, log: silent });
  assert.equal(res.status, 200);
  assert.equal(m.calls.length, 2);
  assert.equal(m.calls[0].url, TURNSTILE_VERIFY_URL);
  const sent = m.calls[0].init.body as URLSearchParams;
  assert.equal(sent.get('secret'), '0x4AAA-secret');
  assert.equal(sent.get('response'), 'tok-1');
  assert.equal(sent.get('remoteip'), '203.0.113.7');
  assert.equal(m.calls[1].url, 'https://api.resend.com/emails');
});

test('turnstile: missing, rejected or unverifiable token -> 403 captcha_failed and no email', async () => {
  const cases: [unknown, unknown][] = [
    [undefined, { success: true }],
    ['', { success: true }],
    [42, { success: true }],
    ['tok', { success: false, 'error-codes': ['invalid-input-response'] }],
    ['tok', new Error('network')],
  ];
  for (const [token, verdict] of cases) {
    const m = mockBoth(verdict);
    const res = await handleLead(req({ ...fullPayload(), turnstile_token: token }), { env: TS_ENV, fetch: m.fn, log: silent });
    assert.equal(res.status, 403);
    assert.equal((await res.json()).error, 'captcha_failed');
    assert.ok(m.calls.every((c) => c.url !== 'https://api.resend.com/emails'));
  }
});

test('turnstile: without TURNSTILE_SECRET_KEY the check is skipped (and logged)', async () => {
  const m = mockFetch();
  const logs: string[] = [];
  const res = await handleLead(req(fullPayload()), { env: ENV, fetch: m.fn, log: (msg) => logs.push(msg) });
  assert.equal(res.status, 200);
  assert.equal(m.calls.length, 1);
  assert.ok(logs.some((l) => l.includes('TURNSTILE_SECRET_KEY')));
});

test('turnstile: honeypot still short-circuits before Cloudflare is asked', async () => {
  const m = mockBoth({ success: true });
  const res = await handleLead(req({ ...fullPayload(), website: 'spam', turnstile_token: 'tok' }), { env: TS_ENV, fetch: m.fn, log: silent });
  assert.equal(res.status, 200);
  assert.equal(m.calls.length, 0);
});

test('browser seam: sends the Turnstile token as turnstile_token', async () => {
  let body: Record<string, unknown> = {};
  const capture = (async (_url: string, init: RequestInit) => { body = JSON.parse(String(init.body)); return new Response('{"ok":true}', { status: 200 }); }) as unknown as typeof fetch;
  await submitLead(fullPayload(), '', capture, 'tok-xyz');
  assert.equal(body.turnstile_token, 'tok-xyz');
});
