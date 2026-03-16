# AXIS Agent Server — Setup Guide

## What this is

A self-hosted autonomous AI agent server with:
- **REST API** (`POST /task`) to submit tasks programmatically
- **Telegram bot** to submit tasks from your phone
- **MCP tools**: shell execution, filesystem, browser automation, memory R/W
- **Model routing** to optimise cost vs capability per task type
- **Persistent task queue** backed to disk

## Prerequisites

- Ubuntu 22.04 or 24.04 LTS
- Fresh DigitalOcean droplet (minimum: 2 vCPU / 2GB RAM / 25GB SSD)
- Your Anthropic API key
- (Optional) Claude Code CLI installed on the droplet for coding tasks

---

## Install

### Option A — One-liner on fresh droplet

```bash
curl -fsSL https://raw.githubusercontent.com/curtishustler10/openclawOcean/claude/ai-agent-server-plan-4k5o2/setup/install.sh | sudo bash
```

### Option B — Manual

```bash
# 1. Clone the repo
git clone -b claude/ai-agent-server-plan-4k5o2 https://github.com/curtishustler10/openclawOcean.git
cd openclawOcean

# 2. Run installer
sudo bash setup/install.sh
```

---

## Configuration

After install, edit `/home/axis/openclawOcean/.env`:

```bash
sudo nano /home/axis/openclawOcean/.env
```

Minimum required:
```
ANTHROPIC_API_KEY=sk-ant-...
TELEGRAM_BOT_TOKEN=8638578625:AAGDlsocxSplP0nvIBmz5t2ia9Cq1QE0C_8
TELEGRAM_CHAT_ID=<your chat ID from @userinfobot>
```

---

## Model Routing

Tasks are automatically classified and routed:

| Task type | Model | Cost |
|-----------|-------|------|
| Conversational / admin | `claude-haiku-4-5` | ~$0.001 |
| Coding / debugging | Claude Code CLI | $0 (uses your API key directly) |
| Complex reasoning / analysis | `claude-sonnet-4-6` | ~$0.01 |

To use a different cheap provider (e.g. Gemini Flash via OpenRouter):
```
CHEAP_MODEL=google/gemini-flash-1.5
CHEAP_BASE_URL=https://openrouter.ai/api/v1
CHEAP_API_KEY=sk-or-...
```

---

## Start / Stop

```bash
# Start
systemctl start axis-agent

# Stop
systemctl stop axis-agent

# Restart
systemctl restart axis-agent

# Logs
journalctl -u axis-agent -f
```

---

## Usage

### Via Telegram
Just message your bot. Results come back automatically.

Commands:
- `/status` — show running tasks
- `/tasks` — list recent 10 tasks
- `/cancel <id>` — cancel a pending task

### Via REST API

```bash
# Submit a task
curl -X POST http://<droplet-ip>:3000/task \
  -H 'Content-Type: application/json' \
  -d '{"prompt": "List all files in the workspace"}'
# → {"id": "abc123...", "status": "pending"}

# Check status
curl http://<droplet-ip>:3000/task/abc123

# List all tasks
curl http://<droplet-ip>:3000/tasks
```

---

## MCP Tools Available

| Tool | Description |
|------|-------------|
| `bash_exec` | Run any shell command |
| `read_file` | Read any file |
| `write_file` | Write any file |
| `list_dir` | List directory contents |
| `delete_path` | Delete file/directory |
| `move_path` | Move/rename file |
| `browser_goto` | Navigate to URL |
| `browser_screenshot` | Capture screenshot |
| `browser_click` | Click element |
| `browser_type` | Type into input |
| `browser_get_text` | Extract page text |
| `browser_get_html` | Get page HTML |
| `browser_evaluate` | Run JavaScript in browser |
| `browser_wait` | Wait for selector/time |
| `browser_close` | Close browser |
| `memory_read` | Read a workspace memory file |
| `memory_write` | Write a memory file |
| `memory_append` | Append to a memory file |
| `memory_list` | List memory files |
| `memory_log_session` | Log a session entry |

---

## Firewall

Port `3000` is opened automatically by the installer (via UFW).
To restrict API access to specific IPs:

```bash
ufw delete allow 3000/tcp
ufw allow from <your-ip> to any port 3000
```

---

## Update

```bash
cd /home/axis/openclawOcean
sudo -u axis git pull origin claude/ai-agent-server-plan-4k5o2
cd agent && sudo -u axis npm install
sudo systemctl restart axis-agent
```
