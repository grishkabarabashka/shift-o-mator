// @vitest-environment jsdom
// `window.__APP_CONFIG__` is what this module reads — node has no window at all.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// `runtimeConfig.ts` reads `window.__APP_CONFIG__` once, at module load — so each case
// sets it up first and imports fresh via `vi.resetModules()` + a dynamic import, rather
// than mutating the global after the module under test has already captured it.
describe('runtimeConfig.setting', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    delete (window as { __APP_CONFIG__?: unknown }).__APP_CONFIG__;
    vi.unstubAllEnvs();
  });

  it('prefers the runtime value over the build-time one', async () => {
    window.__APP_CONFIG__ = { API_URL: 'https://runtime.example' };
    vi.stubEnv('VITE_API_URL', 'https://build-time.example');

    const { setting } = await import('./runtimeConfig.ts');

    expect(setting('API_URL')).toBe('https://runtime.example');
  });

  it('falls back to the build-time value when the runtime key is absent', async () => {
    window.__APP_CONFIG__ = {};
    vi.stubEnv('VITE_API_URL', 'https://build-time.example');

    const { setting } = await import('./runtimeConfig.ts');

    expect(setting('API_URL')).toBe('https://build-time.example');
  });

  it('an empty runtime value is kept, not treated as absent', async () => {
    // This is the case that matters in production: behind the ingress the container
    // writes APP_API_URL as "" on purpose (same-origin, relative /api/... request), and
    // that must not fall through to a stale or localhost build-time default.
    window.__APP_CONFIG__ = { API_URL: '' };
    vi.stubEnv('VITE_API_URL', 'https://build-time.example');

    const { setting } = await import('./runtimeConfig.ts');

    expect(setting('API_URL')).toBe('');
  });

  it('is undefined when neither source has the key', async () => {
    window.__APP_CONFIG__ = {};

    const { setting } = await import('./runtimeConfig.ts');

    expect(setting('ENTRA_CLIENT_ID')).toBeUndefined();
  });
});
