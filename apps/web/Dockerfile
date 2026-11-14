# Build context = repo root:  docker build -f apps/web/Dockerfile -t damez-web .
FROM node:22-alpine AS deps
WORKDIR /repo
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/web/package.json apps/web/
# api manifest is needed so the workspace lockfile resolves
COPY apps/api/package.json apps/api/
RUN npm ci --workspace @damez/web --workspace @damez/shared --include-workspace-root

FROM deps AS build
WORKDIR /repo
COPY packages/shared packages/shared
RUN npm run build -w @damez/shared
COPY apps/web apps/web
ENV NEXT_TELEMETRY_DISABLED=1
ARG NEXT_PUBLIC_DEMO_MODE=false
ENV NEXT_PUBLIC_DEMO_MODE=$NEXT_PUBLIC_DEMO_MODE
# Next bakes rewrites at BUILD time: the API address must be a build arg
ARG API_INTERNAL_URL=http://api:4000
ENV API_INTERNAL_URL=$API_INTERNAL_URL
RUN npm run build -w @damez/web

FROM node:22-alpine AS runner
WORKDIR /repo
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
RUN addgroup -S app && adduser -S app -G app
COPY --from=build --chown=app:app /repo/apps/web/.next/standalone ./
COPY --from=build --chown=app:app /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=app:app /repo/apps/web/public ./apps/web/public
USER app
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
