# Build context must be the repository root (npm workspace root).
FROM node:22-alpine AS build
WORKDIR /repo

COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/package.json
RUN npm ci

COPY apps/web/ apps/web/

# Vite embeds VITE_* into the JS bundle at build time, so these must be known here, not
# at container start — there is no way to repoint an already-built image at a different
# API or tenant without rebuilding it.
#
# None are secrets: a SPA client id and a scope are public by design (the boundary is the
# registered redirect URI and the token the API validates). See apps/web/.env.example.
ARG VITE_API_URL
ARG VITE_AUTH_MODE=stub
ARG VITE_ENTRA_CLIENT_ID
ARG VITE_ENTRA_TENANT_ID
ARG VITE_ENTRA_API_SCOPE
ARG VITE_ENTRA_REDIRECT_URI
ENV VITE_API_URL=${VITE_API_URL} \
    VITE_AUTH_MODE=${VITE_AUTH_MODE} \
    VITE_ENTRA_CLIENT_ID=${VITE_ENTRA_CLIENT_ID} \
    VITE_ENTRA_TENANT_ID=${VITE_ENTRA_TENANT_ID} \
    VITE_ENTRA_API_SCOPE=${VITE_ENTRA_API_SCOPE} \
    VITE_ENTRA_REDIRECT_URI=${VITE_ENTRA_REDIRECT_URI}
RUN npm run build --workspace=@shift-o-mator/web

FROM nginx:1.27-alpine AS runtime
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html

RUN addgroup -g 1000 app && adduser -D -u 1000 -G app app \
  && chown -R app:app /usr/share/nginx/html /var/cache/nginx /var/run \
  && touch /var/run/nginx.pid && chown app:app /var/run/nginx.pid
USER app

EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]
