#!/usr/bin/env bash
# One-time setup of a fresh Ubuntu 24.04 server, run as root:
#
#   curl -fsSL https://raw.githubusercontent.com/maximumskif/newcodelaunch/main/deploy/bootstrap.sh -o bootstrap.sh
#   ETHERSCAN_API_KEY=... HELIUS_API_KEY=... PINATA_JWT=... bash bootstrap.sh [domain]
#
# Installs Docker and a firewall (SSH, HTTP, HTTPS only), clones the repo to
# /opt/newcodelaunch, writes the three env files with freshly generated
# secrets (never overwriting existing ones), and starts the stack. With no
# domain it uses <server-ip>.sslip.io, a public DNS name that resolves to
# the IP inside it, so HTTPS works before you own a domain.
#
# Re-running is safe: existing env files are kept. deploy/update.sh
# redeploys after a push.
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/maximumskif/newcodelaunch.git}"
APP_DIR="${APP_DIR:-/opt/newcodelaunch}"

apt-get update -q
apt-get install -y -q docker.io docker-compose-v2 git ufw openssl curl
systemctl enable --now docker

ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw --force enable

if [ ! -d "$APP_DIR/.git" ]; then
  git clone "$REPO_URL" "$APP_DIR"
fi
cd "$APP_DIR"

IP="$(curl -fsS https://api.ipify.org)"
DOMAIN="${1:-$IP.sslip.io}"
secret() { openssl rand -hex 32; }
SHARED_SECRET="$(secret)"
HELIUS="${HELIUS_API_KEY:-}"
MAINNET_RPC="${HELIUS:+https://mainnet.helius-rpc.com/?api-key=$HELIUS}"
DEVNET_RPC="${HELIUS:+https://devnet.helius-rpc.com/?api-key=$HELIUS}"

umask 077
if [ ! -f deploy/.env ]; then
  cat > deploy/.env <<EOF
DOMAIN=$DOMAIN
POSTGRES_PASSWORD=$(secret)
EOF
fi
if [ ! -f backend/.env ]; then
  cat > backend/.env <<EOF
SECRET_KEY=$(secret)
JWT_SECRET_KEY=$(secret)
LOG_LEVEL=INFO
CANDY_MACHINE_SHARED_SECRET=$SHARED_SECRET
ETHERSCAN_API_KEY=${ETHERSCAN_API_KEY:-}
PINATA_JWT=${PINATA_JWT:-}
SOLANA_RPC_URL=$MAINNET_RPC
SOLANA_DEVNET_RPC_URL=$DEVNET_RPC
EOF
fi
if [ ! -f services/candy-machine/.env ]; then
  cat > services/candy-machine/.env <<EOF
PORT=4000
CANDY_MACHINE_SHARED_SECRET=$SHARED_SECRET
SOLANA_MAINNET_RPC_URL=$MAINNET_RPC
SOLANA_DEVNET_RPC_URL=$DEVNET_RPC
EOF
fi

bash deploy/update.sh
