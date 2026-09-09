FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG VITE_API_URL=""
ARG VITE_DEPLOYMENT_MODE="hosted"
ARG VITE_OIDC_ISSUER=""
ARG VITE_OIDC_CLIENT_ID=""
ARG VITE_OIDC_REDIRECT_URI=""
ARG VITE_OIDC_SCOPE="openid profile email offline_access"
ARG VITE_OIDC_AUDIENCE=""
ENV VITE_API_URL=$VITE_API_URL \
    VITE_DEPLOYMENT_MODE=$VITE_DEPLOYMENT_MODE \
    VITE_OIDC_ISSUER=$VITE_OIDC_ISSUER \
    VITE_OIDC_CLIENT_ID=$VITE_OIDC_CLIENT_ID \
    VITE_OIDC_REDIRECT_URI=$VITE_OIDC_REDIRECT_URI \
    VITE_OIDC_SCOPE=$VITE_OIDC_SCOPE \
    VITE_OIDC_AUDIENCE=$VITE_OIDC_AUDIENCE
RUN set -eu; \
    test "$VITE_DEPLOYMENT_MODE" = "hosted" || test "$VITE_DEPLOYMENT_MODE" = "local"; \
    if [ "$VITE_DEPLOYMENT_MODE" = "hosted" ] && { [ -z "$VITE_OIDC_ISSUER" ] || [ -z "$VITE_OIDC_CLIENT_ID" ]; }; then \
      echo "hosted Web builds require VITE_OIDC_ISSUER and VITE_OIDC_CLIENT_ID" >&2; \
      exit 1; \
    fi; \
    npm run build

FROM nginxinc/nginx-unprivileged:1.29-alpine
USER root
RUN apk upgrade --no-cache
COPY --chmod=755 10-agentx-dns-resolver.envsh /docker-entrypoint.d/10-agentx-dns-resolver.envsh
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html
ENV AGENTX_API_UPSTREAM=http://api:8080 \
    AGENTX_CSP_CONNECT_SRC="'self' https:" \
    NGINX_ENVSUBST_FILTER=^AGENTX_
USER 101
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/_healthz || exit 1
