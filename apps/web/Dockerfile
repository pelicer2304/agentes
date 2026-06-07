# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Copy root package files for workspace resolution
COPY package.json package-lock.json ./
COPY apps/web/package.json ./apps/web/

# Install dependencies
RUN npm ci --workspace=apps/web --include-workspace-root

# Copy web source code
COPY apps/web/ ./apps/web/

# Public API URL is baked into the Vite bundle at BUILD time. Passed from
# docker-compose (build arg) so the frontend calls the real API domain instead
# of the localhost fallback in apps/web/src/api/client.ts.
ARG VITE_API_URL
ENV VITE_API_URL=${VITE_API_URL}

# Build Vite application
RUN npm run build -w apps/web

# Production stage
FROM node:20-alpine AS production

WORKDIR /app

# Install a simple static file server
RUN npm install -g serve@14

# Copy built static files from builder
COPY --from=builder /app/apps/web/dist ./dist

# Expose web port
EXPOSE 3000

# Serve the static files on port 3000
CMD ["serve", "-s", "dist", "-l", "3000"]
