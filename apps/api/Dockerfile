# Build context: repository root (the API depends on the shared workspace package).
FROM node:24-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /repo

FROM base AS build
# Manifests first so the dependency layer is cached until a lockfile changes.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile --filter @docchat/api...
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter @docchat/api build \
 && pnpm --filter @docchat/api deploy --prod --legacy /out

FROM node:24-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /out/package.json ./
COPY --from=build /repo/apps/api/dist ./dist
COPY --from=build /repo/apps/api/drizzle ./drizzle
# Bake the embedding model into the image: containers start fast and need no
# network access to Hugging Face at runtime.
ENV MODEL_CACHE_DIR=/app/models
RUN node dist/scripts/download-model.js
RUN mkdir -p /data/blobs && chown node:node /data/blobs
USER node
EXPOSE 3000
CMD ["node", "--enable-source-maps", "dist/main.js"]
