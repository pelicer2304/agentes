# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Install prisma CLI globally for generate/migrate commands
RUN npm install -g prisma@5

# Copy all package files
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/

# Install ALL dependencies
RUN npm ci

# Copy API source code
COPY apps/api/ ./apps/api/

# Generate Prisma Client
RUN prisma generate --schema=apps/api/prisma/schema.prisma

# Build NestJS application
RUN npm run build -w apps/api

# Production stage
FROM node:20-alpine AS production

WORKDIR /app

# Install prisma CLI for runtime migrations
RUN npm install -g prisma@5

# Copy package files
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/

# Install production dependencies only
RUN npm ci --omit=dev

# Copy generated Prisma Client from builder
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma

# Copy Prisma schema and migrations
COPY apps/api/prisma ./apps/api/prisma

# Copy built application
COPY --from=builder /app/apps/api/dist ./apps/api/dist

# Expose API port
EXPOSE 3001

# Run migrations and start
CMD ["sh", "-c", "prisma migrate deploy --schema=apps/api/prisma/schema.prisma && node apps/api/dist/main"]
