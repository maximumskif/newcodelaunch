# Not build-verified in this sandbox — no Docker available here. Node
# version matches CI's pinned version (see .github/workflows/ci.yml) and
# README's setup instructions. Build and smoke-test this (`docker build .`,
# then load the page and confirm client-side routing works on a hard
# refresh of a non-root route) before relying on it for a real deploy.
FROM node:24-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Vite inlines import.meta.env.VITE_* at build time, not read at container
# runtime like a backend env var — without these, a real deploy would
# silently ship a static bundle hardcoded to VITE_API_BASE_URL's dev
# default (http://localhost:5000/api), broken for anyone but localhost.
# Pass the real values via --build-arg at image-build time, e.g.:
#   docker build --build-arg VITE_API_BASE_URL=https://api.example.com/api .
ARG VITE_API_BASE_URL
ARG VITE_SOLANA_RPC_URL
ARG VITE_SEPOLIA_RPC_URL
ARG VITE_SOLANA_DEVNET_RPC_URL
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL} \
    VITE_SOLANA_RPC_URL=${VITE_SOLANA_RPC_URL} \
    VITE_SEPOLIA_RPC_URL=${VITE_SEPOLIA_RPC_URL} \
    VITE_SOLANA_DEVNET_RPC_URL=${VITE_SOLANA_DEVNET_RPC_URL}

RUN npm run build

FROM nginx:1.27-alpine

COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
