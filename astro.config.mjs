// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import { copyFile } from 'node:fs/promises';

// @astrojs/sitemap only writes sitemap-index.xml + sitemap-0.xml. The site has
// well under 45 000 URLs, so sitemap-0.xml holds every URL; publish it as
// /sitemap.xml too, which is where crawlers and robots.txt look.
/** @returns {import('astro').AstroIntegration} */
const sitemapXml = () => ({
  name: 'sitemap-xml',
  hooks: {
    'astro:build:done': async ({ dir, logger }) => {
      await copyFile(new URL('sitemap-0.xml', dir), new URL('sitemap.xml', dir));
      logger.info('`sitemap.xml` created at `dist`');
    },
  },
});

// URLs on the live site have no trailing slash (/om-stefan), so pages are
// emitted as flat files (om-stefan.html) and links/sitemap stay slash-less.
export default defineConfig({
  site: 'https://stefanborup.com',
  trailingSlash: 'never',
  build: { format: 'file' },
  // Must run after sitemap() so sitemap-0.xml exists. /admin is excluded;
  // API routes (api/*.ts) are Vercel functions and never reach the sitemap.
  integrations: [sitemap({ filter: (page) => !page.includes('/admin') }), sitemapXml()],
});
