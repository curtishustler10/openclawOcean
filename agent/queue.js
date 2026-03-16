/**
 * queue.js — In-memory task queue with file persistence
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { v4 as uuidv4 } from 'uuid';
import { WORKSPACE_DIR } from './config.js';

const QUEUE_FILE = join(WORKSPACE_DIR, 'agent', 'queue.json');

const tasks = new Map();

function persist() {
  const data = Object.fromEntries(tasks);
  writeFileSync(QUEUE_FILE, JSON.stringify(data, null, 2));
}

function load() {
  if (!existsSync(QUEUE_FILE)) return;
  try {
    const data = JSON.parse(readFileSync(QUEUE_FILE, 'utf8'));
    for (const [id, task] of Object.entries(data)) {
      // Reset any running tasks to pending on startup
      if (task.status === 'running') task.status = 'pending';
      tasks.set(id, task);
    }
  } catch {}
}

load();

export function addTask(prompt, source = 'api') {
  const id = uuidv4();
  const task = {
    id,
    prompt,
    source,
    status: 'pending',
    result: null,
    error: null,
    messages: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  tasks.set(id, task);
  persist();
  return task;
}

export function getTask(id) {
  return tasks.get(id) || null;
}

export function updateTask(id, updates) {
  const task = tasks.get(id);
  if (!task) return null;
  Object.assign(task, updates, { updatedAt: new Date().toISOString() });
  persist();
  return task;
}

export function listTasks(limit = 50) {
  return [...tasks.values()]
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, limit);
}

export function getNextPending() {
  for (const task of tasks.values()) {
    if (task.status === 'pending') return task;
  }
  return null;
}

export function cancelTask(id) {
  const task = tasks.get(id);
  if (!task) return false;
  if (task.status === 'running') return false; // can't cancel in-flight
  task.status = 'cancelled';
  task.updatedAt = new Date().toISOString();
  persist();
  return true;
}
