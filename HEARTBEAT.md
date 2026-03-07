# HEARTBEAT.md

## What "Heartbeat" Means (per Curt)
When Curt says "create a heartbeat on x project", he wants:
- A 30-minute cron job that fires automatically
- Checks HEARTBEAT.md for pending tasks
- Replies `HEARTBEAT_OK` if nothing to do
- Otherwise describes what needs attention
- Config: `agents.defaults.heartbeat.every = "30m"`
- Disable with: `agents.defaults.heartbeat.every = "0m"`

---

## Memory Check (every heartbeat)
- Read memory/2026-YYYY-MM-DD.md for today — does it reflect the latest work done?
- If any phase was completed since last write, update it NOW
- If any decision was made, write it down
- Never let a session end without logging what happened

## Current Project State
- See memory/2026-03-07.md for full phase breakdown
- Phases 1–6 ✅ done. Phase 7, 8, 9 pending.
- Phase 7: Curt needs to confirm — Harry Dry framework or his own?
- Phase 8: Need a landing page URL from Curt
- Phase 9: Need Flow AI account access from Curt
