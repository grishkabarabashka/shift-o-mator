// Dev/build-time placeholder. In a container this file is overwritten at startup by
// apps/web/docker-entrypoint.d/40-config.sh, which fills it from APP_* environment
// variables (ADR-0068). Left empty here, every setting falls through to the VITE_*
// build-time value — the runtimeConfig.ts contract for a key that is simply absent.
window.__APP_CONFIG__ = {};
