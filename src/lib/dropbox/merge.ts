// Merges the galleries synced from Dropbox with the gallery texts in src/content/galleries/*.json.
//
// Rules:
// - No Dropbox data (sync not configured, e.g. local dev): the JSON galleries are used as they are.
// - Every service in src/content/galleries/*.json (portretter, produktbilder, arkitektur) always
//   exists and keeps its texts (intro, CTA, SEO, layout, display name). It takes its images (and
//   cover.jpg, if any) from the Dropbox folder with the same slug or name ("01 Portretter").
//   Without such a folder, or while that folder is empty, it keeps the images in its JSON file.
// - A Dropbox folder without a JSON file becomes a new category with neutral default texts.
// - The services keep their JSON order (same as the home page). New categories come after them,
//   in folder order ("04 Bryllup" before "05 Konfirmasjon").

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
  const active = synced?.galleries.filter((g) => g.images.length > 0) ?? [];
  const matches = (j: Gallery, s: SyncedGallery) => j.slug === s.slug || slugify(j.name) === s.slug;

  const services = json.map((j) => {
    const s = active.find((a) => matches(j, a));
    if (!s) return j;
    return { ...j, images: s.images, cover: s.cover ?? j.cover };
  });
  const after = Math.max(-1, ...json.map((j) => j.order)) + 1;
  const extra = active.filter((s) => !json.some((j) => matches(j, s))).map((s, i) => ({ ...defaults(s), order: after + i }));
  return [...services.filter((g) => g.visible).sort((a, b) => a.order - b.order), ...extra];
}
