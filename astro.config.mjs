// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// URLs on the live site have no trailing slash (/om-stefan), so pages are
// emitted as flat files (om-stefan.html) and links/sitemap stay slash-less.
export default defineConfig({
  site: 'https://stefanborup.com',
  trailingSlash: 'never',
  build: { format: 'file' },
  integrations: [sitemap()],
});
