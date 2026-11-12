# stefanborup.com – Astro

This is a pure migration of https://stefanborup.com from Lovable (a React SPA with a Supabase CMS) to static Astro. It looks exactly like the original. Nothing was redesigned.

- **Hosting:** Vercel. The site is fully static (no Astro adapter). The one serverless function is `api/lead.ts`.
- **Form backend:** Resend. The function `api/lead.ts` sends the booking form from the home page as one email.

See `AUDIT.md` for the full audit of the old site (in Norwegian).

## Requirements

- Node 22.12 or newer (below 25; Vercel uses 24.x)
- npm
- Optional: the Vercel CLI (`npx vercel`) to run `vercel dev` / `vercel build` locally

## Commands

```sh
npm install
npm run dev       # http://localhost:4321
npm run build     # outputs to dist/
npm run preview
npm test          # unit tests: form validation, payload, calendar, api/lead.ts (Resend mocked)
```

## Structure

| Path | Contents |
|---|---|
| `src/layouts/Layout.astro` | `<head>` (title, description, canonical, OG and Twitter tags), header, footer and toaster |
| `src/components/` | Header, Footer, HeroCarousel, LogoStrip, Testimonials, ContactSection, GalleryGrid and GalleryPage |
| `src/pages/` | `index`, `om-stefan`, `portefolje`, `[gallery]` (`portretter`, `produktbilder`, `arkitektur`), `galleri/[slug]`, `bestilling` and `404` |
| `src/content/site.json` | All site text: hero, about, services, testimonials, logos, contact and footer. This was exported from the Supabase CMS. |
| `src/content/galleries/*.json` | One gallery per file. The slug is the file name. Add a file to create a new gallery: a reserved slug gets `/<slug>`, any other slug gets `/galleri/<slug>`. |
| `src/content.config.ts` | Content collection schemas (zod) |
| `src/scripts/` | Vanilla TS that replaces the React interactivity: lightbox, toast and the contact form |
| `src/lib/forms/` | Form validation, payload and the **backend seam** |
| `public/assets/index-DBKj67Oc.css` | The original compiled Tailwind CSS, under its original hashed name. It is unchanged, which is what keeps the look identical. Do not regenerate it. If you ever edit it, give it a new file name, because Vercel caches `/assets/*` as immutable for a year. |
| `api/lead.ts` | Vercel serverless function `POST /api/lead`: server-side validation, a honeypot check and one email through Resend |
| `vercel.json` | Vercel config: Astro preset, `dist/`, clean URLs, no trailing slash, `www` → apex |
| `public/images/` | All images, stored locally. They were previously hosted on Supabase Storage, Unsplash and Google Storage. |

## URLs

- The URLs are the same as on the live site, with no trailing slash: `/om-stefan`, `/portefolje`, `/portretter`, `/produktbilder`, `/arkitektur` and `/bestilling`.
- `astro.config.mjs` sets `trailingSlash: 'never'` and `build.format: 'file'`, so pages are emitted as `dist/om-stefan.html`. Vercel serves these without `.html` (`cleanUrls`).
- Vercel redirects the trailing-slash version (for example `/om-stefan/`) to the version without it with a 308 (`trailingSlash: false`).
- `@astrojs/sitemap` generates `sitemap-index.xml` for `https://stefanborup.com`, and `public/robots.txt` points to it.

## Form backend: Resend via `api/lead.ts`

The booking form on the home page (`#kontakt`) works like this:

1. The browser validates the form with the same rules and Norwegian messages as the original.
2. `src/lib/forms/backend.ts` POSTs JSON to `/api/lead`. This file is the only place in the browser code that knows the endpoint.
3. `api/lead.ts` checks the request again:
   - POST only, JSON only, body at most 20 KB.
   - First name and a valid email are required. Text length limits match the client.
   - Photo package and extra services must be known values. Dates must be valid ISO dates.
   - Hidden honeypot field `website`: if it is filled, the function answers `{ ok: true }` and sends nothing.
4. The function sends **one** email through the Resend REST API:
   - Contact, assignment, seller and message sections, as text and HTML, with all input HTML-escaped.
   - Subject: `Ny forespørsel fra stefanborup.com – <navn>`.
   - `reply_to` is the visitor's email, so Stefan can answer directly.
5. The visitor sees the same toasts as on the original site:
   - "Takk for din henvendelse!" when sending works.
   - "Noe gikk galt" for any error.

The function always answers with JSON:

| Status | Body | When |
|---|---|---|
| 200 | `{ ok: true }` | Sent, or the honeypot was filled |
| 400 | `{ ok: false, error: 'invalid_json' }` | Body is not valid JSON |
| 405 | `{ ok: false, error: 'method_not_allowed' }` | Anything but POST |
| 413 | `{ ok: false, error: 'payload_too_large' }` | Body over 20 KB |
| 415 | `{ ok: false, error: 'unsupported_media_type' }` | Not JSON |
| 422 | `{ ok: false, error: 'validation_failed', fields }` | A field failed validation |
| 403 | `{ ok: false, error: 'captcha_failed' }` | Turnstile is on and the token is missing or rejected by Cloudflare |
| 500 | `{ ok: false, error: 'not_configured' }` | An env var is missing |
| 502 | `{ ok: false, error: 'email_failed' }` | Resend refused the email or could not be reached |

Spam protection: the honeypot plus Cloudflare Turnstile (below). For more, add Vercel Firewall rate limiting on `/api/lead`.

### Cloudflare Turnstile

The booking form shows a Turnstile widget (dark theme, full width) above the submit button. The browser sends its token as `turnstile_token`, and `api/lead.ts` checks it with Cloudflare's `siteverify` before any email is sent. Tokens are single use, so the widget resets after every attempt.

- `PUBLIC_TURNSTILE_SITE_KEY` is read **at build time**. Without it the widget and script are left out of the page. After setting or changing it, redeploy.
- `TURNSTILE_SECRET_KEY` turns on the server check. Without it the check is skipped and a warning is logged.
- Set both, or neither. A secret without a site key rejects every submission with 403.
- In Cloudflare, the widget's hostnames must include `stefanborup.com` (and the `*.vercel.app` preview host if previews should work).

### Environment variables

Set these in Vercel → Project → Settings → Environment Variables, for Production and Preview. The repo contains no values; `.env.example` lists only the names.

| Variable | Example of the format | Notes |
|---|---|---|
| `RESEND_API_KEY` | `re_…` | Resend → API Keys. Create a key with "Sending access" only, ideally limited to the verified domain. |
| `LEAD_TO_EMAIL` | `navn@domene.no` | Who receives the leads. To send to several people, separate the addresses with commas. Kay decides the address. |
| `LEAD_FROM_EMAIL` | `Stefan Borup nettside <skjema@stefanborup.com>` | Must be on a domain verified in Resend. |
| `PUBLIC_TURNSTILE_SITE_KEY` | `0x4AAAAAAA…` | Cloudflare → Turnstile → widget → Site Key. Public, used at build time. |
| `TURNSTILE_SECRET_KEY` | `0x4AAAAAAA…` | Cloudflare → Turnstile → widget → Secret Key. Server only. |

Without the first three, the function answers 500 `not_configured` and the visitor sees "Noe gikk galt". Nothing is sent.

### Resend domain verification

1. In Resend → Domains, add `stefanborup.com`. A subdomain such as `send.stefanborup.com` also works, and then the `from` address must use it.
2. Resend shows DNS records: an SPF `TXT` and an `MX` on the `send` subdomain, plus a DKIM `TXT` record (`resend._domainkey`). Add them at the DNS host for stefanborup.com. They don't touch the website records or the existing email for the domain.
3. Optionally add a DMARC record (`_dmarc` TXT, for example `v=DMARC1; p=none;`) if the domain doesn't have one already.
4. Wait until Resend shows the domain as **Verified**. Then set `LEAD_FROM_EMAIL` to an address on that domain.

### Testing the form

- Run `npm test`. It covers validation, email formatting and the whole browser → function → Resend path, with Resend mocked. No real email is sent.
- `npm run dev` / `astro dev` does **not** serve `/api/lead`. On localhost the form shows "Noe gikk galt".
- To run the function locally, use `vercel dev` with a `.env.local` file.
- Test on a Vercel preview deployment with real env vars before launch.

## Hosting: Vercel

`vercel.json` sets:

- `framework: "astro"`, `buildCommand: "npm run build"`, `outputDirectory: "dist"`. The site is static and no adapter is used.
- `cleanUrls: true`, so `dist/om-stefan.html` is served at `/om-stefan`, and `/om-stefan.html` redirects there.
- `trailingSlash: false`, so `/om-stefan/` gets a 308 redirect to `/om-stefan`, the same URLs as the live site.
- A permanent redirect (308) from `www.stefanborup.com/*` to `https://stefanborup.com/*`.
- Root `api/*.ts` files are deployed as Vercel Functions next to the static site. `maxDuration` is 10 s.
- `404.html` is served for unknown paths.
- **http → https:** Vercel does this by default on every domain. Nothing needs configuring.
- **Node:** `engines` is `>=22.12.0 <25`, so Vercel builds with Node 24.x.

The setup was checked with `vercel build` locally. The output had the 8 static pages plus `functions/api/lead.func`, the redirects above, and the compiled function smoke-tested with a mocked Resend.

### Deploy steps

1. Push the repo to GitHub, or use `vercel` from the CLI, and import it as a new Vercel project. The framework preset is detected as Astro, and `vercel.json` sets the rest.
2. Set the three env vars above for Production and Preview.
3. Verify the domain in Resend (above).
4. Deploy a preview. On the preview URL:
   - Click through every page.
   - Check that `/om-stefan/` redirects to `/om-stefan`.
   - Send one test lead to the agreed recipient, and check that it arrives and that reply-to is the visitor.
5. In Vercel → Domains, add `stefanborup.com` and `www.stefanborup.com`, with `www` redirecting to apex.
6. Launch: change the DNS to Vercel's records (apex `A` / `www` `CNAME`, as Vercel shows them). The old site is on Lovable behind Cloudflare; turn it off only after the new one is verified.
7. Check that SSL is active, that `http://` redirects to `https://`, and that `www` redirects to apex.
8. Submit `https://stefanborup.com/sitemap-index.xml` in Google Search Console.

## Editing content

The Supabase admin (`/admin`) no longer controls the site. To change content:

1. Edit `src/content/site.json` or `src/content/galleries/*.json`.
2. Put new images in `public/images/`.
3. Commit and push. Vercel rebuilds and redeploys.

The HubSpot embed on `/bestilling` (portal `143788873`, form `2fca001b-…`) is kept as it was and does not use `/api/lead`. The HubSpot form currently returns 404, both live and here, so it needs fixing or removing in HubSpot.
