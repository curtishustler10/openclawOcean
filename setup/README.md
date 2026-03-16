# AXIS Agent Server — Setup Guide

Three deployment options, from simplest to most production-grade:

| Option | How | Best for |
|--------|-----|---------|
| **A — Cloud-Init** | Paste `cloud-init.yml` into DO droplet user-data | Quickest start, no tools needed |
| **B — Packer snapshot** | Build a DO image once, spin up unlimited droplets from it | Repeatable, fastest boot |
| **C — Docker** | Run containerised via `docker-compose up` | Local dev or Docker-preferred hosts |

---

## Option A — Cloud-Init (Quickest)

No tools needed. AXIS installs itself on first boot.

1. Go to **DigitalOcean → Create Droplet**
2. Choose: **Ubuntu 22.04 LTS**, region `Sydney (SYD1)`, size `2 vCPU / 2GB`
3. Expand **Advanced Options → Add Initialization scripts (User Data)**
4. Paste the full contents of `setup/cloud-init.yml`
5. Create the droplet — setup runs automatically (~5 min)

Then:
```bash
ssh root@<droplet-ip>
su - axis

# Add your API keys
nano /home/axis/openclawOcean/.env

# Start AXIS
bash /home/axis/START.sh
```

---

## Option B — Packer Snapshot (Recommended for scale)

Builds a reusable DigitalOcean image. Spin up new droplets from it in seconds with zero setup.

### Prerequisites
```bash
# Install Packer (macOS)
brew tap hashicorp/tap && brew install hashicorp/tap/packer

# Install Packer (Linux)
curl -fsSL https://apt.releases.hashicorp.com/gpg | gpg --dearmor -o /usr/share/keyrings/hashicorp.gpg
echo "deb [signed-by=/usr/share/keyrings/hashicorp.gpg] https://apt.releases.hashicorp.com $(lsb_release -cs) main" | tee /etc/apt/sources.list.d/hashicorp.list
apt-get update && apt-get install packer
```

### Build the snapshot
```bash
# Get a DO Personal Access Token from:
# digitalocean.com → API → Generate New Token (read+write)
export DIGITALOCEAN_TOKEN=dop_v1_your_token_here

# (Optional) Override branch
export AXIS_REPO_BRANCH=claude/ai-agent-server-plan-4k5o2

cd /path/to/openclawOcean

# Init + build (~8-12 min)
packer init setup/packer.pkr.hcl
packer build setup/packer.pkr.hcl
```

Packer will:
1. Create a temporary `s-2vcpu-2gb` droplet in Sydney
2. Install Node.js 20, Claude Code CLI, all dependencies, Playwright Chromium
3. Clone the repo, install npm deps, register systemd service
4. Take a snapshot named `axis-agent-<timestamp>`
5. Destroy the temporary droplet

The snapshot appears in your DO account under **Images → Snapshots**.

### Spin up a droplet from the snapshot
```bash
# Via DO CLI (doctl)
doctl compute droplet create axis-prod \
  --image axis-agent-<timestamp> \
  --size s-2vcpu-4gb \
  --region syd1 \
  --ssh-keys <your-key-fingerprint>

# Or via the web console:
# Manage → Backups & Snapshots → Snapshots → select image → Create Droplet
```

### First run after boot
```bash
ssh root@<new-droplet-ip>
su - axis
nano /home/axis/openclawOcean/.env   # Add API keys
bash /home/axis/START.sh             # Starts AXIS
```

---

## Option C — Docker

### Requirements
- Docker + Docker Compose on any Ubuntu droplet
- Droplet size: 1 vCPU / 1GB RAM minimum (2GB recommended)

### Install Docker on droplet
```bash
curl -fsSL https://get.docker.com | bash
usermod -aG docker $USER
```

### Deploy
```bash
git clone -b claude/ai-agent-server-plan-4k5o2 https://github.com/curtishustler10/openclawOcean.git
cd openclawOcean

# Add API keys
cp .env.example .env
nano .env

# Build and start (first run ~3 min)
docker compose up -d

# Logs
docker compose logs -f

# Update to latest
git pull && docker compose up -d --build
```

### Build and push to DigitalOcean Container Registry (optional)
```bash
# Create registry at: digitalocean.com → Container Registry
doctl registry login

docker build -t registry.digitalocean.com/your-registry/axis-agent:latest .
docker push registry.digitalocean.com/your-registry/axis-agent:latest
```

---

## Configuration (.env)

Minimum required in all options:

```bash
ANTHROPIC_API_KEY=sk-ant-...
TELEGRAM_BOT_TOKEN=8638578625:AAGDlsocxSplP0nvIBmz5t2ia9Cq1QE0C_8
TELEGRAM_CHAT_ID=   # Get from @userinfobot on Telegram
```

Full model routing config: see `.env.example`

---

## Model Routing

| Task | Route | Cost |
|------|-------|------|
| Conversational / admin | `claude-haiku-4-5` (cheap) | ~$0.001 |
| Coding / debugging | Claude Code CLI | low |
| Complex reasoning | `claude-sonnet-4-6` | ~$0.01 |

To use a different cheap provider (Gemini, OpenRouter, local LiteLLM):
```
CHEAP_MODEL=google/gemini-flash-1.5
CHEAP_BASE_URL=https://openrouter.ai/api/v1
CHEAP_API_KEY=sk-or-...
```

---

## Usage after deploy

### Telegram
Message your bot (@Openclaw88axisbot) — tasks run and results come back automatically.

Commands: `/status` `/tasks` `/cancel <id>`

### REST API
```bash
# Submit task
curl -X POST http://<ip>:3000/task \
  -H 'Content-Type: application/json' \
  -d '{"prompt": "Check what files changed in git today"}'

# Poll result
curl http://<ip>:3000/task/<id>

# List all
curl http://<ip>:3000/tasks
```

### Manage the service
```bash
systemctl start|stop|restart axis-agent
journalctl -u axis-agent -f        # live logs
```

---

## Update

```bash
cd /home/axis/openclawOcean
git pull origin claude/ai-agent-server-plan-4k5o2
cd agent && npm install --omit=dev
systemctl restart axis-agent
```
