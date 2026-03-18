## ─────────────────────────────────────────────────────────────────────────────
## AXIS Agent — DigitalOcean Snapshot Builder (Packer)
##
## Builds a ready-to-run DO snapshot with:
##   - Node.js 20, npm deps, Playwright Chromium
##   - AXIS agent systemd service (pre-installed, not started)
##   - Claude Code CLI installed
##   - Repo cloned at /home/axis/openclawOcean
##
## Usage:
##   export DIGITALOCEAN_TOKEN=your_do_pat_token
##   export AXIS_REPO_BRANCH=claude/ai-agent-server-plan-4k5o2
##   packer init setup/packer.pkr.hcl
##   packer build setup/packer.pkr.hcl
##
## After build: a snapshot named "axis-agent-<timestamp>" appears in your DO account.
## Spin up a new droplet from it, SSH in, add .env, then: systemctl start axis-agent
## ─────────────────────────────────────────────────────────────────────────────

packer {
  required_plugins {
    digitalocean = {
      version = ">= 1.4.0"
      source  = "github.com/digitalocean/digitalocean"
    }
  }
}

# ── Variables ──────────────────────────────────────────────────────────────────

variable "do_token" {
  type        = string
  default     = env("DIGITALOCEAN_TOKEN")
  description = "DigitalOcean Personal Access Token"
  sensitive   = true
}

variable "repo_url" {
  type    = string
  default = "https://github.com/curtishustler10/openclawOcean.git"
}

variable "repo_branch" {
  type    = string
  default = env("AXIS_REPO_BRANCH") != "" ? env("AXIS_REPO_BRANCH") : "claude/ai-agent-server-plan-4k5o2"
}

variable "region" {
  type    = string
  default = "syd1"   # Sydney — closest to Brisbane
}

variable "droplet_size" {
  type    = string
  default = "s-2vcpu-2gb"  # Build droplet (destroyed after snapshot)
}

# ── Source: DigitalOcean ───────────────────────────────────────────────────────

source "digitalocean" "axis_agent" {
  api_token     = var.do_token
  image         = "ubuntu-22-04-x64"
  region        = var.region
  size          = var.droplet_size
  snapshot_name = "axis-agent-{{timestamp}}"
  snapshot_regions = [var.region]
  ssh_username  = "root"
  tags          = ["axis", "agent", "packer"]
}

# ── Build ──────────────────────────────────────────────────────────────────────

build {
  name    = "axis-agent"
  sources = ["source.digitalocean.axis_agent"]

  # ── 1. Wait for cloud-init + kill apt lock, then install deps ──────────────
  provisioner "shell" {
    inline = [
      # Wait for cloud-init to finish (it holds apt lock on fresh droplets)
      "cloud-init status --wait || true",

      # Kill unattended-upgrades — it runs on boot and holds the dpkg lock
      "systemctl stop unattended-upgrades || true",
      "systemctl disable unattended-upgrades || true",
      "systemctl stop apt-daily.service apt-daily-upgrade.service || true",
      "systemctl disable apt-daily.timer apt-daily-upgrade.timer || true",

      # Wait until dpkg lock is fully released
      "while fuser /var/lib/dpkg/lock-frontend >/dev/null 2>&1; do echo 'waiting for dpkg lock...'; sleep 3; done",
      "while fuser /var/lib/apt/lists/lock >/dev/null 2>&1; do echo 'waiting for apt lock...'; sleep 3; done",

      # Now safe to run apt
      "export DEBIAN_FRONTEND=noninteractive",
      "apt-get update -qq",
      "apt-get install -y -qq git curl wget ca-certificates gnupg build-essential python3 python3-pip",

      # Chromium + Playwright deps
      "apt-get install -y -qq chromium-browser libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2",
      "apt-get install -y -qq libgtk-3-0 libgbm1 libasound2 libxss1 libxtst6 libnspr4 libnss3",
      "apt-get install -y -qq libxcomposite1 libxdamage1 libxfixes3 libxkbcommon0 libxrandr2",
      "apt-get install -y -qq fonts-liberation xdg-utils",
    ]
  }

  # ── 2. Node.js 20 LTS ──────────────────────────────────────────────────────
  provisioner "shell" {
    inline = [
      "curl -fsSL https://deb.nodesource.com/setup_20.x | bash -",
      "apt-get install -y nodejs",
      "echo 'Node.js version:' $(node -v)",
      "echo 'npm version:' $(npm -v)",
    ]
  }

  # ── 3. Claude Code CLI ─────────────────────────────────────────────────────
  provisioner "shell" {
    inline = [
      "npm install -g @anthropic-ai/claude-code || echo 'Claude Code CLI install failed — install manually'",
    ]
  }

  # ── 4. Create axis user ────────────────────────────────────────────────────
  provisioner "shell" {
    inline = [
      "useradd -m -s /bin/bash axis",
      "usermod -aG sudo axis",
      "echo 'axis ALL=(ALL) NOPASSWD:ALL' >> /etc/sudoers",
    ]
  }

  # ── 5. Clone repo ──────────────────────────────────────────────────────────
  provisioner "shell" {
    inline = [
      "git clone --branch ${var.repo_branch} ${var.repo_url} /home/axis/openclawOcean",
      "chown -R axis:axis /home/axis/openclawOcean",
    ]
  }

  # ── 6. Install agent npm dependencies ──────────────────────────────────────
  provisioner "shell" {
    inline = [
      "cd /home/axis/openclawOcean/agent",
      "sudo -u axis npm install --omit=dev",
    ]
  }

  # ── 7. Install Playwright Chromium (fallback if system chromium insufficient) ─
  provisioner "shell" {
    inline = [
      "cd /home/axis/openclawOcean/agent",
      "PLAYWRIGHT_BROWSERS_PATH=/home/axis/.cache/ms-playwright sudo -u axis -E npx playwright install chromium || true",
      "chown -R axis:axis /home/axis/.cache || true",
    ]
  }

  # ── 8. Create .env placeholder ─────────────────────────────────────────────
  provisioner "shell" {
    inline = [
      "cp /home/axis/openclawOcean/.env.example /home/axis/openclawOcean/.env",
      "chown axis:axis /home/axis/openclawOcean/.env",
      "chmod 600 /home/axis/openclawOcean/.env",
    ]
  }

  # ── 9. Install systemd service ─────────────────────────────────────────────
  provisioner "shell" {
    inline = [
      <<-EOT
cat > /etc/systemd/system/axis-agent.service << 'SERVICE'
[Unit]
Description=AXIS Autonomous AI Agent Server
After=network.target
Wants=network-online.target

[Service]
Type=simple
User=axis
WorkingDirectory=/home/axis/openclawOcean/agent
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=axis-agent
Environment=NODE_ENV=production
Environment=WORKSPACE_DIR=/home/axis/openclawOcean
Environment=PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
Environment=PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium
EnvironmentFile=/home/axis/openclawOcean/.env

[Install]
WantedBy=multi-user.target
SERVICE
EOT
      ,
      "systemctl daemon-reload",
      "systemctl enable axis-agent",
      "echo 'Systemd service registered (not started — add .env first)'",
    ]
  }

  # ── 10. Configure UFW firewall ─────────────────────────────────────────────
  provisioner "shell" {
    inline = [
      "ufw allow ssh",
      "ufw allow 3000/tcp comment 'AXIS agent API'",
      "ufw allow 8443/tcp comment 'Telegram webhook'",
      "ufw --force enable",
    ]
  }

  # ── 11. First-boot helper script ───────────────────────────────────────────
  provisioner "shell" {
    inline = [
      <<-EOT
cat > /home/axis/START.sh << 'SCRIPT'
#!/bin/bash
# Run this after adding your API keys to .env

ENV_FILE="/home/axis/openclawOcean/.env"

if grep -q "YOUR_KEY_HERE" "$ENV_FILE"; then
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo " ACTION REQUIRED: Edit your .env file"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""
  echo "  nano /home/axis/openclawOcean/.env"
  echo ""
  echo "  Required:"
  echo "    ANTHROPIC_API_KEY=sk-ant-..."
  echo "    TELEGRAM_CHAT_ID=<from @userinfobot>"
  echo ""
  exit 1
fi

systemctl start axis-agent
sleep 2
systemctl status axis-agent --no-pager

echo ""
echo "AXIS is running on port 3000"
echo "Logs: journalctl -u axis-agent -f"
SCRIPT
chmod +x /home/axis/START.sh
chown axis:axis /home/axis/START.sh
EOT
    ]
  }

  # ── 12. Cleanup before snapshot ────────────────────────────────────────────
  provisioner "shell" {
    inline = [
      "apt-get clean",
      "rm -rf /tmp/* /var/tmp/*",
      "rm -f /root/.bash_history",
      "journalctl --vacuum-time=1d || true",
      "cloud-init clean --logs || true",
    ]
  }

  # ── Post-processor: print snapshot info ────────────────────────────────────
  post-processor "manifest" {
    output     = "setup/packer-manifest.json"
    strip_path = true
  }
}
