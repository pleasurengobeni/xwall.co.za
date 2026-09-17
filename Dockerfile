FROM node:22-alpine AS base

WORKDIR /app

RUN addgroup -S xwall && adduser -S xwall -G xwall

# Install dependencies first (cached layer). No production dependency needs an
# install script, so skip them to shrink the supply-chain attack surface.
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

# App source stays owned by root: the runtime user can read but not modify it.
COPY . .
USER xwall

EXPOSE 3000

ENV NODE_ENV=production

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:3000/ping').then((res) => process.exit(res.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "server.js"]
