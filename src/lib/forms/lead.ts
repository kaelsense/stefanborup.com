// Booking/lead form on the front page (#kontakt): field rules, error texts and
// the payload shape. Copied from the original site's zod schema so behaviour is
// unchanged. Pure functions, no DOM, so they are unit-tested in tests/.

export type LeadForm = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  photoPackage: string;
  additionalServices: string[];
  floorPlan: boolean;
  sellerName: string;
  sellerAddress: string;
  sellerEmail: string;
  sellerPhone: string;
  assignmentNumber: string;
  message: string;
};

export const emptyLeadForm = (): LeadForm => ({
  firstName: '', lastName: '', email: '', phone: '', photoPackage: '', additionalServices: [],
  floorPlan: false, sellerName: '', sellerAddress: '', sellerEmail: '', sellerPhone: '', assignmentNumber: '', message: '',
});

export const PHOTO_PACKAGES = [
  { value: 'leilighet', label: 'Leilighet' },
  { value: 'rekkehus', label: 'Rekkehus/tomannsbolig' },
  { value: 'enebolig', label: 'Enebolig' },
  { value: 'fasadebilder', label: 'Fasadebilder' },
  { value: 'andre_oppdrag', label: 'Andre oppdrag' },
];

/** Not a property shoot: the form hides add-ons and seller info, and they are not sent. */
export const OTHER_ASSIGNMENT = 'andre_oppdrag';

export const ADDITIONAL_SERVICES = [
  { id: 'kveldsfoto_7_10', label: 'Kveldsfoto 7-10 bilder' },
  { id: 'kveldsfoto_hel', label: 'Kveldsfoto hel bolig' },
  { id: 'drone', label: 'Drone' },
  { id: 'plantegning', label: 'Plantegning' },
];

// Close to zod's email check; good enough for the same user-facing behaviour.
const EMAIL = /^(?!\.)(?!.*\.\.)([A-Z0-9_'+\-.]*)[A-Z0-9_+-]@([A-Z0-9][A-Z0-9-]*\.)+[A-Z]{2,}$/i;

type Rule = (v: string) => string | null;
const max = (n: number, msg: string): Rule => (v) => (v.length > n ? msg : null);

const RULES: Partial<Record<keyof LeadForm, Rule[]>> = {
  firstName: [(v) => (v.length < 1 ? 'Fornavn er påkrevd' : null), max(100, 'Fornavn må være under 100 tegn')],
  lastName: [max(100, 'Etternavn må være under 100 tegn')],
  email: [(v) => (EMAIL.test(v) ? null : 'Ugyldig e-postadresse'), max(255, 'E-post må være under 255 tegn')],
  phone: [max(20, 'Telefonnummer må være under 20 tegn')],
  sellerName: [max(200, 'Selgers navn må være under 200 tegn')],
  sellerAddress: [max(300, 'Adressen må være under 300 tegn')],
  sellerEmail: [(v) => (v === '' || EMAIL.test(v) ? null : 'Ugyldig e-postadresse'), max(255, 'String must contain at most 255 character(s)')],
  sellerPhone: [max(20, 'Telefonnummer må være under 20 tegn')],
  assignmentNumber: [max(50, 'Oppdragsnummer må være under 50 tegn')],
  message: [max(2000, 'Melding må være under 2000 tegn')],
};

export type LeadErrors = Partial<Record<keyof LeadForm, string>>;

/** Returns trimmed data, or errors per field (last failing rule wins, like the original). */
export function validateLead(form: LeadForm): { ok: true; data: LeadForm } | { ok: false; errors: LeadErrors } {
  const data: LeadForm = { ...form };
  const errors: LeadErrors = {};
  for (const key of Object.keys(RULES) as (keyof LeadForm)[]) {
    const value = String(form[key] ?? '').trim();
    (data as Record<string, unknown>)[key] = value;
    for (const rule of RULES[key]!) {
      const msg = rule(value);
      if (msg) errors[key] = msg;
    }
  }
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, data };
}

const localIsoDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * Payload with the same field names the old backend received.
 * One deliberate fix: the original used toISOString() on a local midnight date,
 * which sent the day before for Norwegian visitors. Here the chosen calendar day is sent.
 */
export function buildLeadPayload(data: LeadForm, date: Date | null, time: string) {
  const day = date ? localIsoDate(date) : null;
  // Add-ons and seller info only apply to property shoots; drop anything typed before switching.
  const property = data.photoPackage !== OTHER_ASSIGNMENT;
  return {
    name: `${data.firstName} ${data.lastName || ''}`.trim(),
    first_name: data.firstName,
    last_name: data.lastName || null,
    email: data.email,
    phone: data.phone || null,
    photo_package: data.photoPackage || null,
    additional_services: property && data.additionalServices.length ? data.additionalServices : null,
    floor_plan: property && (data.floorPlan || false),
    seller_name: property ? data.sellerName || null : null,
    seller_address: data.sellerAddress || null,
    seller_email: property ? data.sellerEmail || null : null,
    seller_phone: property ? data.sellerPhone || null : null,
    assignment_number: property ? data.assignmentNumber || null : null,
    message: data.message || null,
    preferred_date: day,
    photo_datetime: day ? `${day}T${time || '09:00'}:00` : null,
  };
}

export type LeadPayload = ReturnType<typeof buildLeadPayload>;
