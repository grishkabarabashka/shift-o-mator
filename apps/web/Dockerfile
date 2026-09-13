# Build context must be the repository root (npm workspace root).
FROM node:22-alpine AS build
WORKDIR /repo

COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/package.json
RUN npm ci

COPY apps/web/ apps/web/

# No VITE_* build-args: the six client settings (API origin, auth mode, Entra client/tenant/
# scope/redirect) are written into config.js by the container at start, from APP_* env vars
# (apps/web/docker-entrypoint.d/40-config.sh), not baked in here. One image serves every
# environment (ADR-0068) — the values that used to be build-args are Helm/compose config now.
RUN npm run build --workspace=@shift-o-mator/web

FROM nginx:1.27-alpine AS runtime
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
COPY apps/web/docker-entrypoint.d/40-config.sh /docker-entrypoint.d/40-config.sh

# uid 1000, and the Helm chart pins the same number (`web.runAsUser`). It is deliberately
# NOT the API image's 1654: this image creates its own user, that one ships with one.
RUN addgroup -g 1000 app && adduser -D -u 1000 -G app app \
  && chmod +x /docker-entrypoint.d/40-config.sh \
  && chown -R app:app /usr/share/nginx/html /var/cache/nginx /var/run \
  && touch /var/run/nginx.pid && chown app:app /var/run/nginx.pid
USER app

EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]
