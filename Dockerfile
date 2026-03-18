# ─────────────────────────────────────────────────────────────────────────────
# AXIS Agent Server — Docker image
# ─────────────────────────────────────────────────────────────────────────────
FROM node:20-slim

# Install system Chromium + Playwright OS dependencies
# Using system chromium keeps the image lean (~200MB vs ~600MB with Playwright download)
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    ca-certificates \
    fonts-liberation \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxkbcommon0 \
    libxrandr2 \
    libxss1 \
    libxtst6 \
    wget \
    xdg-utils \
    && rm -rf /var/lib/apt/lists/*

# Tell Playwright to use system chromium — no download needed
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium

# Workspace: the full openclawOcean repo is mounted here at runtime
# This lets SOUL.md, MEMORY.md, memory/ etc. live on the host and be git-pullable
ENV WORKSPACE_DIR=/workspace
WORKDIR /workspace

# ── Install agent dependencies (cached layer) ─────────────────────────────────
# Copy only package files first so this layer rebuilds only on dep changes
COPY agent/package.json agent/package-lock.json* /app-deps/
RUN cd /app-deps && npm install --omit=dev

# ── Copy agent source ──────────────────────────────────────────────────────────
# Agent code goes to /app; workspace files (SOUL.md etc.) are mounted at runtime
COPY agent/ /app/
RUN cp -r /app-deps/node_modules /app/node_modules

WORKDIR /app

EXPOSE 3000 8443

# Healthcheck
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/ || exit 1

CMD ["node", "server.js"]
