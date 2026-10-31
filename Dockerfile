# ==============================================================================
# FleetWise — Production Dockerfile
# Multi-stage build targeting Node 22 Alpine for minimal footprint & node:sqlite support
# ==============================================================================

# Stage 1: Dependency builder
FROM node:22-alpine AS builder
WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

# Stage 2: Final runtime container
FROM node:22-alpine
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV DB_PATH=/data/fleetwise.db
ENV STORAGE_DIR=/data/proofs
ENV BACKUP_DIR=/data/backups

# Create volume mount directory and assign permissions to non-root node user
RUN mkdir -p /data/proofs /data/backups && chown -R node:node /data

# Copy production node_modules from builder stage
COPY --from=builder /app/node_modules ./node_modules

# Copy application source code
COPY . .

# Set proper ownership for application files
RUN chown -R node:node /app

# Switch to non-root user
USER node

# Expose server port
EXPOSE 3000

# Health check using native Node.js fetch against liveness probe
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://localhost:' + (process.env.PORT || 3000) + '/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

# Start FleetWise server
CMD ["node", "src/server.js"]
