# Multi-stage build for Stellar Memory
# Stage 1: Build backend + web
FROM node:22-slim AS builder

WORKDIR /app

# Install backend dependencies
COPY package*.json ./
RUN npm ci

# Copy and build backend (TypeScript → dist/)
COPY tsconfig.json ./
COPY scripts/ ./scripts/
COPY src/ ./src/
RUN npm run build

# Build web dashboard
COPY web/package*.json ./web/
RUN cd web && npm ci

COPY web/ ./web/
RUN cd web && npm run build

# Stage 2: Runtime image
FROM node:22-slim

WORKDIR /app

# Copy built artifacts
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/web/dist ./web/dist
COPY --from=builder /app/node_modules ./node_modules
COPY package.json ./

# Port for the REST API + web dashboard
EXPOSE 21547

# Persistent data volume (SQLite DB + model cache)
VOLUME ["/data"]

# Environment defaults
ENV STELLAR_DB_PATH=/data/stellar.db
ENV STELLAR_API_PORT=21547
ENV STELLAR_PROJECT=default
ENV STELLAR_SUN_TOKEN_BUDGET=800
ENV STELLAR_DECAY_HALF_LIFE=72
ENV STELLAR_WEIGHT_RECENCY=0.30
ENV STELLAR_WEIGHT_FREQUENCY=0.20
ENV STELLAR_WEIGHT_IMPACT=0.30
ENV STELLAR_WEIGHT_RELEVANCE=0.20
# Cache transformers model in the volume so it persists across restarts
ENV TRANSFORMERS_CACHE=/data/.cache

CMD ["node", "dist/api/server.js"]
