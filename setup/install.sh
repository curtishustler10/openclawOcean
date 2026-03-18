#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# AXIS Agent Server — Fresh Droplet Installer
# Tested on: Ubuntu 22.04 / 24.04 LTS
# Run as root or with sudo
# Usage: curl -fsSL <raw-url> | bash
#   or:  git clone ... && cd openclawOcean && sudo bash setup/install.sh
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

REPO_URL="https://github.com/curtishustler10/openclawOcean.git"
INSTALL_DIR="/home/axis/openclawOcean"
SERVICE_USER="axis"
NODE_VERSION="20"
BRANCH="claude/ai-agent-server-plan-4k5o2"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
log()  { echo -e "${GREEN}[axis]${NC} $*"; }
warn() { echo -e "${YELLOW}[warn]${NC} $*"; }
err()  { echo -e "${RED}[err]${NC} $*"; exit 1; }

# ── 0. Must run as root ───────────────────────────────────────────────────────
[[ $EUID -ne 0 ]] && err "Run as root: sudo bash setup/install.sh"

# ── 1. System update ──────────────────────────────────────────────────────────
log "Updating system packages..."
apt-get update -qq
apt-get install -y -qq \
  git curl wget ca-certificates gnupg build-essential \
  python3 python3-pip \
  chromium-browser \
  libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libgtk-3-0 \
  libgbm1 libasound2 libxss1 libxtst6 fonts-liberation

# ── 2. Create system user ─────────────────────────────────────────────────────
if ! id "$SERVICE_USER" &>/dev/null; then
  log "Creating user: $SERVICE_USER"
  useradd -m -s /bin/bash "$SERVICE_USER"
fi

# ── 3. Install Node.js 20 LTS ─────────────────────────────────────────────────
if ! command -v node &>/dev/null || [[ "$(node -v | cut -d. -f1 | tr -d 'v')" -lt "$NODE_VERSION" ]]; then
  log "Installing Node.js ${NODE_VERSION}..."
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_VERSION}.x" | bash -
  apt-get install -y nodejs
fi
log "Node.js: $(node -v) | npm: $(npm -v)"

# ── 4. Clone / update repo ────────────────────────────────────────────────────
if [[ -d "$INSTALL_DIR/.git" ]]; then
  log "Updating existing repo..."
  sudo -u "$SERVICE_USER" git -C "$INSTALL_DIR" fetch origin
  sudo -u "$SERVICE_USER" git -C "$INSTALL_DIR" checkout "$BRANCH"
  sudo -u "$SERVICE_USER" git -C "$INSTALL_DIR" pull origin "$BRANCH"
else
  log "Cloning repo to $INSTALL_DIR..."
  sudo -u "$SERVICE_USER" git clone --branch "$BRANCH" "$REPO_URL" "$INSTALL_DIR"
fi

# ── 5. Install agent dependencies ─────────────────────────────────────────────
log "Installing agent npm dependencies..."
cd "$INSTALL_DIR/agent"
sudo -u "$SERVICE_USER" npm install --omit=dev

# ── 6. Install Playwright browsers ───────────────────────────────────────────
log "Installing Playwright Chromium..."
cd "$INSTALL_DIR/agent"
PLAYWRIGHT_BROWSERS_PATH="/home/$SERVICE_USER/.cache/ms-playwright" \
  sudo -u "$SERVICE_USER" -E npx playwright install chromium --with-deps || {
  warn "Playwright install failed — browser tools will be unavailable"
}

# ── 7. Set up .env ────────────────────────────────────────────────────────────
ENV_FILE="$INSTALL_DIR/.env"
if [[ ! -f "$ENV_FILE" ]]; then
  log "Creating .env from template..."
  cp "$INSTALL_DIR/.env.example" "$ENV_FILE"
  chown "$SERVICE_USER:$SERVICE_USER" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  warn ""
  warn "ACTION REQUIRED: Edit $ENV_FILE and add your API keys:"
  warn "  ANTHROPIC_API_KEY=sk-ant-..."
  warn "  TELEGRAM_CHAT_ID=<your chat ID>"
  warn ""
else
  log ".env already exists — skipping"
fi

# ── 8. Set up systemd service ─────────────────────────────────────────────────
log "Creating systemd service: axis-agent"

cat > /etc/systemd/system/axis-agent.service << EOF
[Unit]
Description=AXIS Autonomous AI Agent Server
After=network.target
Wants=network-online.target

[Service]
Type=simple
User=$SERVICE_USER
WorkingDirectory=$INSTALL_DIR/agent
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=axis-agent
Environment=NODE_ENV=production
Environment=WORKSPACE_DIR=$INSTALL_DIR
Environment=PLAYWRIGHT_BROWSERS_PATH=/home/$SERVICE_USER/.cache/ms-playwright

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable axis-agent

# ── 9. Set permissions ────────────────────────────────────────────────────────
chown -R "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR"

# ── 10. UFW firewall ──────────────────────────────────────────────────────────
if command -v ufw &>/dev/null; then
  log "Configuring firewall..."
  ufw allow ssh
  ufw allow 3000/tcp comment 'AXIS agent API'
  ufw allow 8443/tcp comment 'Telegram webhook'
  ufw --force enable
fi

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
log " AXIS Agent Server installed"
log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "  Install dir:  $INSTALL_DIR"
echo "  Service:      axis-agent (systemd)"
echo "  API port:     3000"
echo ""
echo "  Next steps:"
echo ""
echo "  1. Edit your API keys:"
echo "     nano $ENV_FILE"
echo ""
echo "  2. Start the agent:"
echo "     systemctl start axis-agent"
echo ""
echo "  3. Watch logs:"
echo "     journalctl -u axis-agent -f"
echo ""
echo "  4. Test the API:"
echo "     curl -X POST http://localhost:3000/task \\"
echo "       -H 'Content-Type: application/json' \\"
echo "       -d '{\"prompt\": \"List all files in the workspace\"}'"
echo ""
log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
