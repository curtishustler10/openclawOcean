/**
 * router.js — Task classifier and model/provider router
 *
 * Rules:
 *   conversational / admin / simple  → CHEAP_MODEL (default: claude-haiku-4-5)
 *   coding / debugging               → Claude Code CLI (claude --dangerously-skip-permissions)
 *   complex reasoning / analysis     → claude-sonnet-4-6 (Anthropic)
 *
 * Override via env:
 *   CHEAP_MODEL    = model name for cheap tier  (default: claude-haiku-4-5-20251001)
 *   CHEAP_BASE_URL = base URL for cheap provider (optional, e.g. Google/OpenRouter/LiteLLM)
 *   CHEAP_API_KEY  = API key for cheap provider  (optional)
 *   CODING_TIER    = 'claude-code' | 'sonnet'   (default: claude-code)
 */

import { config } from './config.js';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// ── Task tier classification ──────────────────────────────────────────────────

const CODING_KEYWORDS = [
  'write code', 'fix bug', 'debug', 'implement', 'refactor', 'build a', 'create a function',
  'add feature', 'unit test', 'write a script', 'programming', 'code review',
  'git commit', 'git push', 'pull request', 'dockerfile', 'sql query', 'api endpoint',
];

const COMPLEX_KEYWORDS = [
  'analyze', 'research', 'plan', 'strategy', 'audit', 'evaluate', 'compare',
  'summarize this entire', 'deep dive', 'comprehensive', 'architecture', 'design system',
  'explain in detail', 'think through',
];

const ADMIN_KEYWORDS = [
  'what is', 'how do i', 'remind me', 'list', 'show me', 'tell me', 'who is',
  'update memory', 'log session', 'status', 'check', 'quick', 'translate',
  'what time', 'schedule', 'note:', 'draft a message', 'write an email',
];

/**
 * Classify a task prompt into a tier.
 * Returns: 'admin' | 'coding' | 'complex'
 */
export function classifyTask(prompt) {
  const lower = prompt.toLowerCase();

  // Coding check first (highest priority)
  if (CODING_KEYWORDS.some(kw => lower.includes(kw))) return 'coding';

  // Complex reasoning
  if (COMPLEX_KEYWORDS.some(kw => lower.includes(kw))) return 'complex';

  // Admin / conversational (default for short prompts)
  if (ADMIN_KEYWORDS.some(kw => lower.includes(kw)) || prompt.length < 150) return 'admin';

  // Default to complex for long / ambiguous prompts
  return 'complex';
}

// ── Model config per tier ─────────────────────────────────────────────────────

export function getModelConfig(tier) {
  switch (tier) {
    case 'admin':
      return {
        model: process.env.CHEAP_MODEL || 'claude-haiku-4-5-20251001',
        baseURL: process.env.CHEAP_BASE_URL || undefined,   // e.g. LiteLLM, OpenRouter
        apiKey: process.env.CHEAP_API_KEY || config.anthropicApiKey,
        label: 'haiku (cheap)',
      };

    case 'coding':
      // Claude Code CLI is handled separately — signal with special flag
      return {
        model: 'claude-code-cli',
        label: 'claude-code CLI',
        useClaudeCodeCli: process.env.CODING_TIER !== 'sonnet',
      };

    case 'complex':
    default:
      return {
        model: process.env.COMPLEX_MODEL || config.model,  // claude-sonnet-4-6
        baseURL: undefined,
        apiKey: config.anthropicApiKey,
        label: 'sonnet (full)',
      };
  }
}

// ── Claude Code CLI executor ──────────────────────────────────────────────────

/**
 * Runs a coding task via Claude Code CLI.
 * Equivalent to: claude --dangerously-skip-permissions -p "<prompt>"
 */
export async function runWithClaudeCode(prompt, cwd) {
  const workdir = cwd || config.workspaceDir;
  const escaped = prompt.replace(/'/g, `'\\''`);

  const cmd = `claude --dangerously-skip-permissions -p '${escaped}'`;

  try {
    const { stdout, stderr } = await execAsync(cmd, {
      cwd: workdir,
      timeout: 300000,   // 5 min max
      maxBuffer: 10 * 1024 * 1024,
      env: {
        ...process.env,
        ANTHROPIC_API_KEY: config.anthropicApiKey,
      },
    });
    return { ok: true, result: stdout || stderr || '(claude code completed with no output)' };
  } catch (err) {
    const output = [err.stdout, err.stderr, err.message].filter(Boolean).join('\n');
    return { ok: false, error: output };
  }
}
