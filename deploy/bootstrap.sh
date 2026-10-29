#!/usr/bin/env bash
# One-time setup of a fresh Ubuntu 24.04 server, run as root:
#
#   curl -fsSL https://raw.githubusercontent.com/maximumskif/newcodelaunch/main/deploy/bootstrap.sh -o bootstrap.sh
#   PLATFORM_FEE_RECIPIENT=0x... PLATFORM_SOLANA_FEE_RECIPIENT=... ETHERSCAN_API_KEY=... HELIUS_API_KEY=... PINATA_JWT=... bash bootstrap.sh [domain]
#
# PLATFORM_FEE_RECIPIENT, the EVM wallet bonding curves pay the platform's 0.7% (of a 1% fee) to,
# and PLATFORM_SOLANA_FEE_RECIPIENT, the Solana wallet NFT drops pay their
# 0.01 SOL fee per mint to, are required for a first run: without them the
# backend refuses curve launches and drops.
#
# TELEGRAM_BOT_TOKEN (from @BotFather) is optional and turns on the launch
# bot, and TELEGRAM_ANNOUNCE_CHAT (a channel's @username) the launch channel; then run `docker compose exec backend flask telegram-set-webhook`
# once (see docs/OPERATIONS.md).
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
FEE_RECIPIENT="${PLATFORM_FEE_RECIPIENT:-}"
SOLANA_FEE_RECIPIENT="${PLATFORM_SOLANA_FEE_RECIPIENT:-}"

# Checked before installing anything. A re-run keeps the existing backend/.env.
if [ ! -f "$APP_DIR/backend/.env" ] && [ -z "$FEE_RECIPIENT" ]; then
  echo "Set PLATFORM_FEE_RECIPIENT to the platform's EVM fee wallet (0x...)." >&2
  exit 1
fi
if [ -n "$FEE_RECIPIENT" ] && ! [[ "$FEE_RECIPIENT" =~ ^0x[0-9a-fA-F]{40}$ ]]; then
  echo "PLATFORM_FEE_RECIPIENT isn't an EVM address: $FEE_RECIPIENT" >&2
  exit 1
fi
if [ ! -f "$APP_DIR/backend/.env" ] && [ -z "$SOLANA_FEE_RECIPIENT" ]; then
  echo "Set PLATFORM_SOLANA_FEE_RECIPIENT to the platform's Solana fee wallet." >&2
  exit 1
fi
# Base58, 32 to 44 characters; the backend checks it fully when a drop launches.
if [ -n "$SOLANA_FEE_RECIPIENT" ] && ! [[ "$SOLANA_FEE_RECIPIENT" =~ ^[1-9A-HJ-NP-Za-km-z]{32,44}$ ]]; then
  echo "PLATFORM_SOLANA_FEE_RECIPIENT isn't a Solana address: $SOLANA_FEE_RECIPIENT" >&2
  exit 1
fi

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
PLATFORM_FEE_RECIPIENT=$FEE_RECIPIENT
PLATFORM_SOLANA_FEE_RECIPIENT=$SOLANA_FEE_RECIPIENT
PUBLIC_APP_URL=https://$DOMAIN
PUBLIC_API_URL=https://$DOMAIN
TELEGRAM_BOT_TOKEN=${TELEGRAM_BOT_TOKEN:-}
TELEGRAM_ANNOUNCE_CHAT=${TELEGRAM_ANNOUNCE_CHAT:-}
TELEGRAM_WEBHOOK_SECRET=$(secret)
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
