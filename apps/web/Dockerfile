# syntax=docker/dockerfile:1
# Образ web-приложения. Контекст сборки - корень репозитория (нужен пакет
# packages/api-client из workspace):
#   docker build -f apps/web/Dockerfile .
# Адреса API и провайдера входа попадают в код браузера при сборке, поэтому
# передаются аргументами сборки, а не переменными окружения контейнера.

FROM node:24.14.0-alpine AS build
WORKDIR /repo
ENV NEXT_TELEMETRY_DISABLED=1

# Манифесты всех workspace нужны npm, чтобы проверить package-lock.json;
# зависимости ставятся только для web и того, что оно импортирует.
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
COPY apps/mobile/package.json apps/mobile/
COPY packages/api-client/package.json packages/api-client/
RUN --mount=type=cache,target=/root/.npm \
    npm ci --workspace @sozhiteli/web --include-workspace-root=false --no-audit --no-fund

COPY packages/api-client packages/api-client
COPY apps/web apps/web

ARG NEXT_PUBLIC_API_BASE_URL
ARG NEXT_PUBLIC_OIDC_AUTHORITY
ARG NEXT_PUBLIC_OIDC_CLIENT_ID
ENV NEXT_OUTPUT_STANDALONE=1
RUN npm run build --workspace @sozhiteli/web

# Только автономная сборка Next.js: без исходников и dev-зависимостей.
FROM node:24.14.0-alpine
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
