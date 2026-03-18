/**
 * conversation-buffer.js — Rolling conversation context
 *
 * Keeps the last N exchanges (prompt + result) so the agent
 * has short-term memory across separate Telegram tasks.
 * Stored as JSON in memory/conversation-buffer.json.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { WORKSPACE_DIR } from './config.js';

const BUFFER_PATH = join(WORKSPACE_DIR, 'memory', 'conversation-buffer.json');
const MAX_ENTRIES = 5;
const MAX_RESULT_LENGTH = 500; // truncate long results to save tokens

function load() {
  try {
    return JSON.parse(readFileSync(BUFFER_PATH, 'utf8'));
  } catch {
    return [];
  }
}

function save(entries) {
  mkdirSync(dirname(BUFFER_PATH), { recursive: true });
  writeFileSync(BUFFER_PATH, JSON.stringify(entries, null, 2), 'utf8');
}

/**
 * Get recent conversation history formatted for the system prompt.
 */
export function getRecentContext() {
  const entries = load();
  if (!entries.length) return '';

  const lines = entries.map(e => {
    const ts = e.timestamp ? `(${e.timestamp}) ` : '';
    const result = e.result || '(no output)';
    return `User: ${e.prompt}\nAgent: ${result}`;
  });

  return [
    '## Recent Conversation (short-term memory)',
    'These are the most recent exchanges. Use this context to maintain conversational continuity.',
    '',
    ...lines,
  ].join('\n');
}

/**
 * Record a completed exchange in the buffer.
 */
export function recordExchange(prompt, result) {
  const entries = load();

  let trimmedResult = result || '(no output)';
  if (trimmedResult.length > MAX_RESULT_LENGTH) {
    trimmedResult = trimmedResult.slice(0, MAX_RESULT_LENGTH) + '...';
  }

  entries.push({
    prompt: prompt.slice(0, 300), // cap prompt length too
    result: trimmedResult,
    timestamp: new Date().toISOString().slice(0, 16).replace('T', ' '),
  });

  // Keep only the last N entries
  while (entries.length > MAX_ENTRIES) entries.shift();

  save(entries);
}
