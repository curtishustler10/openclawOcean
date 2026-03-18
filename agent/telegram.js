/**
 * telegram.js — Telegram bot in WEBHOOK mode
 *
 * Telegram pushes updates to us (no outbound polling, avoids firewall issues).
 * Uses self-signed SSL cert — auto-generated on first start.
 * Listens on port 8443 (Telegram-approved port for webhooks).
 *
 * Requires in .env:
 *   PUBLIC_IP or PUBLIC_DOMAIN — droplet's public IP or domain
 *   WEBHOOK_PORT               — default 8443
 */

import TelegramBot from 'node-telegram-bot-api';
import { existsSync, mkdirSync } from 'fs';
import { execSync } from 'child_process';
import { join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { config } from './config.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const CERT_DIR = join(__dirname, 'certs');
const CERT_FILE = join(CERT_DIR, 'cert.pem');
const KEY_FILE  = join(CERT_DIR, 'key.pem');

let bot = null;

function generateSelfSignedCert(host) {
  mkdirSync(CERT_DIR, { recursive: true });
  console.error(`[telegram] Generating self-signed cert for ${host}...`);
  execSync(
    `openssl req -newkey rsa:2048 -sha256 -nodes ` +
    `-keyout "${KEY_FILE}" -x509 -days 3650 ` +
    `-out "${CERT_FILE}" -subj "/CN=${host}"`,
    { stdio: 'pipe' }
  );
  console.error(`[telegram] Cert saved to ${CERT_DIR}`);
}

export function startTelegramBot({ onTask } = {}) {
  if (!config.telegramToken) {
    console.error('[telegram] No TELEGRAM_BOT_TOKEN set — bot disabled');
    return null;
  }

  const host        = process.env.PUBLIC_IP || process.env.PUBLIC_DOMAIN || '';
  const webhookPort = parseInt(process.env.WEBHOOK_PORT || '8443', 10);

  if (!host) {
    console.error('[telegram] No PUBLIC_IP set in .env — bot disabled');
    console.error('[telegram] Add: PUBLIC_IP=<your-droplet-ip>');
    return null;
  }

  // Auto-generate cert if missing
  if (!existsSync(CERT_FILE) || !existsSync(KEY_FILE)) {
    generateSelfSignedCert(host);
  }

  const webhookUrl = `https://${host}:${webhookPort}`;

  // node-telegram-bot-api expects file paths for key/cert (it calls readFileSync internally)
  bot = new TelegramBot(config.telegramToken, {
    webHook: {
      port: webhookPort,
      key: KEY_FILE,
      cert: CERT_FILE,
      autoOpen: true,
    },
  });

  // Register webhook with Telegram via curl (node-telegram-bot-api's file
  // handling is unreliable for self-signed PEM certs)
  try {
    const result = execSync(
      `curl -s -F "url=${webhookUrl}/bot${config.telegramToken}" ` +
      `-F "certificate=@${CERT_FILE}" ` +
      `https://api.telegram.org/bot${config.telegramToken}/setWebhook`,
      { encoding: 'utf8', timeout: 15000 }
    );
    const json = JSON.parse(result);
    if (json.ok) {
      console.error(`[telegram] Webhook registered: ${webhookUrl}`);
    } else {
      console.error(`[telegram] Webhook registration failed: ${json.description}`);
    }
  } catch (err) {
    console.error('[telegram] Webhook registration failed:', err.message);
  }

  bot.on('polling_error', err => console.error('[telegram] error:', err.message));

  // ── /start ─────────────────────────────────────────────────────────────
  bot.onText(/\/start|\/help/, async (msg) => {
    const chatId = msg.chat.id;
    await bot.sendMessage(chatId, [
      '⚡ *AXIS Agent Online*',
      '',
      'Send me any task and I\'ll execute it autonomously.',
      '',
      '*Commands:*',
      '/status — Running tasks',
      '/tasks — Recent task list',
      '/cancel <id> — Cancel a task',
    ].join('\n'), { parse_mode: 'Markdown' });
  });

  // ── /status ────────────────────────────────────────────────────────────
  bot.onText(/\/status/, async (msg) => {
    const { listTasks } = await import('./queue.js');
    const chatId  = msg.chat.id;
    const running = listTasks().filter(t => t.status === 'running');
    if (!running.length) return bot.sendMessage(chatId, '✅ No tasks running.');
    const lines = running.map(t => `🔄 \`${t.id.slice(0,8)}\` — ${t.prompt.slice(0,60)}`);
    await bot.sendMessage(chatId, lines.join('\n'), { parse_mode: 'Markdown' });
  });

  // ── /tasks ─────────────────────────────────────────────────────────────
  bot.onText(/\/tasks/, async (msg) => {
    const { listTasks } = await import('./queue.js');
    const chatId = msg.chat.id;
    const tasks  = listTasks(10);
    if (!tasks.length) return bot.sendMessage(chatId, 'No tasks yet.');
    const emoji  = { pending:'⏳', running:'🔄', done:'✅', failed:'❌', cancelled:'🚫' };
    const lines  = tasks.map(t => `${emoji[t.status]||'?'} \`${t.id.slice(0,8)}\` — ${t.prompt.slice(0,50)}`);
    await bot.sendMessage(chatId, lines.join('\n'), { parse_mode: 'Markdown' });
  });

  // ── /cancel ────────────────────────────────────────────────────────────
  bot.onText(/\/cancel (.+)/, async (msg, match) => {
    const { listTasks, cancelTask } = await import('./queue.js');
    const chatId   = msg.chat.id;
    const idPrefix = match[1].trim();
    const task     = listTasks().find(t => t.id.startsWith(idPrefix));
    if (!task) return bot.sendMessage(chatId, `Not found: ${idPrefix}`);
    const ok = cancelTask(task.id);
    await bot.sendMessage(chatId, ok ? `🚫 Cancelled: \`${task.id.slice(0,8)}\`` : `Cannot cancel: task is running`, { parse_mode: 'Markdown' });
  });

  // ── any message → new task ─────────────────────────────────────────────
  bot.on('message', async (msg) => {
    if (msg.text?.startsWith('/')) return;
    const { addTask } = await import('./queue.js');
    const chatId = msg.chat.id;
    const prompt = msg.text || msg.caption || '';
    if (!prompt.trim()) return;

    if (!config.telegramChatId) config.telegramChatId = String(chatId);

    const task = addTask(prompt, 'telegram');
    await bot.sendMessage(
      chatId,
      `⚡ Task queued \`${task.id.slice(0,8)}\`\n\n_${prompt.slice(0,100)}${prompt.length > 100 ? '...' : ''}_`,
      { parse_mode: 'Markdown' }
    );
    if (onTask) onTask(task, chatId);
  });

  console.error('[telegram] Webhook bot started');
  return bot;
}

export async function sendResult(chatId, task) {
  if (!bot || !chatId) return;
  const emoji  = { done: '✅', failed: '❌' };
  const header = `${emoji[task.status] || '?'} Task \`${task.id.slice(0,8)}\` complete`;

  if (task.status === 'failed') {
    return bot.sendMessage(chatId, `${header}\n\nError: ${task.error}`, { parse_mode: 'Markdown' });
  }

  const result = task.result || '(no output)';
  if (result.length <= 3800) {
    await bot.sendMessage(chatId, `${header}\n\n${result}`, { parse_mode: 'Markdown' });
  } else {
    await bot.sendMessage(chatId, `${header} — sending as file`);
    const buf = Buffer.from(result, 'utf8');
    await bot.sendDocument(chatId, buf, {}, { filename: `result-${task.id.slice(0,8)}.txt`, contentType: 'text/plain' });
  }
}

export function getBot() { return bot; }
