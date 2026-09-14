import { describe, expect, it } from 'vitest';
import { priceOrDash, signed } from './format';

describe('market formatting', () => {
  it('keeps the no-trade price state explicit', () => {
    expect(priceOrDash(null)).toBe('—');
  });

  it('adds a sign only to positive positions', () => {
    expect(signed(1_000)).toMatch(/^\+/);
    expect(signed(0)).not.toMatch(/^[+-]/);
    expect(signed(-1_000)).toMatch(/^-/);
  });
});
