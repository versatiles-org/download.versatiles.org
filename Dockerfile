# Base Image Setup
FROM node:current-alpine AS base
RUN mkdir -p /app/volumes/
WORKDIR /app
VOLUME ["volumes/remote_files", "volumes/local_files", "volumes/nginx_conf", "volumes/logs"]
CMD ["sh", "-c", "npm run server"]

# ================================
# Build Locally for Development/Testing
# ================================
FROM base AS dev
COPY . /app
RUN npm ci

# ================================
# Build from Git for Production
# ================================
FROM base AS prod
RUN apk add --no-cache git && \
    rm -rf /var/cache/apk/* && \
    git clone https://github.com/versatiles-org/download.versatiles.org.git . && \
    npm ci
