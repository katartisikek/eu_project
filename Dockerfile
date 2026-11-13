# ==============================================================================
# Dockerfile for TIHC Dissemination Monitoring & Reporting Platform
# Technical Schools of the Chamber of Heraklion (TIHC)
# Base Image: Node 22 Alpine (Lightweight, Secure, includes built-in node:sqlite)
# ==============================================================================

FROM node:22-alpine

# Set working directory
WORKDIR /app

# Set production environment variables
ENV NODE_ENV=production \
    PORT=3080 \
    HOST=0.0.0.0

# Copy application manifest
COPY package.json ./

# Copy application source code and assets
COPY server.js ./
COPY src/ ./src/
COPY public/ ./public/
COPY seed/ ./seed/

# Create persistent storage directories
RUN mkdir -p /app/data /app/uploads /app/exports

# Default copy of initial database if mounted volume is initially empty
COPY data/ /app/data_seed/
COPY uploads/ /app/uploads_seed/

# Entrypoint script to populate empty persistent volumes on first run
RUN printf '#!/bin/sh\n\
if [ ! -f /app/data/dissemination_platform.sqlite ]; then\n\
  echo "[INIT] Initializing fresh SQLite database from seed..."\n\
  cp -rn /app/data_seed/* /app/data/ 2>/dev/null || true\n\
fi\n\
if [ -d /app/uploads_seed ]; then\n\
  echo "[INIT] Syncing initial evidence uploads..."\n\
  cp -rn /app/uploads_seed/* /app/uploads/ 2>/dev/null || true\n\
fi\n\
exec node server.js\n' > /app/entrypoint.sh && chmod +x /app/entrypoint.sh

# Expose HTTP port
EXPOSE 3080

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:3080/api/health || exit 1

# Start server via entrypoint script
ENTRYPOINT ["/app/entrypoint.sh"]

