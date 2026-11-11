import { describe, expect, it } from 'vitest';
import { DEFAULT_ROUTE, hrefFor, parseHash, ROUTES } from '../src/ui/router';

describe('parseHash', () => {
  it('maps each tab hash to its route', () => {
    for (const route of ROUTES) {
      expect(parseHash(`#/${route}`)).toBe(route);
    }
  });

  it('accepts a hash without the slash', () => {
    expect(parseHash('#city')).toBe('city');
  });

  it('uses the first segment and ignores the rest', () => {
    expect(parseHash('#/farm/area-1')).toBe('farm');
    expect(parseHash('#/city?filter=boss')).toBe('city');
  });

  it('falls back to the default route for an empty hash', () => {
    expect(parseHash('')).toBe(DEFAULT_ROUTE);
    expect(parseHash('#')).toBe(DEFAULT_ROUTE);
    expect(parseHash('#/')).toBe(DEFAULT_ROUTE);
  });

  it('falls back to the default route for an unknown hash', () => {
    expect(parseHash('#/nowhere')).toBe(DEFAULT_ROUTE);
    expect(parseHash('#/Farm')).toBe(DEFAULT_ROUTE);
    expect(parseHash('#//city')).toBe(DEFAULT_ROUTE);
  });
});

describe('hrefFor', () => {
  it('round-trips through parseHash', () => {
    for (const route of ROUTES) {
      expect(parseHash(hrefFor(route))).toBe(route);
    }
  });
});
