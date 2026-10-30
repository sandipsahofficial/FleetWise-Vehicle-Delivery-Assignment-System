# ==============================================================================
# FleetWise — Production Dockerfile
# Multi-stage build targeting Node 22 Alpine for minimal footprint & node:sqlite support
# ==============================================================================

# Build stage
FROM node:22-alpine AS builder
WORKDIR /app

# Install build dependencies
COPY package*.json ./
RUN npm ci --only=production

# Final runtime stage
FROM node:22-alpine
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# Copy node_modules and project source
COPY --from=builder /app/node_modules ./node_modules
COPY . .

# Ensure data directory exists and assign non-root permissions
RUN mkdir -p /app/data && chown -R node:node /app

# Switch to non-root user
USER node

# Expose HTTP port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

CMD ["node", "src/server.js"]

