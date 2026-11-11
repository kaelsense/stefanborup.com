// Full-screen image viewer with the original Radix Dialog markup and behaviour:
// arrows/keys/swipe to navigate, Escape or the close button to exit.
import { iconSvg } from '../lib/icons.ts';

type Img = { src: string; title: string; description: string | null };
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

const OVERLAY = 'fixed inset-0 z-50 bg-black/80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0';
const CONTENT = 'fixed left-[50%] top-[50%] z-50 translate-x-[-50%] translate-y-[-50%] gap-4 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] sm:rounded-lg max-w-none w-screen h-screen p-0 bg-background/95 backdrop-blur-md border-0 rounded-none [&>button:last-child]:hidden flex items-center justify-center';
const NAV = 'absolute top-1/2 -translate-y-1/2 z-50 p-3 text-foreground/70 hover:text-primary transition-colors';

export function openLightbox(images: Img[], start: number, opener?: HTMLElement) {
  let index = start;
  const overlay = document.createElement('div');
  overlay.dataset.state = 'open';
  overlay.className = OVERLAY;
  overlay.style.pointerEvents = 'auto';
  const dialog = document.createElement('div');
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.dataset.state = 'open';
  dialog.className = CONTENT;
  dialog.tabIndex = -1;
  dialog.style.pointerEvents = 'auto';

  const render = () => {
    const img = images[index];
    const many = images.length > 1;
    dialog.innerHTML = `<h2 class="text-lg font-semibold leading-none tracking-tight sr-only">${esc(img.title)}</h2><p class="text-sm text-muted-foreground sr-only">${esc(img.description || 'Bilde')}</p>`
      + `<button data-lightbox-close="true" class="absolute top-4 right-4 z-50 p-2 rounded-full bg-background/70 backdrop-blur-sm text-foreground hover:bg-primary hover:text-primary-foreground transition-colors shadow-lg" aria-label="Lukk">${iconSvg('x', { size: 24, strokeWidth: 2 })}</button>`
      + `<div class="absolute top-6 left-6 z-50 text-xs uppercase tracking-[0.2em] text-foreground/70">${index + 1} / ${images.length}</div>`
      + (many ? `<button data-prev class="${NAV.replace('absolute ', 'absolute left-2 md:left-6 ')}" aria-label="Forrige bilde">${iconSvg('chevron-left', { size: 44, strokeWidth: 1 })}</button>` : '')
      + `<div class="flex flex-col items-center justify-center w-full h-full px-4 md:px-20 py-16"><img src="${esc(img.src)}" alt="${esc(img.title)}" class="max-w-full max-h-[85vh] w-auto h-auto object-contain animate-fade-in select-none" draggable="false">`
      + ((img.title || img.description) ? `<div class="mt-6 text-center max-w-2xl px-4"><h3 class="text-foreground text-lg md:text-xl font-medium">${esc(img.title)}</h3>${img.description ? `<p class="text-muted-foreground text-sm mt-1">${esc(img.description)}</p>` : ''}</div>` : '')
      + `</div>`
      + (many ? `<button data-next class="${NAV.replace('absolute ', 'absolute right-2 md:right-6 ')}" aria-label="Neste bilde">${iconSvg('chevron-right', { size: 44, strokeWidth: 1 })}</button>` : '');
    // Preload neighbours, like the original.
    [1, -1].forEach((d) => { const n = new Image(); n.src = images[(index + d + images.length) % images.length].src; });
    dialog.querySelector<HTMLElement>('[data-lightbox-close]')!.focus();
  };
  const go = (d: number) => { index = (index + d + images.length) % images.length; render(); };
  const close = () => {
    overlay.remove(); dialog.remove();
    document.body.style.removeProperty('overflow');
    document.body.style.removeProperty('pointer-events');
    document.body.removeAttribute('data-scroll-locked');
    window.removeEventListener('keydown', onKey);
    opener?.focus();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowRight') go(1);
    else if (e.key === 'ArrowLeft') go(-1);
    else if (e.key === 'Escape') close();
  };
  dialog.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (t.closest('[data-lightbox-close]')) close();
    else if (t.closest('[data-prev]')) go(-1);
    else if (t.closest('[data-next]')) go(1);
  });
  let touchX: number | null = null;
  dialog.addEventListener('touchstart', (e) => { touchX = e.touches[0].clientX; });
  dialog.addEventListener('touchend', (e) => {
    if (touchX === null) return;
    const dx = e.changedTouches[0].clientX - touchX; touchX = null;
    if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1);
  });
  window.addEventListener('keydown', onKey);
  document.body.setAttribute('data-scroll-locked', '1');
  document.body.style.overflow = 'hidden';
  document.body.appendChild(overlay);
  document.body.appendChild(dialog);
  render();
}
