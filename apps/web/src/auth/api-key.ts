const API_KEY_STORAGE_KEY = 'sim-ets-api-key';

export function getSessionApiKey(): string {
  return sessionStorage.getItem(API_KEY_STORAGE_KEY) ?? '';
}
export function setSessionApiKey(value: string): boolean {
  const normalized = value.trim();
  if (normalized) sessionStorage.setItem(API_KEY_STORAGE_KEY, normalized);
  else sessionStorage.removeItem(API_KEY_STORAGE_KEY);
  return normalized.length > 0;
}
