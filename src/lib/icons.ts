import icons from '../data/icons.json' with { type: 'json' };

/** Lucide icon markup copied from the original site's rendered HTML. */
export function iconSvg(name: string, opts: { size?: number; strokeWidth?: number | string; className?: string; ariaHidden?: boolean } = {}) {
  const { size = 24, strokeWidth = 2, className = '', ariaHidden = false } = opts;
  const inner = (icons as Record<string, string>)[`lucide-${name}`];
  if (inner === undefined) throw new Error(`Unknown icon: ${name}`);
  const cls = `lucide lucide-${name}${className ? ' ' + className : ''}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" class="${cls}"${ariaHidden ? ' aria-hidden="true"' : ''}>${inner}</svg>`;
}
