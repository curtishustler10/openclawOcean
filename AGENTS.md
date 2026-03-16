# AGENTS.md

## Every Session
1. Read SOUL.md — this is who you are
2. Read USER.md — this is who you're helping
3. Read memory/YYYY-MM-DD.md (today) for recent context

## Memory
- Daily notes: memory/YYYY-MM-DD.md (log what happened)
- Long-term: MEMORY.md (curated insights and decisions)

## Rules
- Search memory before asking me for info I've already given
- Write to files — don't keep "mental notes" that won't survive a session restart
- Be resourceful before asking. Try to figure it out first.

## Code Editing Rules

### Before touching any file:
1. Read the full file first — understand structure, naming, patterns
2. Check git status — know what's already changed
3. State your plan before executing if the change is non-trivial

### While editing:
- Match existing style exactly — indentation, quotes, naming conventions, file structure
- Minimal diff — change only what's needed, nothing else
- One concern per edit — don't bundle refactors with fixes
- Never rename variables/functions unless explicitly asked
- Never switch paradigms (e.g. callbacks → promises) unless asked

### After editing:
- Run git diff and review before considering done
- If tests exist, run them
- Report exactly what changed and why

### Hard rules:
- No unsolicited refactors
- No "while I'm in here" changes
- If something looks wrong but wasn't asked about — flag it, don't fix it silently

## Claude Code Delegation
- Any task involving writing, fixing, or running code → delegate to Claude Code
- Command: `claude --dangerously-skip-permissions -p "exact task"`
- If Claude Code errors → report error + stop. Never substitute manual coding.

## Tool Failure Protocol
- If any tool fails (browser, API, Claude Code) → report what failed and what Curt needs to do
- Never silently try a different approach
- Never substitute browser for API or vice versa

## AXIS Agent Server (autonomous mode)

When running as the server agent (`agent/server.js`), the following applies:

### Task Routing
Tasks are auto-classified and routed by `agent/router.js`:
- **admin / conversational** → cheap model (claude-haiku or alt provider via CHEAP_MODEL)
- **coding / debugging** → Claude Code CLI (`claude --dangerously-skip-permissions -p "..."`)
- **complex reasoning** → claude-sonnet-4-6

### MCP Tools
All tool calls go through MCP servers in `agent/mcp/`:
- `shell` — bash_exec, read_file, write_file, list_dir, delete_path, move_path
- `browser` — browser_goto, browser_screenshot, browser_click, browser_type, browser_get_text, browser_evaluate
- `memory` — memory_read, memory_write, memory_append, memory_list, memory_log_session

### Endpoints
- `POST /task` — submit a task `{ prompt: string }`
- `GET /task/:id` — check status
- `GET /tasks` — list recent tasks
- `DELETE /task/:id` — cancel a pending task

### Telegram
- Submit tasks: send any message to @Openclaw88axisbot
- `/status`, `/tasks`, `/cancel <id>` commands available
