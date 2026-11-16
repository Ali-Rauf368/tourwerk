# syntax=docker/dockerfile:1
# Multi-stage build. Targets: `api` (Node + native optimizer/simulator) and `web` (nginx).

# ---- dependencies (all workspaces) ----
FROM node:24-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY e2e/package.json e2e/
RUN npm ci

# ---- build: C/C++ binaries (+ their tests), API (tsc), web (vite) ----
FROM deps AS build
RUN apt-get update && apt-get install -y --no-install-recommends g++ make && rm -rf /var/lib/apt/lists/*
COPY . .
RUN make -C native && make -C native test \
 && npm -w apps/api run build \
 && npm -w apps/web run build

# ---- API runtime ----
FROM node:24-bookworm-slim AS api
ENV NODE_ENV=production PORT=4600
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY e2e/package.json e2e/
RUN npm ci -w apps/api --omit=dev && npm cache clean --force
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/apps/api/prisma apps/api/prisma
COPY --from=build /app/apps/api/prisma.config.ts apps/api/
COPY --from=build /app/native/build/tw-optimizer /app/native/build/tw-tracker native/build/
USER node
WORKDIR /app/apps/api
EXPOSE 4600
HEALTHCHECK --interval=15s --timeout=3s --start-period=40s \
  CMD node -e "fetch('http://localhost:4600/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/server.js"]

# ---- web: static build behind nginx, proxying /api and WebSockets ----
FROM nginx:1.27-alpine AS web
COPY integration/docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
