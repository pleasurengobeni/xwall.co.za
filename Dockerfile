FROM node:22-alpine AS base

WORKDIR /app

RUN addgroup -S xwall && adduser -S xwall -G xwall

# Install dependencies first (cached layer)
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy app source with runtime ownership already set
COPY --chown=xwall:xwall . .
USER xwall

EXPOSE 3000

ENV NODE_ENV=production

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:3000/ping').then((res) => process.exit(res.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "server.js"]
