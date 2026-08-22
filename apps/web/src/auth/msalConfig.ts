/**
 * Форма конфигурации MSAL — заготовка на будущее, сейчас никуда не подключена.
 *
 * Реальная интеграция Entra ID (`@azure/msal-browser`/`@azure/msal-react`) — не
 * Phase 4; это только типизированная форма, которую тот код будет ждать, чтобы
 * переключение `Auth:Mode` на сервере с `Stub` на `EntraId` не стало сюрпризом на
 * клиенте, когда до этого дойдёт очередь.
 */

export interface MsalConfig {
  readonly auth: {
    readonly clientId: string;
    /** e.g. `https://login.microsoftonline.com/<tenant-id>` */
    readonly authority: string;
    readonly redirectUri: string;
  };
  readonly cache?: {
    readonly cacheLocation: 'localStorage' | 'sessionStorage';
  };
}

// Placeholder values only — not read by anything yet, and not a secret (MSAL client
// IDs/authorities are public by design; there is no client secret in a SPA flow).
export const msalConfig: MsalConfig = {
  auth: {
    clientId: '00000000-0000-0000-0000-000000000000',
    authority: 'https://login.microsoftonline.com/00000000-0000-0000-0000-000000000000',
    redirectUri: '/',
  },
  cache: {
    cacheLocation: 'sessionStorage',
  },
};
