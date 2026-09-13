import { validateRuntimeConfig } from './runtime-config';

describe('validateRuntimeConfig', () => {
  it('allows the local disabled-auth profile', () => {
    expect(() => validateRuntimeConfig({ NODE_ENV: 'development' })).not.toThrow();
  });

  it('fails closed when production auth is disabled', () => {
    expect(() => validateRuntimeConfig({
      NODE_ENV: 'production',
      AUTH_MODE: 'disabled',
      WEB_ORIGIN: 'https://simulator.example.id',
    })).toThrow('Production requires AUTH_MODE=api-key');
  });

  it('accepts an explicit production security profile', () => {
    expect(() => validateRuntimeConfig({
      NODE_ENV: 'production',
      AUTH_MODE: 'api-key',
      API_KEYS_JSON: '[{"apiKey":"1234567890123456","actorId":"ADMIN","roles":["ADMIN"]}]',
      WEB_ORIGIN: 'https://simulator.example.id',
      PERSISTENCE_MODE: 'postgres',
      DATABASE_URL: 'postgresql://example',
    })).not.toThrow();
  });
});
