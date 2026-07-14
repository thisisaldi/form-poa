FROM node:20-alpine AS base

RUN addgroup --gid 1001 --system nodejs && \
    adduser --system --uid 1001 --ingroup nodejs appuser

WORKDIR /app

# Copy common dir
COPY --chown=appuser:nodejs ./scripts ./scripts/
COPY --chown=appuser:nodejs ./public ./public/
COPY --chown=appuser:nodejs ./prisma ./prisma/

RUN chown -R appuser:nodejs /app

# ===========================================================================
# Note:
# Below is the target to build, please enabled Docker BuildKit by setting
# DOCKER_BUILDKIT=1 in environment variable, then give the build command
# an argument to choose which target to be build.
# ===========================================================================

# ========================================
# Development only stage
# ========================================
FROM base AS development

# Copy standalone server file
COPY --chown=appuser:nodejs \
    ./dist/development/standalone/server.js \
    ./development-server.js

# Copy standalone dist dir
COPY --chown=appuser:nodejs \
    ./dist/development/standalone/dist \
    ./dist

# Copy static dir
COPY --chown=appuser:nodejs \
    ./dist/development/static/ \
    ./dist/development/static/

# Copy node modules
COPY --chown=appuser:nodejs \
    ./dist/development/standalone/node_modules/ \
    ./node_modules/

USER appuser

ENTRYPOINT [ "sh", "./scripts/start.sh" ]

# ========================================
# Staging and Production stage
# ========================================
FROM base AS staging-production

# Copy standalone server file
COPY --chown=appuser:nodejs \
    ./dist/staging/standalone/server.js \
    ./staging-server.js
COPY --chown=appuser:nodejs \
    ./dist/production/standalone/server.js \
    ./production-server.js

# Copy standalone dist dir
COPY --chown=appuser:nodejs \
    ./dist/staging/standalone/dist \
    ./dist
COPY --chown=appuser:nodejs \
    ./dist/production/standalone/dist \
    ./dist

# Copy static dir
COPY --chown=appuser:nodejs ./dist/staging/static/ ./dist/staging/static/
COPY --chown=appuser:nodejs ./dist/production/static/ ./dist/production/static/

# Copy node modules
COPY --chown=appuser:nodejs \
    ./dist/production/standalone/node_modules/ \
    ./node_modules/

USER appuser

ENTRYPOINT [ "sh", "./scripts/start.sh" ]
