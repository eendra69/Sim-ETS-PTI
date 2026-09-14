import { getSessionApiKey } from '../auth/api-key';

export const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000/api/v1';

interface ApiErrorBody {
  message?: string | string[];
}
export async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  const apiKey = getSessionApiKey();
  if (apiKey) headers.set('x-api-key', apiKey);

  const response = await fetch(`${apiBaseUrl}${path}`, { ...init, headers });
  const body = (await response.json()) as T & ApiErrorBody;
  if (!response.ok) {
    const message = Array.isArray(body.message) ? body.message.join('; ') : body.message;
    throw new Error(message ?? `API merespons ${response.status}`);
  }
  return body;
}
