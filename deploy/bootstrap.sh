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
# WALLETCONNECT_PROJECT_ID (free, from dashboard.reown.com) is optional and
# lets phone wallets connect through WalletConnect.
#
# OPERATOR_NAME and LEGAL_CONTACT (an email address) are shown on /terms,
# /privacy and /risks; without them those pages say the details are to come.
#
# X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN and X_ACCESS_TOKEN_SECRET (from the
# X developer portal) are optional and post each new launch to the platform's X account.
#
# Installs Docker and a firewall (SSH, HTTP, HTTPS only), clones the repo to
# /opt/newcodelaunch, writes the three env files with freshly generated
# secrets (never overwriting existing ones), and starts the stack. With no
# domain it uses <server-ip>.sslip.io, a public DNS name that resolves to
# the IP inside it, so HTTPS works before you own a domain.
#
# Also installs a systemd timer that runs deploy/watchdog.sh every minute;
# set ALERT_TELEGRAM_CHAT (a chat id or @channel the bot can post in) to get
# its alerts on Telegram. And one that runs deploy/backup.sh daily. Set
# BACKUP_REMOTE in deploy/.env (an rclone destination, after `rclone config`)
# so the backups leave the server; see docs/OPERATIONS.md, "Backups".
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
apt-get install -y -q docker.io docker-compose-v2 git ufw openssl curl rclone
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
VITE_WALLETCONNECT_PROJECT_ID=${WALLETCONNECT_PROJECT_ID:-}
VITE_OPERATOR_NAME=${OPERATOR_NAME:-}
VITE_LEGAL_CONTACT=${LEGAL_CONTACT:-}
BACKUP_REMOTE=${BACKUP_REMOTE:-}
ALERT_TELEGRAM_CHAT=${ALERT_TELEGRAM_CHAT:-}
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
X_API_KEY=${X_API_KEY:-}
X_API_SECRET=${X_API_SECRET:-}
X_ACCESS_TOKEN=${X_ACCESS_TOKEN:-}
X_ACCESS_TOKEN_SECRET=${X_ACCESS_TOKEN_SECRET:-}
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

# Daily backup at 03:30 UTC, plus up to 30 minutes' jitter. Persistent=true
# runs a missed one after the server was off.
cat > /etc/systemd/system/newcodelaunch-backup.service <<UNIT
[Unit]
Description=Back up the newcodelaunch database and uploads
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
ExecStart=/usr/bin/bash $APP_DIR/deploy/backup.sh
UNIT
cat > /etc/systemd/system/newcodelaunch-backup.timer <<'UNIT'
[Unit]
Description=Daily newcodelaunch backup

[Timer]
OnCalendar=*-*-* 03:30:00 UTC
RandomizedDelaySec=30m
Persistent=true

[Install]
WantedBy=timers.target
UNIT
# Health and error watchdog every minute (deploy/watchdog.sh). Alerts reach
# Telegram once ALERT_TELEGRAM_CHAT is set in deploy/.env.
cat > /etc/systemd/system/newcodelaunch-watchdog.service <<UNIT
[Unit]
Description=Check newcodelaunch health and errors
After=docker.service

[Service]
Type=oneshot
ExecStart=/usr/bin/bash $APP_DIR/deploy/watchdog.sh
UNIT
cat > /etc/systemd/system/newcodelaunch-watchdog.timer <<'UNIT'
[Unit]
Description=Run the newcodelaunch watchdog every minute

[Timer]
OnBootSec=2min
OnUnitActiveSec=1min
AccuracySec=5s

[Install]
WantedBy=timers.target
UNIT

systemctl daemon-reload
systemctl enable --now newcodelaunch-backup.timer newcodelaunch-watchdog.timer

bash deploy/update.sh
