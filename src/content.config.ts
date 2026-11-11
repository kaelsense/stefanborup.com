import { defineCollection } from 'astro:content';
import { glob, file } from 'astro/loaders';
import { z } from 'astro/zod';

// Images are plain public paths (/images/...) so markup matches the original 1:1.
const image = z.object({
  src: z.string(),
  thumb: z.string().optional(),
  alt: z.string().default(''),
});

// One JSON file per gallery. The slug is the URL: portretter, produktbilder and
// arkitektur live at /<slug>; any other slug is served at /galleri/<slug>.
const galleries = defineCollection({
  loader: glob({ pattern: '*.json', base: './src/content/galleries' }),
  schema: z.object({
    slug: z.string(),
    name: z.string(),
    order: z.number(),
    visible: z.boolean().default(true),
    layout: z.enum(['portrait', 'natural']).default('natural'),
    cover: image,
    heroSubtitle: z.string().default(''),
    introHeading: z.string().default(''),
    intro: z.string().default(''),
    ctaHeading: z.string().default(''),
    ctaText: z.string().default(''),
    ctaLabel: z.string().default(''),
    seoTitle: z.string().default(''),
    seoDescription: z.string().default(''),
    images: z.array(image.extend({ key: z.string(), caption: z.string().optional() })),
  }),
});

// Site-wide copy that the old CMS stored as one "site" document.
const site = defineCollection({
  loader: file('./src/content/site.json'),
  schema: z.object({
    hero: z.object({
      slides: z.array(z.object({ key: z.string(), image, title: z.string().default(''), subtitle: z.string().default(''), buttonLink: z.string().default(''), buttonLabel: z.string().default('') })),
    }),
    intro: z.object({ title: z.string(), text: z.string() }),
    about: z.object({
      title: z.string(), text: z.string(), image, quote: z.string(), story: z.string(),
      pageLead: z.string(), storyHeading: z.string(), ctaHeading: z.string(), ctaText: z.string(),
    }),
    logos: z.array(z.object({ key: z.string(), name: z.string(), image })),
    services: z.array(z.object({
      key: z.string(), title: z.string(), lead: z.string().default(''), body: z.string(),
      closing: z.string().default(''), link: z.string().default(''), buttonLabel: z.string().default(''), image,
    })),
    testimonials: z.object({
      heading: z.string(),
      items: z.array(z.object({ key: z.string(), quote: z.string(), author: z.string(), role: z.string() })),
    }),
    latestShoot: z.object({ title: z.string(), text: z.string(), link: z.string(), buttonLabel: z.string(), image }),
    contact: z.object({ title: z.string(), text: z.string() }),
    footer: z.object({
      description: z.string(), email: z.string().default(''), phone: z.string().default(''),
      facebook: z.string().default(''), instagram: z.string().default(''), linkedin: z.string().default(''),
    }),
  }),
});

export const collections = { galleries, site };
