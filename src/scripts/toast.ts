// Minimal replacement for the shadcn/ui toast used by the original form.
import { iconSvg } from '../lib/icons.ts';

const BASE = 'group pointer-events-auto relative flex w-full items-center justify-between space-x-4 overflow-hidden rounded-md border p-6 pr-8 shadow-lg transition-all data-[swipe=cancel]:translate-x-0 data-[swipe=end]:translate-x-[var(--radix-toast-swipe-end-x)] data-[swipe=move]:translate-x-[var(--radix-toast-swipe-move-x)] data-[swipe=move]:transition-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[swipe=end]:animate-out data-[state=closed]:fade-out-80 data-[state=closed]:slide-out-to-right-full data-[state=open]:slide-in-from-top-full data-[state=open]:sm:slide-in-from-bottom-full';
const VARIANT = {
  default: 'border bg-background text-foreground',
  destructive: 'destructive group border-destructive bg-destructive text-destructive-foreground',
};
const CLOSE = 'absolute right-2 top-2 rounded-md p-1 text-foreground/50 opacity-0 transition-opacity hover:text-foreground focus:opacity-100 focus:outline-none focus:ring-2 group-hover:opacity-100 group-[.destructive]:text-red-300 group-[.destructive]:hover:text-red-50 group-[.destructive]:focus:ring-red-400 group-[.destructive]:focus:ring-offset-red-600';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export function toast(opts: { title: string; description?: string; variant?: 'default' | 'destructive' }) {
  const viewport = document.querySelector<HTMLOListElement>('[data-toast-viewport]');
  if (!viewport) return;
  viewport.innerHTML = ''; // the original showed one toast at a time (TOAST_LIMIT = 1)
  const li = document.createElement('li');
  li.setAttribute('role', 'status');
  li.setAttribute('aria-live', 'off');
  li.setAttribute('aria-atomic', 'true');
  li.tabIndex = 0;
  li.dataset.state = 'open';
  li.dataset.swipeDirection = 'right';
  li.className = `${BASE} ${VARIANT[opts.variant ?? 'default']}`;
  li.style.cssText = 'user-select: none; touch-action: none;';
  li.innerHTML = `<div class="grid gap-1"><div class="text-sm font-semibold">${esc(opts.title)}</div>${opts.description ? `<div class="text-sm opacity-90">${esc(opts.description)}</div>` : ''}</div><button type="button" class="${CLOSE}" toast-close="">${iconSvg('x', { className: 'h-4 w-4' })}</button>`;
  const close = () => { li.dataset.state = 'closed'; setTimeout(() => li.remove(), 200); };
  li.querySelector('button')!.addEventListener('click', close);
  viewport.appendChild(li);
  setTimeout(close, 5000);
}
