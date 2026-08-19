# syntax=docker/dockerfile:1

# Three stages: install once, build once, ship only what runs. The runner
# carries no package manager, no source and no dev dependencies, which is the
# difference between an image you can deploy and one you apologise for.

FROM node:22-alpine AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# Cache mount keeps the pnpm store between builds; --frozen-lockfile makes a
# stale lockfile a build failure rather than a silent version drift.
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    PNPM_HOME=/pnpm pnpm install --frozen-lockfile

FROM node:22-alpine AS builder
WORKDIR /app
RUN corepack enable
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Next reads env at build time for some config. These are placeholders: no
# database is contacted during a build, and the real values arrive at runtime.
ENV DATABASE_URL=postgres://build:build@localhost:5432/build \
    AUTH_SECRET=build-time-placeholder \
    NEXT_TELEMETRY_DISABLED=1
# BUILD_STANDALONE is what switches on the standalone output the runner needs.
RUN BUILD_STANDALONE=1 pnpm build && pnpm build:migrate

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# Run as a non-root user. The image has nothing to write to anyway, but a
# container that cannot escalate is one less thing to think about.
RUN addgroup -g 1001 -S nodejs && adduser -S boardyn -u 1001

COPY --from=builder --chown=boardyn:nodejs /app/.next/standalone ./
# Static assets are not traced into standalone; they have to come across
# explicitly. There is no public/ directory: the favicon is app/icon.svg, which
# Next compiles into the build like any other route.
COPY --from=builder --chown=boardyn:nodejs /app/.next/static ./.next/static
# The migration runner and the SQL it applies. Bundled to a single file so the
# runner needs neither tsx nor the drizzle toolchain.
COPY --from=builder --chown=boardyn:nodejs /app/dist/migrate.cjs ./migrate.cjs
COPY --from=builder --chown=boardyn:nodejs /app/drizzle ./drizzle
COPY --chown=boardyn:nodejs docker/entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh

USER boardyn
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["./entrypoint.sh"]
CMD ["node", "server.js"]
