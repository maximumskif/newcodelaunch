# Not build-verified in this sandbox — no Docker available here. Node
# version matches CI's pinned version (see .github/workflows/ci.yml) and
# README's setup instructions. Build and smoke-test this (`docker build .`,
# then load the page and confirm client-side routing works on a hard
# refresh of a non-root route) before relying on it for a real deploy.
FROM node:24-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
# --ignore-scripts: @solana/wallet-adapter-wallets pulls in @trezor/transport,
# which depends on `usb` — a native Node module with no prebuilt binary for
# this platform, so its install script tries to compile it via node-gyp,
# which needs Python/build tools this Alpine stage doesn't have (found by
# actually running this build for the first time, 2026-09-15 — see
# docs/REBUILD_PROGRESS.md). Safe to skip entirely: `usb` is a Node-runtime
# USB binding for hardware-wallet communication outside a browser (Electron,
# etc) — Trezor's actual browser integration uses WebUSB, a browser API, not
# this native binding, so nothing Vite bundles for the browser needs it built.
RUN npm ci --ignore-scripts

COPY . .

# Vite inlines import.meta.env.VITE_* at build time, not read at container
# runtime like a backend env var — without these, a real deploy would
# silently ship a static bundle hardcoded to VITE_API_BASE_URL's dev
# default (http://localhost:5000/api), broken for anyone but localhost.
# Pass the real values via --build-arg at image-build time, e.g.:
#   docker build --build-arg VITE_API_BASE_URL=https://api.example.com/api .
#
# The RPC overrides are all optional (see .env.example / src/lib/rpcUrls.ts)
# — an unpassed one bakes in an empty string, which rpcUrls.ts treats as
# "use the public default".
ARG VITE_API_BASE_URL
ARG VITE_SOLANA_RPC_URL
ARG VITE_SOLANA_DEVNET_RPC_URL
ARG VITE_SEPOLIA_RPC_URL
ARG VITE_ETHEREUM_RPC_URL
ARG VITE_POLYGON_AMOY_RPC_URL
ARG VITE_POLYGON_RPC_URL
ARG VITE_BSC_TESTNET_RPC_URL
ARG VITE_BSC_RPC_URL
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL} \
    VITE_SOLANA_RPC_URL=${VITE_SOLANA_RPC_URL} \
    VITE_SOLANA_DEVNET_RPC_URL=${VITE_SOLANA_DEVNET_RPC_URL} \
    VITE_SEPOLIA_RPC_URL=${VITE_SEPOLIA_RPC_URL} \
    VITE_ETHEREUM_RPC_URL=${VITE_ETHEREUM_RPC_URL} \
    VITE_POLYGON_AMOY_RPC_URL=${VITE_POLYGON_AMOY_RPC_URL} \
    VITE_POLYGON_RPC_URL=${VITE_POLYGON_RPC_URL} \
    VITE_BSC_TESTNET_RPC_URL=${VITE_BSC_TESTNET_RPC_URL} \
    VITE_BSC_RPC_URL=${VITE_BSC_RPC_URL}

RUN npm run build

FROM nginx:1.27-alpine

COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
