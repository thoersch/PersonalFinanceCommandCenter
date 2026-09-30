# Builds and runs the NestJS API (apps/api) for Railway.
FROM node:22-slim
WORKDIR /app
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1 \
    NPM_CONFIG_UPDATE_NOTIFIER=false

# Install only the API + shared workspaces (the desktop app isn't needed on the server).
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/desktop/package.json apps/desktop/
RUN npm ci -w @ff/api -w @ff/shared --no-audit --no-fund

COPY packages/shared packages/shared
COPY apps/api apps/api
RUN npm run build -w @ff/shared && npm run build -w @ff/api

ENV NODE_ENV=production
WORKDIR /app/apps/api
EXPOSE 3000
# Migrations in ./drizzle run automatically on boot.
CMD ["node", "dist/main.js"]
