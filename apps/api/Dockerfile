# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# OpenSSL is required by Prisma's query engine on Alpine/musl.
RUN apk add --no-cache openssl

# Install prisma CLI globally for generate/migrate commands
RUN npm install -g prisma@5

# Copy all package files (workspace root + api package)
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/

# Install ALL dependencies (workspace-aware)
RUN npm ci

# Copy API source code
COPY apps/api/ ./apps/api/

# Generate Prisma Client (into apps/api/node_modules for the workspace)
RUN prisma generate --schema=apps/api/prisma/schema.prisma

# Build NestJS application
RUN npm run build -w apps/api

# Production stage
FROM node:20-alpine AS production

WORKDIR /app

# OpenSSL for the Prisma query engine at runtime.
RUN apk add --no-cache openssl

# Prisma CLI for runtime migrations + client generation
RUN npm install -g prisma@5

# Copy package files
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/

# Install production dependencies only (installs @prisma/client into the workspace)
RUN npm ci --omit=dev

# Copy Prisma schema + migrations, then generate the client in THIS image so the
# engine binary matches the runtime platform and lands in the correct workspace
# node_modules path (apps/api/node_modules/.prisma). This avoids fragile cross-
# stage COPY of the generated client in an npm-workspace layout.
COPY apps/api/prisma ./apps/api/prisma
RUN prisma generate --schema=apps/api/prisma/schema.prisma

# Copy built application from the builder
COPY --from=builder /app/apps/api/dist ./apps/api/dist

# Expose API port
EXPOSE 3001

# Run migrations (non-fatal: a migrate hiccup must not crash the container, so
# the server still starts and /health can respond) then start the app.
CMD ["sh", "-c", "echo 'Running prisma migrate deploy...'; prisma migrate deploy --schema=apps/api/prisma/schema.prisma || echo 'WARNING: prisma migrate deploy failed; starting API anyway'; echo 'Starting API...'; node apps/api/dist/main"]
