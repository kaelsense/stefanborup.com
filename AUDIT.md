# Audit – stefanborup.com

**Dato:** 10. november 2026  
**Kilde:** https://stefanborup.com (live, lest uten endringer; ingen skjema er sendt inn)  
**Fremtidig domene:** https://stefanborup.com (uendret)  
**Oppdrag:** Ren migrering til Astro. Ingen visuelle endringer og ingen redesign.

## Kildeplattform

- **Lovable (gpt-engineer)**: en React-SPA bygd med Vite. All HTML lages i nettleseren (`/assets/index-DWKL-uYX.js`, `/assets/index-DBKj67Oc.css`). Serveren sender bare et tomt `<div id="root">`.
- **UI-bibliotek:** Tailwind (ferdig kompilert), shadcn/ui, Radix, react-day-picker v8 og lucide-ikoner. Metatagger settes med react-helmet.
- **CMS:** Supabase (prosjekt `yperyeivtjkrifbjnxnd`).
  - Innholdet ligger i tabellene `cms_published` (nøklene `site` og `galleries`) og `site_content`.
  - Bildene ligger i bucketen `cms-images`.
  - Innholdet er hentet ut via det offentlige REST-API-et med anon-nøkkel, kun lesing.
- **Admin:** `/admin/login` (e-post og passord via Supabase Auth). Herfra redigerer Stefan tekst, bilder og gallerier.
- **Hosting:** Lovable-hosting bak Cloudflare.
  - `www` sender 302 til apex.
  - `http://` gir 500 (bare https fungerer).
  - Det finnes ingen `sitemap.xml` (404).
  - `robots.txt` tillater alt.
- **Språk:** norsk, med noen danske formuleringer i innholdet (f.eks. «Kontakt mig i dag, og lad os tale om …»). Innholdet er beholdt som det er. Dokumentet har `lang="en"`, også det beholdt.

## Sider (7 offentlige sider + 404)

| URL | Tittel | Metabeskrivelse (Helmet) | H1 | Skjema |
|---|---|---|---|---|
| / | Stefan Borup \| Fotograf i Lillestrøm | Stefan Borup er en erfaren fotograf med base i Lillestrøm. Spesialiserer seg på portretter, produktbilder og arkitekturfotografi. | (ingen H1, første overskrift er H2 «Hvis bildene dine ikke selger for deg – hvem gjør det da?») | Ja, lead-/bestillingsskjema i #kontakt |
| /om-stefan | Om Stefan Borup \| Profesjonell Fotograf | Lær mer om Stefan Borup - en erfaren fotograf med lidenskap for arkitektur, portretter og produktfotografering. Over 15 års erfaring. | Om Stefan | Nei |
| /portefolje | Portefølje \| Stefan Borup Foto | Utforsk et utvalg av mine arbeider innen profesjonell fotografi - portretter, produktbilder og arkitekturfoto. | Portefølje | Nei (faner og lysboks) |
| /portretter | Portrett og Miljøbilder \| Stefan Borup Foto | Profesjonelle portretter og headshots som gjør inntrykk. Se ut som den du faktisk er – kompetent, trygg og til å stole på. | Portretter og Miljøbilder | Nei (lysboks) |
| /produktbilder | Produktbilder \| Stefan Borup Foto | Produktfotografi av høyeste kvalitet som fremhever dine produkter og selger. | Produktbilder | Nei (lysboks) |
| /arkitektur | Arkitekturfotografi \| Stefan Borup Foto | Profesjonell arkitekturfotografi som fanger bygningers essens og detaljer. Vakre bilder til veggen din i høyeste kvalitet. | Arkitektur | Nei (lysboks) |
| /bestilling | Bestilling \| Stefan Borup Fotograf | Bestill fotografering fra Stefan Borup. Portretter, produktbilder og arkitekturfotografi i Lillestrøm og omegn. | Bestilling | HubSpot-innbygging (virker ikke i dag, se under) |
| /admin/login | (standardtittel) | – | – | Admin-innlogging (e-post og passord). Migreres ikke. |
| alle andre stier | (standardtittel) | – | 404 | Nei |

- Ruten `/galleri/:slug` finnes for CMS-gallerier som ikke har sin egen side. I dag har den ingen gallerier. Astro-prosjektet støtter ruten, og nye gallerier i `src/content/galleries/` dukker opp der automatisk.
- **Lenker:** alle interne lenker er uten skråstrek på slutten (`/om-stefan`). Live svarer 200 både med og uten skråstrek.

## SEO og metadata

- **Live:** `index.html` har standardbeskrivelsen og to `og:image` (Lovable-plassholderen og `social-preview.webp` på storage.googleapis.com). Helmet legger til en sidespesifikk beskrivelse og tittel etter at JS har kjørt. Det finnes ingen canonical, ingen JSON-LD og ingen sitemap.
- **I Astro:**
  - Den sidespesifikke tittelen og beskrivelsen står direkte i HTML-en, så de er synlige uten JS.
  - Canonical og `og:url` er lagt til.
  - Det er bare én `og:image`, social-preview-bildet, nå lokalt. Lovable-plassholderen er fjernet.
  - `@astrojs/sitemap` lager `sitemap-index.xml` med de 7 URL-ene, og `robots.txt` peker til den.

## Ressurser

- **Bilder:** 23 unike bilder.
  - Fra Supabase Storage (`cms-images/published/...`, `cms-images/*.jpg`): hero, Om Stefan, gallerier og kundelogoer.
  - Fra Unsplash: 4 stockbilder (f.eks. tjenestekort og bak kulissene).
  - Social-preview: fra storage.googleapis.com.
  - Logo: et base64 data-URI inne i JS-en, hentet ut til `logo-stefan-borup.png`.
  - Favicon: `/favicon.png`.
  - Alt er lastet ned og ligger lokalt under `/images`.
- **Stort bilde:** `1772694029006.jpg` (Vikingbad, arkitektur) er 4,0 MB. Det er beholdt uendret for identisk utseende, men bør komprimeres senere.
- **Fonter:** CSS-en refererer til fontfamilier som aldri lastes (ingen @font-face eller Google Fonts). Nettleseren faller tilbake til systemfonter. *Oppdatert 12.11.2026:* Montserrat (brødtekst) og Playfair Display (overskrifter) lastes nå selvhostet via `@fontsource` i `Layout.astro`, slik CSS-en er ment.
- **CSS:** den originale kompilerte Tailwind-filen er gjenbrukt uendret, med originalt filnavn (`/assets/index-DBKj67Oc.css`).
- **Tredjepartsskript:**
  - Lovable/gpt-engineer analytics og badge (lovable.dev): fjernet.
  - Supabase-klient: fjernet, innholdet er nå statisk.
  - HubSpot Forms (js-eu1.hsforms.net) på /bestilling: beholdt.
  - Det finnes ingen cookie-banner, chat eller Google Analytics.
- **Interaktivitet:** alt som trengte React er skrevet om i ren TypeScript og testet i det bygde nettstedet:
  - hero-karusell (6 s) og kundeuttalelser (8 s)
  - løpende logostripe (ren CSS)
  - header som skifter ved scroll, «Tjenester»-nedtrekksmeny og mobilmeny
  - portefølje-faner
  - lysboks med tastatur og sveip
  - kalender, nedtrekksliste, avkrysningsbokser, validering og toast i skjemaet

## Skjema

1. **Lead-/bestillingsskjema på forsiden (#kontakt)** er et eget React-skjema.
   - **Felter:**
     - Dato (kalender, kun fremtidige dager) og ønsket klokkeslett (`time`, standard 09:00)
     - Fornavn* og Etternavn
     - E-post* og Telefon
     - Fotopakke (nedtrekksliste): Leilighet, Rekkehus/tomannsbolig, Enebolig, Fasadebilder
     - Tilleggstjenester (avkrysning): Kveldsfoto 7–10 bilder, Kveldsfoto hel bolig, Drone, Plantegning
     - Selgers navn, Oppdragsnummer, Selgers adresse, Selgers e-post og Selgers telefon
     - Spesielle ønsker (fritekst)
   - **Validering:** zod, med de samme norske feilmeldingene som før.
   - **Innsending før:** gikk til en Supabase Edge Function i Lovable-prosjektet. Den slutter å virke når siden flyttes.
   - **Innsending nå:** Vercel-funksjonen `api/lead.ts` validerer på nytt på serveren og sender én e-post via Resend, med svar-til satt til kunden. Se «Valgt løsning» under.
2. **/bestilling** har en HubSpot-innbygging (portal 143788873, region eu1). Embed-skriptet lastes, men HubSpot svarer 404 på selve skjemadefinisjonen, så skjemaet vises ikke. Det gjelder allerede live i dag. Innbyggingen er beholdt uendret, siden den virker uavhengig av plattform når HubSpot-skjemaet finnes.
3. **/admin/login** er CMS-innlogging og migreres ikke.

## Hva som slutter å virke ved migrering

- **CMS-redigering:** Supabase-adminen på /admin redigerer ikke lenger nettsiden. Innholdet ligger nå i `src/content/` (JSON) og endres i repoet, deretter bygges siden på nytt.
- **Lead-skjemaet:** den gamle Supabase-funksjonen forsvinner.
  - Erstattet av `api/lead.ts` (Vercel) og Resend.
  - Skjemaet virker først når miljøvariablene er satt og domenet er verifisert i Resend. Til da viser det «Noe gikk galt» og sender ingenting.
- **HubSpot-skjemaet** på /bestilling er allerede ødelagt live (404 fra HubSpot). Det må fikses i HubSpot eller fjernes.
- **Lovable analytics** er fjernet.
- **Redirects og hosting:**
  - `www` → apex: ordnet i `vercel.json` (308).
  - http → https: gjør Vercel automatisk.
  - Skråstrek på slutten: `vercel.json` sender `/om-stefan/` videre til `/om-stefan` med 308.
  - SSL og DNS flyttes ved lansering. Vercel lager SSL-sertifikatet selv.
- **Ikke endret, men verdt å vite:**
  - Fontene lastes ikke (rettet 12.11.2026, se Fonter over).
  - Fire bilder er Unsplash-stockbilder.
  - Vikingbad-bildet er på 4 MB.
  - Forsiden mangler H1.
  - Det er lysboks-bilder uten skjelett-animasjon (de vises direkte med full opasitet).

## Valgt løsning (Kay, 10. november 2026)

- **Hosting: Vercel.**
  - Siden er statisk, uten Astro-adapter. `vercel.json` setter Astro-preset, `dist/`, `cleanUrls`, `trailingSlash: false` og 308 fra `www` til apex.
  - http → https gjør Vercel automatisk.
  - Testet lokalt med `vercel build`: 8 statiske sider pluss funksjonen `api/lead`.
- **Skjemaløsning: Resend via Vercel-funksjonen `api/lead.ts`.**
  - Funksjonen validerer på nytt på serveren: fornavn og gyldig e-post er påkrevd, med samme lengdegrenser som skjemaet, kjente verdier for fotopakke og tjenester, og gyldige datoer.
  - Den har en skjult honeypot (`website`), godtar maks 20 KB og bare JSON med POST.
  - Den sender én e-post med alle felt, og svar-til er kundens e-post.
  - Feil returneres som JSON.
  - Nettleseren viser de samme meldingene som originalen.
- **Miljøvariabler** som Kay må sette i Vercel:
  - `RESEND_API_KEY`
  - `LEAD_TO_EMAIL` (mottaker, ikke satt)
  - `LEAD_FROM_EMAIL` (avsender på et domene som er verifisert i Resend)
- **Resend:** domenet `stefanborup.com` (eller et underdomene) må verifiseres. Det betyr SPF-, MX- og DKIM-poster i DNS, som ikke berører nettsiden.
- **Ikke gjort ennå:** ingen deploy, ingen DNS-endringer og ingen ekte e-post sendt.

## Verifisering

- **Speiling mot live:** alle undersider 0,00 % pikselavvik. Forsiden har 0,17 % på desktop og 0,10 % på mobil, og avviket skyldes hero-bildet som roterer.
- **Astro-bygget mot speilingen:** alle 16 skjermbilder (8 sider × desktop og mobil) ligger på 0,00–0,01 %.
- **Interaksjon testet i bygget:** nedtrekksmeny, scroll-header, mobilmeny, faner, lysboks (åpne, piltast, Esc), nedtrekksliste, avkrysning, kalender, valideringsfeil og innsending mot `/api/lead` med simulert svar (suksess-toast og tømt skjema ved OK, «Noe gikk galt» ved feil). Ingen nettverkskall gikk ut.
- **Tester:** 18 automatiske tester (`npm test`). De dekker validering, e-postformat og hele kjeden nettleser → funksjon → Resend, med Resend simulert.
