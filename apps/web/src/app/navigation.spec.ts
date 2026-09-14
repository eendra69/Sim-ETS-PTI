import { describe, expect, it } from 'vitest';
import { navigationLabelFromHash, workspaceViewFromHash } from './navigation';

describe('workspace navigation', () => {
  it('routes catalogue hashes to their own views', () => {
    expect(workspaceViewFromHash('#participants')).toBe('participants');
    expect(workspaceViewFromHash('#product-series')).toBe('product-series');
  });

  it('keeps market anchors in the regular market view', () => {
    expect(workspaceViewFromHash('#orders')).toBe('market');
    expect(workspaceViewFromHash('')).toBe('market');
    expect(navigationLabelFromHash('#orders')).toBe('Orders');
    expect(navigationLabelFromHash('#unknown')).toBe('Pasar Reguler');
  });
});
