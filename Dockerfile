# Multi-stage build for codemachine-pipeline CLI
# Targets Node v24 (Active LTS as of December 2025)

# Build stage
FROM node:24-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Copy source code BEFORE installing (to avoid prepare script running without source)
COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts

# Install all dependencies (including dev for build)
# This will trigger prepare script which will build
ENV OCLIF_SKIP_MANIFEST=1
RUN npm ci

# Production stage
FROM node:24-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install production dependencies only (skip prepare script)
RUN npm ci --omit=dev --ignore-scripts

# Copy built artifacts from builder
COPY --from=builder /app/dist ./dist

# Copy bin directory
COPY bin ./bin

# Create non-root user for security
RUN addgroup -g 1001 -S codepipe && \
    adduser -S codepipe -u 1001 && \
    chown -R codepipe:codepipe /app

USER codepipe

# Set entrypoint
ENTRYPOINT ["node", "./bin/run.js"]

# Default to help command
CMD ["--help"]

# Metadata
LABEL maintainer="CodeMachine Team"
LABEL description="Autonomous AI-powered feature development pipeline CLI"
LABEL version="1.0.0"
LABEL org.opencontainers.image.source="https://github.com/codemachine/codemachine-pipeline"
