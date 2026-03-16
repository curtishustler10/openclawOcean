/**
 * telegram.js — Telegram bot for task submission and result delivery
 */

import TelegramBot from 'node-telegram-bot-api';
import { config } from './config.js';
import { addTask, getTask, listTasks, cancelTask } from './queue.js';

let bot = null;

export function startTelegramBot({ onTask } = {}) {
  if (!config.telegramToken) {
    console.error('[telegram] No TELEGRAM_BOT_TOKEN set — bot disabled');
    return null;
  }

  bot = new TelegramBot(config.telegramToken, { polling: true });

  bot.on('polling_error', err => console.error('[telegram] polling error:', err.message));

  // ── /start ───────────────────────────────────────────────────────────────
  bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    await bot.sendMessage(chatId, [
      '⚡ *AXIS Agent Online*',
      '',
      'Send me any task and I\'ll execute it autonomously.',
      '',
      '*Commands:*',
      '/status — Running tasks',
      '/tasks — Recent task list',
      '/cancel <id> — Cancel a pending task',
      '/help — This message',
    ].join('\n'), { parse_mode: 'Markdown' });
  });

  bot.onText(/\/help/, async (msg) => {
    const chatId = msg.chat.id;
    await bot.sendMessage(chatId, [
      '⚡ *AXIS Agent Commands*',
      '',
      '/status — Show running tasks',
      '/tasks — List recent 10 tasks',
      '/cancel <id> — Cancel a task',
      '',
      'Or just send any message as a task.',
    ].join('\n'), { parse_mode: 'Markdown' });
  });

  // ── /status ──────────────────────────────────────────────────────────────
  bot.onText(/\/status/, async (msg) => {
    const chatId = msg.chat.id;
    const running = listTasks().filter(t => t.status === 'running');
    if (running.length === 0) {
      await bot.sendMessage(chatId, '✅ No tasks currently running.');
      return;
    }
    const lines = running.map(t =>
      `🔄 \`${t.id.slice(0, 8)}\` — ${t.prompt.slice(0, 60)}...`
    );
    await bot.sendMessage(chatId, lines.join('\n'), { parse_mode: 'Markdown' });
  });

  // ── /tasks ───────────────────────────────────────────────────────────────
  bot.onText(/\/tasks/, async (msg) => {
    const chatId = msg.chat.id;
    const tasks = listTasks(10);
    if (tasks.length === 0) {
      await bot.sendMessage(chatId, 'No tasks yet.');
      return;
    }
    const statusEmoji = { pending: '⏳', running: '🔄', done: '✅', failed: '❌', cancelled: '🚫' };
    const lines = tasks.map(t =>
      `${statusEmoji[t.status] || '?'} \`${t.id.slice(0, 8)}\` — ${t.prompt.slice(0, 50)}`
    );
    await bot.sendMessage(chatId, lines.join('\n'), { parse_mode: 'Markdown' });
  });

  // ── /cancel ──────────────────────────────────────────────────────────────
  bot.onText(/\/cancel (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const idPrefix = match[1].trim();
    const tasks = listTasks();
    const task = tasks.find(t => t.id.startsWith(idPrefix));
    if (!task) {
      await bot.sendMessage(chatId, `Task not found: ${idPrefix}`);
      return;
    }
    const ok = cancelTask(task.id);
    await bot.sendMessage(chatId, ok ? `🚫 Cancelled: ${task.id.slice(0, 8)}` : `Cannot cancel: task is running`);
  });

  // ── any other message → new task ─────────────────────────────────────────
  bot.on('message', async (msg) => {
    if (msg.text?.startsWith('/')) return;
    const chatId = msg.chat.id;

    // Save chat ID for result delivery
    if (!config.telegramChatId) config.telegramChatId = String(chatId);

    const prompt = msg.text || msg.caption || '';
    if (!prompt.trim()) return;

    const task = addTask(prompt, 'telegram');

    await bot.sendMessage(
      chatId,
      `⚡ Task queued\n\`${task.id.slice(0, 8)}\`\n\n_${prompt.slice(0, 100)}${prompt.length > 100 ? '...' : ''}_`,
      { parse_mode: 'Markdown' }
    );

    if (onTask) onTask(task, chatId);
  });

  console.error('[telegram] Bot started');
  return bot;
}

export async function sendResult(chatId, task) {
  if (!bot || !chatId) return;

  const statusEmoji = { done: '✅', failed: '❌' };
  const emoji = statusEmoji[task.status] || '?';

  const header = `${emoji} Task \`${task.id.slice(0, 8)}\` complete`;

  if (task.status === 'failed') {
    await bot.sendMessage(chatId, `${header}\n\nError: ${task.error}`, { parse_mode: 'Markdown' });
    return;
  }

  const result = task.result || '(no output)';

  // Telegram max message length is 4096 chars
  if (result.length <= 3800) {
    await bot.sendMessage(chatId, `${header}\n\n${result}`, { parse_mode: 'Markdown' });
  } else {
    // Send as file
    await bot.sendMessage(chatId, `${header} (long output — sending as file)`);
    const buffer = Buffer.from(result, 'utf8');
    await bot.sendDocument(chatId, buffer, {}, {
      filename: `result-${task.id.slice(0, 8)}.txt`,
      contentType: 'text/plain',
    });
  }
}

export function getBot() {
  return bot;
}
