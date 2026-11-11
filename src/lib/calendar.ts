// Renders the booking calendar with the exact markup and classes that
// react-day-picker v8 + shadcn/ui produced on the original site.
// Shared by the server render (initial HTML) and the browser (interaction).
import { iconSvg } from './icons.ts';

const NAV_BTN = 'rdp-button_reset rdp-button inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&amp;_svg]:pointer-events-none [&amp;_svg]:size-4 [&amp;_svg]:shrink-0 border border-input hover:bg-accent hover:text-accent-foreground h-7 w-7 bg-transparent p-0 opacity-50 hover:opacity-100 absolute';
const TH = 'text-muted-foreground rounded-md w-9 font-normal text-[0.8rem]';
const TD = 'h-9 w-9 text-center text-sm p-0 relative [&amp;:has([aria-selected].day-range-end)]:rounded-r-md [&amp;:has([aria-selected].day-outside)]:bg-accent/50 [&amp;:has([aria-selected])]:bg-accent first:[&amp;:has([aria-selected])]:rounded-l-md last:[&amp;:has([aria-selected])]:rounded-r-md focus-within:relative focus-within:z-20';
const DAY = 'rdp-button_reset rdp-button inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&amp;_svg]:pointer-events-none [&amp;_svg]:size-4 [&amp;_svg]:shrink-0 hover:bg-accent hover:text-accent-foreground h-9 w-9 p-0 font-normal aria-selected:opacity-100';
const OUTSIDE = 'day-outside text-muted-foreground opacity-50 aria-selected:bg-accent/50 aria-selected:text-muted-foreground aria-selected:opacity-30';
const DISABLED = 'text-muted-foreground opacity-50';
const SELECTED = 'bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground focus:bg-primary focus:text-primary-foreground';
const TODAY = 'bg-accent text-accent-foreground';

const WEEKDAYS = [['Sunday', 'Su'], ['Monday', 'Mo'], ['Tuesday', 'Tu'], ['Wednesday', 'We'], ['Thursday', 'Th'], ['Friday', 'Fr'], ['Saturday', 'Sa']];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** Original rule: `disabled: day => day < new Date()`, so today and earlier are disabled. */
export const isDisabled = (day: Date, now: Date) => day < now;

export const isoDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Weeks shown for a month: Sunday-first, outside days filled in, no fixed six rows. */
export function monthWeeks(month: Date): Date[][] {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const last = new Date(month.getFullYear(), month.getMonth() + 1, 0);
  const start = new Date(first); start.setDate(1 - first.getDay());
  const end = new Date(last); end.setDate(last.getDate() + (6 - last.getDay()));
  const weeks: Date[][] = [];
  for (let d = new Date(start); d <= end;) {
    const week: Date[] = [];
    for (let i = 0; i < 7; i++) { week.push(new Date(d)); d.setDate(d.getDate() + 1); }
    weeks.push(week);
  }
  return weeks;
}

export function renderCalendar(month: Date, selected: Date | null, now: Date): string {
  const weeks = monthWeeks(month);
  const focusTarget = selected && selected.getMonth() === month.getMonth() && selected.getFullYear() === month.getFullYear()
    ? selected
    : weeks.flat().find((d) => d.getMonth() === month.getMonth() && !isDisabled(d, now)) ?? null;
  const rows = weeks.map((week) => `<tr class="flex w-full mt-2">${week.map((day) => {
    const outside = day.getMonth() !== month.getMonth();
    const disabled = isDisabled(day, now);
    const sel = !!selected && sameDay(day, selected);
    const cls = [DAY];
    if (outside) cls.push(OUTSIDE);
    if (disabled) cls.push(DISABLED);
    if (sel) cls.push(SELECTED);
    if (sameDay(day, now)) cls.push(TODAY);
    const tab = focusTarget && sameDay(day, focusTarget) ? '0' : '-1';
    return `<td class="${TD}" role="presentation"><button class="${cls.join(' ')}"${disabled ? ' disabled=""' : ''} name="day" role="gridcell" tabindex="${tab}" type="button" data-date="${isoDate(day)}"${sel ? ' aria-selected="true"' : ''}>${day.getDate()}</button></td>`;
  }).join('')}</tr>`).join('');
  return `<div class="flex flex-col sm:flex-row space-y-4 sm:space-x-4 sm:space-y-0"><div class="space-y-4 rdp-caption_start rdp-caption_end"><div class="flex justify-center pt-1 relative items-center"><div aria-live="polite" class="text-sm font-medium" id="react-day-picker-1" role="presentation">${MONTHS[month.getMonth()]} ${month.getFullYear()}</div><div class="space-x-1 flex items-center"><button aria-label="Go to previous month" class="${NAV_BTN} left-1" name="previous-month" type="button">${iconSvg('chevron-left', { className: 'h-4 w-4' })}</button><button aria-label="Go to next month" class="${NAV_BTN} right-1" name="next-month" type="button">${iconSvg('chevron-right', { className: 'h-4 w-4' })}</button></div></div><table aria-labelledby="react-day-picker-1" class="w-full border-collapse space-y-1" role="grid"><thead class="rdp-head"><tr class="flex">${WEEKDAYS.map(([l, s]) => `<th aria-label="${l}" class="${TH}" scope="col">${s}</th>`).join('')}</tr></thead><tbody class="rdp-tbody">${rows}</tbody></table></div></div>`;
}

/** "lørdag 14. november 2026", same as toLocaleDateString('nb-NO', {weekday, year, month, day}). */
export const formatChosenDate = (d: Date) =>
  d.toLocaleDateString('nb-NO', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
