import { describe, expect, it } from 'vitest';

import { personAdminToWire } from './admin.ts';
import { personFromWire } from './mapping.ts';

/**
 * The wire→domain mappers are hand-written, so a field the server sends and the mapper
 * forgets is invisible: the type says the field is optional, so nothing fails to compile
 * and nothing throws — it is simply never there.
 *
 * `email` is the case that made this worth testing. It went missing on the way in, which
 * showed as a permanently blank column on Settings → People; the damage was on the way
 * *out*, because `personAdminToWire` sends `email: null` when the draft has none, so
 * saving any person unlinked them from their Entra ID sign-in (ADR-0058).
 */
const wirePerson = {
  id: 'p-hannah-fletcher',
  displayName: 'Hannah Fletcher',
  initials: 'HF',
  employeeId: '41076',
  email: 'hannah.fletcher@example.test',
  unitId: 'unit-st',
  locationId: 'loc-lon',
  orgCategory: 'MANAGEMENT',
  isActive: true,
  isIncluded: false,
  availableWeekdays: ['MONDAY'],
  defaultShiftId: null,
  weekendEligible: false,
  constraints: { minRestHours: 11, maxConsecutiveDays: 5, maxWeekendsPerQuarter: null },
  preferences: null,
  defaultPresenceTypeId: null,
  defaultSiteLocationId: null,
  eligibility: [],
};

describe('personFromWire', () => {
  it('carries the sign-in email', () => {
    expect(personFromWire(wirePerson).email).toBe('hannah.fletcher@example.test');
  });

  it('leaves it absent rather than empty when the server sends none', () => {
    // Null means "cannot sign in yet", and the admin form has to show a blank field for
    // it — not the string "null".
    expect(personFromWire({ ...wirePerson, email: null }).email).toBeUndefined();
  });

  it('survives a round trip through the admin write path', () => {
    // The regression that mattered: read a person, change something else, save, and the
    // link is still there.
    const domain = personFromWire(wirePerson);
    const request = personAdminToWire({ ...domain, displayName: 'Hannah F.' });

    expect(request.email).toBe('hannah.fletcher@example.test');
    expect(request.employeeId).toBe('41076');
  });

  it('lowercases the address on the way out, so a token matches however it was cased', () => {
    const domain = personFromWire({ ...wirePerson, email: 'Hannah.Fletcher@Example.Test' });
    expect(personAdminToWire(domain).email).toBe('hannah.fletcher@example.test');
  });
});
