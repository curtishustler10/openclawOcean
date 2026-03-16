/**
 * server.js — AXIS Agent Server
 * REST API + Telegram bot + task worker
 */

import express from 'express';
import { config } from './config.js';
import { addTask, getTask, listTasks, updateTask, getNextPending } from './queue.js';
import { runTask } from './loop.js';
import { startTelegramBot, sendResult } from './telegram.js';

const app = express();
app.use(express.json());

// ── API Routes ────────────────────────────────────────────────────────────────

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'ok', agent: 'AXIS', model: config.model });
});

// Submit a task
app.post('/task', (req, res) => {
  const { prompt } = req.body;
  if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
    return res.status(400).json({ error: 'prompt is required' });
  }
  const task = addTask(prompt.trim(), 'api');
  res.status(201).json({ id: task.id, status: task.status });
});

// Get task status + result
app.get('/task/:id', (req, res) => {
  const task = getTask(req.params.id);
  if (!task) return res.status(404).json({ error: 'not found' });

  // Don't return full message history in this endpoint (can be large)
  const { messages, ...summary } = task;
  res.json(summary);
});

// Get full task including messages
app.get('/task/:id/messages', (req, res) => {
  const task = getTask(req.params.id);
  if (!task) return res.status(404).json({ error: 'not found' });
  res.json(task);
});

// List recent tasks
app.get('/tasks', (req, res) => {
  const limit = parseInt(req.query.limit || '20', 10);
  const tasks = listTasks(limit).map(({ messages, ...t }) => t);
  res.json(tasks);
});

// Cancel a task
app.delete('/task/:id', (req, res) => {
  const task = getTask(req.params.id);
  if (!task) return res.status(404).json({ error: 'not found' });
  if (task.status === 'running') return res.status(409).json({ error: 'cannot cancel running task' });
  updateTask(task.id, { status: 'cancelled' });
  res.json({ ok: true });
});

// ── Worker Loop ───────────────────────────────────────────────────────────────

// Tracks which Telegram chat ID submitted each task
const taskChatMap = new Map();
let workerBusy = false;

async function processNextTask() {
  if (workerBusy) return;
  const task = getNextPending();
  if (!task) return;

  workerBusy = true;
  console.log(`[worker] Starting task ${task.id.slice(0, 8)}: ${task.prompt.slice(0, 80)}`);

  try {
    await runTask(task, {
      onStep: async ({ iteration, text, toolCalls }) => {
        if (toolCalls?.length) {
          console.log(`[worker] Step ${iteration}: ${toolCalls.map(t => t.name).join(', ')}`);
        }
      },
    });
  } finally {
    workerBusy = false;
  }

  // Send result back via Telegram if task came from there
  const chatId = taskChatMap.get(task.id);
  if (chatId) {
    const updated = getTask(task.id);
    await sendResult(chatId, updated);
    taskChatMap.delete(task.id);
  }

  console.log(`[worker] Task ${task.id.slice(0, 8)} done: ${getTask(task.id)?.status}`);
}

// Poll for new tasks every second
setInterval(processNextTask, 1000);

// ── Telegram Bot ──────────────────────────────────────────────────────────────

startTelegramBot({
  onTask: (task, chatId) => {
    taskChatMap.set(task.id, chatId);
  },
});

// ── Start Server ──────────────────────────────────────────────────────────────

app.listen(config.port, () => {
  console.log(`[axis] Agent server running on port ${config.port}`);
  console.log(`[axis] Model: ${config.model}`);
  console.log(`[axis] Workspace: ${config.workspaceDir}`);
  console.log(`[axis] API: http://localhost:${config.port}/task`);
});
