/**
 * config.js — Loads env, workspace context, and builds the system prompt
 */

import { readFileSync, existsSync } from 'fs';
import { resolve, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

// Workspace root is one level up from agent/
export const WORKSPACE_DIR = resolve(__dirname, '..');

function readWorkspaceFile(filename) {
  const path = join(WORKSPACE_DIR, filename);
  if (!existsSync(path)) return '';
  return readFileSync(path, 'utf8');
}

function readEnv() {
  const envPath = join(WORKSPACE_DIR, '.env');
  if (existsSync(envPath)) {
    const lines = readFileSync(envPath, 'utf8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx === -1) continue;
      const key = trimmed.slice(0, idx).trim();
      const val = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
      if (!process.env[key]) process.env[key] = val;
    }
  }
}

readEnv();

export const config = {
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
  telegramToken: process.env.TELEGRAM_BOT_TOKEN || '',
  telegramChatId: process.env.TELEGRAM_CHAT_ID || '',
  port: parseInt(process.env.PORT || '3000', 10),
  model: process.env.MODEL || 'claude-sonnet-4-6',
  maxIterations: parseInt(process.env.MAX_ITERATIONS || '50', 10),
  workspaceDir: WORKSPACE_DIR,
};

export function buildSystemPrompt() {
  const soul = readWorkspaceFile('SOUL.md');
  const user = readWorkspaceFile('USER.md');
  const memory = readWorkspaceFile('MEMORY.md');
  const today = new Date().toISOString().slice(0, 10);
  const dailyMemory = readWorkspaceFile(`memory/${today}.md`);

  return [
    '# AXIS — Autonomous Agent Mode',
    '',
    'You are running in autonomous server mode. You have access to tools and can execute tasks without confirmation.',
    'Work step by step. Use tools to verify your work. Persist important findings to memory.',
    '',
    soul,
    '',
    user ? `## User Profile\n${user}` : '',
    '',
    memory ? `## Knowledge Base\n${memory}` : '',
    '',
    dailyMemory ? `## Today's Session Notes (${today})\n${dailyMemory}` : '',
  ].filter(Boolean).join('\n').trim();
}
