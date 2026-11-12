// Behaviour of the front-page booking form (calendar, select, checkboxes,
// validation, submit). Sending is delegated to the form backend seam.
import { renderCalendar, sameDay, formatChosenDate } from '../lib/calendar.ts';
import { emptyLeadForm, validateLead, buildLeadPayload, PHOTO_PACKAGES, OTHER_ASSIGNMENT, type LeadForm, type LeadErrors } from '../lib/forms/lead.ts';
import { submitLead } from '../lib/forms/backend.ts';
import { iconSvg } from '../lib/icons.ts';
import { toast } from './toast.ts';

const TEXT_FIELDS = ['firstName', 'lastName', 'email', 'phone', 'sellerName', 'assignmentNumber', 'sellerAddress', 'sellerEmail', 'sellerPhone', 'message'] as const;
const ITEM = 'relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 focus:bg-accent focus:text-accent-foreground';
const CONTENT = 'relative z-50 max-h-96 min-w-[8rem] overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1';

type Turnstile = { getResponse(el?: Element): string | undefined; reset(el?: Element): void };
const turnstile = () => (window as unknown as { turnstile?: Turnstile }).turnstile;

export function initContactForm() {
  const root = document.querySelector<HTMLElement>('[data-lead]');
  if (!root) return;
  const form = root.querySelector('form')!;

  // ---- Calendar -------------------------------------------------------
  const cal = root.querySelector<HTMLElement>('[data-calendar]')!;
  const timeField = root.querySelector<HTMLElement>('[data-time-field]')!;
  const timeInput = timeField.querySelector<HTMLInputElement>('input')!;
  const chosen = root.querySelector<HTMLElement>('[data-chosen-date]')!;
  const today = new Date();
  let month = new Date(today.getFullYear(), today.getMonth(), 1);
  let selected: Date | null = null;
  const drawCalendar = () => (cal.innerHTML = renderCalendar(month, selected, new Date()));
  const drawChosen = () => {
    timeField.hidden = !selected;
    chosen.hidden = !selected;
    chosen.textContent = selected ? `Valgt dato: ${formatChosenDate(selected)}${timeInput.value ? ` kl. ${timeInput.value}` : ''}` : '';
  };
  cal.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('button');
    if (!btn || btn.disabled) return;
    if (btn.name === 'previous-month') month = new Date(month.getFullYear(), month.getMonth() - 1, 1);
    else if (btn.name === 'next-month') month = new Date(month.getFullYear(), month.getMonth() + 1, 1);
    else if (btn.name === 'day') {
      const [y, m, d] = btn.dataset.date!.split('-').map(Number);
      const day = new Date(y, m - 1, d);
      selected = selected && sameDay(selected, day) ? null : day; // single mode toggles
    }
    drawCalendar(); drawChosen();
  });
  timeInput.addEventListener('input', drawChosen);
  drawCalendar(); // the server render used the build date

  // ---- Select (photo package) ----------------------------------------
  const trigger = root.querySelector<HTMLButtonElement>('[data-select]')!;
  const valueEl = trigger.querySelector<HTMLElement>('[data-select-value]')!;
  const native = root.querySelector<HTMLSelectElement>('[data-native-select]')!;
  let photoPackage = '';
  // Add-ons and seller info are for property shoots only; hide them for «Andre oppdrag».
  const propertyOnly = root.querySelector<HTMLElement>('[data-property-only]')!;
  const syncPropertyOnly = () => (propertyOnly.hidden = photoPackage === OTHER_ASSIGNMENT);
  let popup: HTMLElement | null = null;
  const closeSelect = () => {
    popup?.remove(); popup = null;
    trigger.setAttribute('aria-expanded', 'false'); trigger.dataset.state = 'closed';
    document.removeEventListener('pointerdown', outside, true);
  };
  const outside = (e: Event) => { if (popup && !popup.contains(e.target as Node) && !trigger.contains(e.target as Node)) closeSelect(); };
  const choose = (value: string) => {
    photoPackage = value; native.value = value;
    valueEl.textContent = PHOTO_PACKAGES.find((p) => p.value === value)!.label;
    trigger.removeAttribute('data-placeholder');
    syncPropertyOnly();
    closeSelect(); trigger.focus();
  };
  const openSelect = () => {
    const r = trigger.getBoundingClientRect();
    popup = document.createElement('div');
    popup.setAttribute('data-radix-popper-content-wrapper', '');
    popup.dir = 'ltr';
    popup.style.cssText = `position: fixed; left: 0px; top: 0px; transform: translate(${r.left}px, ${r.bottom}px); min-width: max-content; z-index: 50;`;
    popup.innerHTML = `<div data-side="bottom" data-align="start" role="listbox" id="photo-package-list" data-state="open" dir="ltr" class="${CONTENT}" tabindex="-1" style="box-sizing: border-box; display: flex; flex-direction: column; outline: none; pointer-events: auto;"><div role="presentation" class="p-1 w-full" style="position: relative; flex: 1 1 0%; overflow: hidden auto; min-width: ${r.width}px;">${PHOTO_PACKAGES.map((p) => {
      const on = p.value === photoPackage;
      return `<div role="option" aria-selected="${on}" data-state="${on ? 'checked' : 'unchecked'}" tabindex="-1" class="${ITEM}" data-value="${p.value}"><span class="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">${on ? iconSvg('check', { className: 'h-4 w-4' }) : ''}</span><span>${p.label}</span></div>`;
    }).join('')}</div></div>`;
    document.body.appendChild(popup);
    const options = [...popup.querySelectorAll<HTMLElement>('[role=option]')];
    options.forEach((o) => {
      o.addEventListener('pointermove', () => o.focus());
      o.addEventListener('click', () => choose(o.dataset.value!));
      o.addEventListener('keydown', (e) => {
        const i = options.indexOf(o);
        if (e.key === 'ArrowDown') { e.preventDefault(); options[Math.min(i + 1, options.length - 1)].focus(); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); options[Math.max(i - 1, 0)].focus(); }
        else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(o.dataset.value!); }
        else if (e.key === 'Escape' || e.key === 'Tab') { closeSelect(); trigger.focus(); }
      });
    });
    (options.find((o) => o.dataset.value === photoPackage) ?? options[0]).focus();
    trigger.setAttribute('aria-expanded', 'true'); trigger.dataset.state = 'open';
    document.addEventListener('pointerdown', outside, true);
  };
  trigger.addEventListener('click', () => (popup ? closeSelect() : openSelect()));
  trigger.addEventListener('keydown', (e) => { if ((e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') && !popup) { e.preventDefault(); openSelect(); } });
  window.addEventListener('scroll', () => popup && closeSelect(), { passive: true });

  // ---- Checkboxes -------------------------------------------------------
  const services = new Set<string>();
  root.querySelectorAll<HTMLButtonElement>('[data-service]').forEach((box) => {
    box.addEventListener('click', () => {
      const id = box.dataset.service!;
      const on = !services.has(id);
      on ? services.add(id) : services.delete(id);
      box.setAttribute('aria-checked', String(on));
      box.dataset.state = on ? 'checked' : 'unchecked';
      box.innerHTML = on ? `<span data-state="checked" class="flex items-center justify-center text-current" style="pointer-events: none;">${iconSvg('check', { className: 'h-4 w-4' })}</span>` : '';
      (box.nextElementSibling as HTMLInputElement).checked = on;
    });
  });

  // ---- Validation + submit -------------------------------------------
  const el = (id: string) => form.querySelector<HTMLInputElement | HTMLTextAreaElement>(`#${id}`)!;
  const showErrors = (errors: LeadErrors) => {
    form.querySelectorAll('[data-error]').forEach((p) => p.remove());
    TEXT_FIELDS.forEach((id) => {
      const input = el(id);
      const msg = errors[id];
      input.classList.toggle('border-destructive', !!msg);
      input.classList.toggle('border-border', !msg);
      if (msg) {
        const p = document.createElement('p');
        p.className = 'text-sm text-destructive mt-1';
        p.dataset.error = '';
        p.textContent = msg;
        input.after(p);
      }
    });
  };
  const reset = () => {
    form.reset();
    TEXT_FIELDS.forEach((id) => (el(id).value = ''));
    services.clear();
    root.querySelectorAll<HTMLButtonElement>('[data-service]').forEach((b) => { b.setAttribute('aria-checked', 'false'); b.dataset.state = 'unchecked'; b.innerHTML = ''; });
    photoPackage = ''; valueEl.textContent = 'Velg fotopakke'; trigger.setAttribute('data-placeholder', ''); syncPropertyOnly();
    selected = null; timeInput.value = ''; drawCalendar(); drawChosen();
  };
  const submitBtn = form.querySelector<HTMLButtonElement>('button[type=submit]')!;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    showErrors({});
    const values: LeadForm = { ...emptyLeadForm(), photoPackage, additionalServices: [...services] };
    // Hidden fields (seller info for «Andre oppdrag») must not block or travel with the submit.
    TEXT_FIELDS.forEach((id) => ((values as Record<string, unknown>)[id] = propertyOnly.hidden && propertyOnly.contains(el(id)) ? '' : el(id).value));
    const result = validateLead(values);
    if (!result.ok) { showErrors(result.errors); return; }
    // Cloudflare Turnstile: only present when a site key was set at build time.
    const widget = form.querySelector<HTMLElement>('[data-turnstile]');
    const turnstileToken = widget ? turnstile()?.getResponse(widget) ?? '' : '';
    if (widget && !turnstileToken) {
      toast({ title: 'Vent litt', description: 'Sikkerhetssjekken er ikke ferdig ennå. Prøv igjen om et øyeblikk.', variant: 'destructive' });
      return;
    }
    submitBtn.disabled = true;
    const label = submitBtn.textContent;
    submitBtn.textContent = 'Sender...';
    try {
      const honeypot = form.querySelector<HTMLInputElement>('[data-honeypot]')?.value ?? '';
      const res = await submitLead(buildLeadPayload(result.data, selected, timeInput.value), honeypot, fetch, turnstileToken);
      if (!res.ok) {
        const description = res.reason === 'captcha_failed'
          ? 'Sikkerhetssjekken feilet. Vennligst prøv igjen.'
          : 'Kunne ikke sende forespørselen. Vennligst prøv igjen.';
        toast({ title: 'Noe gikk galt', description, variant: 'destructive' });
        return;
      }
      toast({ title: 'Takk for din henvendelse!', description: 'Vi tar kontakt med deg så snart som mulig.' });
      reset();
    } catch (err) {
      console.error('Error:', err);
      toast({ title: 'Noe gikk galt', description: 'Kunne ikke sende forespørselen. Vennligst prøv igjen.', variant: 'destructive' });
    } finally {
      // Turnstile tokens are single use, so get a fresh one for the next attempt.
      if (widget) turnstile()?.reset(widget);
      submitBtn.disabled = false;
      submitBtn.textContent = label;
    }
  });
}
