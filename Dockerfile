# Multi-stage build for ai-feature-pipeline CLI
# Targets Node v24 (Active LTS as of December 2025)

# Build stage
FROM node:24-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Copy source code BEFORE installing (to avoid prepare script running without source)
COPY tsconfig.json ./
COPY src ./src

# Install all dependencies (including dev for build)
# This will trigger prepare script which will build
RUN npm install

# Production stage
FROM node:24-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install production dependencies only (skip prepare script)
RUN npm install --omit=dev --ignore-scripts

# Copy built artifacts from builder
COPY --from=builder /app/dist ./dist

# Copy bin directory
COPY bin ./bin

# Create non-root user for security
RUN addgroup -g 1001 -S aifeature && \
    adduser -S aifeature -u 1001 && \
    chown -R aifeature:aifeature /app

USER aifeature

# Set entrypoint
ENTRYPOINT ["node", "./bin/run.js"]

# Default to help command
CMD ["--help"]

# Metadata
LABEL maintainer="CodeMachine Team"
LABEL description="Autonomous AI-powered feature development pipeline CLI"
LABEL version="0.1.0"
LABEL org.opencontainers.image.source="https://github.com/codemachine/ai-feature-pipeline"
