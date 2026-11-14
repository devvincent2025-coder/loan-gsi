# Build context = repo root.
# dist/main.js is pre-built locally (apps/api/dist is allow-listed in .dockerignore).
# Only prisma generate runs inside Docker to fetch the linux-musl query engine binary.
FROM node:22-alpine AS base
RUN apk add --no-cache openssl libc6-compat
WORKDIR /app
COPY package.json package-lock.json* tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --ignore-scripts --workspace @damez/shared --workspace @damez/api --include-workspace-root || npm install --ignore-scripts --workspace @damez/shared --workspace @damez/api
COPY packages/shared packages/shared
COPY apps/api apps/api
# Build shared (pure TS, no network). Prisma generate fetches the linux-musl engine binary;
# retry up to 5 times in case of transient network errors.
RUN npm run build -w @damez/shared && \
    cd apps/api && \
    for i in 1 2 3 4 5; do npx prisma generate && break; echo "prisma generate attempt $i failed, retrying..."; sleep 10; done
WORKDIR /app/apps/api
EXPOSE 4000
# migrate -> seed (idempotent) -> start
CMD ["sh", "-c", "npx prisma migrate deploy && npx ts-node --transpile-only prisma/seed.ts && npx ts-node --transpile-only prisma/seed-p2.ts && npx ts-node --transpile-only prisma/seed-p3.ts && node dist/main.js"]
