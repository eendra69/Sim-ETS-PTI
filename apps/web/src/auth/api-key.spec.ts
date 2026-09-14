import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getSessionApiKey, setSessionApiKey } from './api-key';

describe('session API key', () => {
  const values = new Map<string, string>();
  const storage: Storage = {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key); },
    setItem: (key, value) => { values.set(key, value); },
  };

  beforeEach(() => {
    values.clear();
    vi.stubGlobal('sessionStorage', storage);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('normalizes and stores a key only for the browser session', () => {
    expect(setSessionApiKey('  temporary-key  ')).toBe(true);
    expect(getSessionApiKey()).toBe('temporary-key');
  });

  it('removes the key when the input is empty', () => {
    setSessionApiKey('temporary-key');
    expect(setSessionApiKey('   ')).toBe(false);
    expect(getSessionApiKey()).toBe('');
  });
});
