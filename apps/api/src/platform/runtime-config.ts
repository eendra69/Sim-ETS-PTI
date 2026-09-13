export function validateRuntimeConfig(environment: NodeJS.ProcessEnv = process.env): void {
  const authMode = environment.AUTH_MODE ?? 'disabled';
  if (!['disabled', 'api-key'].includes(authMode)) {
    throw new Error('AUTH_MODE must be disabled or api-key');
  }
  if (environment.PERSISTENCE_MODE === 'postgres' && !environment.DATABASE_URL) {
    throw new Error('DATABASE_URL is required when PERSISTENCE_MODE=postgres');
  }
  if (environment.NODE_ENV === 'production') {
    if (authMode !== 'api-key') throw new Error('Production requires AUTH_MODE=api-key');
    if (!environment.API_KEYS_JSON) throw new Error('Production requires API_KEYS_JSON');
    let keys: unknown;
    try { keys = JSON.parse(environment.API_KEYS_JSON); } catch { throw new Error('API_KEYS_JSON must be valid JSON'); }
    if (!Array.isArray(keys) || keys.length === 0) {
      throw new Error('Production requires at least one API key identity');
    }
    if (!environment.WEB_ORIGIN || environment.WEB_ORIGIN === '*') {
      throw new Error('Production requires a specific WEB_ORIGIN');
    }
  }
}
