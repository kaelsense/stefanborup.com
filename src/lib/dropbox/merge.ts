// Merges the galleries synced from Dropbox with the gallery texts in src/content/galleries/*.json.
//
// Rules:
// - No Dropbox data (sync not configured, e.g. local dev): the JSON galleries are used as they are.
// - Dropbox data with at least one category that has images: Dropbox decides WHICH categories
//   exist, their order and their images. Texts (intro, CTA, SEO, layout, display name) come from
//   the JSON file with the same slug, so "01 Portretter" keeps the existing portrait page copy.
// - A Dropbox category without a JSON file gets neutral default texts.
// - A JSON gallery without a Dropbox folder is then not shown.

import { slugify } from './plan.ts';

type Img = { src: string; thumb?: string; alt: string };
type GalleryImage = Img & { key: string; caption?: string };

export type Gallery = {
  slug: string; name: string; order: number; visible: boolean; layout: 'portrait' | 'natural';
  cover: Img; heroSubtitle: string; introHeading: string; intro: string;
  ctaHeading: string; ctaText: string; ctaLabel: string; seoTitle: string; seoDescription: string;
  images: GalleryImage[];
};

export type SyncedGallery = { slug: string; name: string; order: number; cover: Img | null; images: GalleryImage[] };
export type SyncedData = { syncedAt: string; galleries: SyncedGallery[] };

const defaults = (s: SyncedGallery): Gallery => ({
  slug: s.slug,
  name: s.name,
  order: s.order,
  visible: true,
  layout: 'natural',
  cover: s.cover ?? s.images[0],
  heroSubtitle: '',
  introHeading: '',
  intro: '',
  ctaHeading: 'Ønsker du lignende bilder?',
  ctaText: 'Ta kontakt for en uforpliktende prat om hva du trenger.',
  ctaLabel: 'Ta kontakt',
  seoTitle: `${s.name} | Stefan Borup Foto`,
  seoDescription: `${s.name} – et utvalg bilder av fotograf Stefan Borup.`,
  images: s.images,
});

export function mergeGalleries(json: Gallery[], synced: SyncedData | null): Gallery[] {
  const sorted = (list: Gallery[]) => [...list].filter((g) => g.visible).sort((a, b) => a.order - b.order);
  const active = synced?.galleries.filter((g) => g.images.length > 0) ?? [];
  if (active.length === 0) return sorted(json);

  return sorted(active.map((s) => {
    const text = json.find((j) => j.slug === s.slug || slugify(j.name) === s.slug);
    if (!text) return defaults(s);
    return { ...text, visible: true, order: s.order, images: s.images, cover: s.cover ?? text.cover };
  }));
}
