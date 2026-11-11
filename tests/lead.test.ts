import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateLead, buildLeadPayload, emptyLeadForm } from '../src/lib/forms/lead.ts';
import { monthWeeks, isDisabled } from '../src/lib/calendar.ts';

test('empty form: first name and email errors, same texts as the original', () => {
  const r = validateLead(emptyLeadForm());
  assert.equal(r.ok, false);
  if (!r.ok) assert.deepEqual(r.errors, { firstName: 'Fornavn er påkrevd', email: 'Ugyldig e-postadresse' });
});

test('valid minimal form passes and values are trimmed', () => {
  const r = validateLead({ ...emptyLeadForm(), firstName: '  Ola ', email: ' ola@example.no ' });
  assert.equal(r.ok, true);
  if (r.ok) { assert.equal(r.data.firstName, 'Ola'); assert.equal(r.data.email, 'ola@example.no'); }
});

test('optional seller email may be empty but must be valid when filled', () => {
  const base = { ...emptyLeadForm(), firstName: 'Ola', email: 'ola@example.no' };
  assert.equal(validateLead({ ...base, sellerEmail: '' }).ok, true);
  const bad = validateLead({ ...base, sellerEmail: 'nope' });
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.equal(bad.errors.sellerEmail, 'Ugyldig e-postadresse');
});

test('length limits', () => {
  const base = { ...emptyLeadForm(), firstName: 'Ola', email: 'ola@example.no' };
  const r = validateLead({ ...base, phone: '1'.repeat(21), assignmentNumber: 'x'.repeat(51), message: 'm'.repeat(2001) });
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.errors.phone, 'Telefonnummer må være under 20 tegn');
    assert.equal(r.errors.assignmentNumber, 'Oppdragsnummer må være under 50 tegn');
    assert.equal(r.errors.message, 'Melding må være under 2000 tegn');
  }
});

test('payload: field names, nulls, default time 09:00 and local calendar day', () => {
  const data = { ...emptyLeadForm(), firstName: 'Ola', lastName: '', email: 'ola@example.no', additionalServices: ['drone'] };
  const p = buildLeadPayload(data, new Date(2026, 10, 14), '');
  assert.equal(p.name, 'Ola');
  assert.equal(p.last_name, null);
  assert.deepEqual(p.additional_services, ['drone']);
  assert.equal(p.preferred_date, '2026-11-14');
  assert.equal(p.photo_datetime, '2026-11-14T09:00:00');
  assert.equal(buildLeadPayload(data, new Date(2026, 10, 14), '17:30').photo_datetime, '2026-11-14T17:30:00');
  assert.equal(buildLeadPayload(data, null, '').preferred_date, null);
});

test('calendar: November 2026 has 5 Sunday-first rows, today and earlier disabled', () => {
  const weeks = monthWeeks(new Date(2026, 10, 1));
  assert.equal(weeks.length, 5);
  assert.equal(weeks[0][0].getDate(), 1);
  assert.equal(weeks[4][6].getMonth(), 11); // Dec 5 shown as outside day
  const now = new Date(2026, 10, 10, 11, 0);
  assert.equal(isDisabled(new Date(2026, 10, 10), now), true);
  assert.equal(isDisabled(new Date(2026, 10, 11), now), false);
});
