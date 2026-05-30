# syntax=docker/dockerfile:1.7
#
# icaro web — Next 16 SPA (issue #16).
#
# BUILD CONTEXT IS apps/web (the web is self-contained; it imports nothing from
# the rest of the monorepo):
#
#   docker build -f apps/web/Dockerfile -t icaro-web apps/web
#
# Uses Next's `output: "standalone"` (next.config.ts) → a minimal server.js with
# only the traced runtime deps. The browser talks to this server same-origin;
# the server proxies /api/* to ICARO_API_ORIGIN (a RUNTIME env, read at boot in
# next.config.ts rewrites()).

# --- deps --------------------------------------------------------------------
FROM node:20-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# --- build -------------------------------------------------------------------
FROM node:20-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# --- runtime -----------------------------------------------------------------
FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=8080 \
    HOSTNAME=0.0.0.0

# Run as non-root.
RUN addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 nextjs

# Standalone bundle: server.js + minimal node_modules, then the static assets
# and public/ it serves (these live outside the traced bundle by design).
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=build --chown=nextjs:nodejs /app/public ./public

USER nextjs

# Cloud Run sends traffic to $PORT (default 8080); server.js honours PORT/HOSTNAME.
EXPOSE 8080
CMD ["node", "server.js"]
