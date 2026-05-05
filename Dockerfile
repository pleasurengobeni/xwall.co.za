FROM node:20-alpine AS base

WORKDIR /app

# Install dependencies first (cached layer)
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

# Copy app source
COPY . .

# Non-root user for security
RUN addgroup -S xwall && adduser -S xwall -G xwall \
    && chown -R xwall:xwall /app
USER xwall

EXPOSE 3000

ENV NODE_ENV=production

CMD ["node", "server.js"]
