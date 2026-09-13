#!/bin/sh
# Writes the six client settings into a config.js the nginx entrypoint machinery already
# runs before `exec nginx`, so one image serves every environment (ADR-0068) instead of
# needing a rebuild per API origin / Entra tenant. Read back by apps/web/src/runtimeConfig.ts
# via window.__APP_CONFIG__.
set -eu

CONFIG_FILE=/usr/share/nginx/html/config.js

# A value can contain a quote or backslash (unlikely for these six, but APP_API_URL is
# operator-supplied) — escape both so it can't break out of the JS string literal.
json_escape() {
  printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'
}

# fail loudly, moved here from the build (apps/web/Dockerfile used to refuse a blank
# VITE_API_URL at `docker build` time): a client id or scope forgotten for entra mode is a
# misconfiguration this container should crash-loop on, not silently serve as stub.
if [ "${APP_AUTH_MODE:-stub}" = "entra" ]; then
  for var in APP_ENTRA_CLIENT_ID APP_ENTRA_TENANT_ID APP_ENTRA_API_SCOPE; do
    eval "value=\${$var:-}"
    if [ -z "$value" ]; then
      echo "ERROR: $var is required when APP_AUTH_MODE=entra." >&2
      exit 1
    fi
  done
fi

cat > "$CONFIG_FILE" <<EOF
window.__APP_CONFIG__ = {
  API_URL: "$(json_escape "${APP_API_URL:-}")",
  AUTH_MODE: "$(json_escape "${APP_AUTH_MODE:-stub}")",
  ENTRA_CLIENT_ID: "$(json_escape "${APP_ENTRA_CLIENT_ID:-}")",
  ENTRA_TENANT_ID: "$(json_escape "${APP_ENTRA_TENANT_ID:-}")",
  ENTRA_API_SCOPE: "$(json_escape "${APP_ENTRA_API_SCOPE:-}")",
  ENTRA_REDIRECT_URI: "$(json_escape "${APP_ENTRA_REDIRECT_URI:-}")"
};
EOF
