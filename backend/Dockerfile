FROM node:24

ARG VERSION=9.0.0
LABEL org.opencontainers.image.title="GetCito Server"
LABEL org.opencontainers.image.version=$VERSION
LABEL org.opencontainers.image.source="https://github.com/ai-search-guru/getcito-worlds-first-open-source-aio-aeo-or-geo-tool"
LABEL org.opencontainers.image.licenses="MIT"

WORKDIR /getcito-server

COPY package.json package-lock.json ./

RUN npm ci --omit=dev

COPY . .

# Production default — keeps prod log level at info and enables the socket
# origin check. Note: an env_file that sets NODE_ENV overrides this, so
# deployment .env files must not pin NODE_ENV=development.
ENV NODE_ENV=production

EXPOSE 80

CMD ["node", "src/apiServer.js"]
