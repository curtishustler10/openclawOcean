#!/usr/bin/env node
/**
 * mcp/memory.js — AXIS memory system MCP server
 * Tools: memory_read, memory_write, memory_append, memory_list, memory_log_session
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
  readFile, writeFile, appendFile,
  readdir, mkdir
} from 'fs/promises';
import { existsSync } from 'fs';
import { resolve, join, dirname } from 'path';

const WORKSPACE = process.env.WORKSPACE_DIR || resolve(new URL('.', import.meta.url).pathname, '../..');

const server = new McpServer({ name: 'memory', version: '1.0.0' });

function memPath(relPath) {
  // Safety: keep paths within workspace
  return resolve(WORKSPACE, relPath);
}

// ── memory_read ───────────────────────────────────────────────────────────────
server.tool(
  'memory_read',
  {
    file: z.string().describe('Relative path from workspace root (e.g. MEMORY.md, memory/2026-03-16.md)'),
  },
  async ({ file }) => {
    try {
      const path = memPath(file);
      if (!existsSync(path)) {
        return { content: [{ type: 'text', text: `(file not found: ${file})` }] };
      }
      const content = await readFile(path, 'utf8');
      return { content: [{ type: 'text', text: content }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// ── memory_write ──────────────────────────────────────────────────────────────
server.tool(
  'memory_write',
  {
    file: z.string().describe('Relative path from workspace root'),
    content: z.string().describe('Full content to write'),
  },
  async ({ file, content }) => {
    try {
      const path = memPath(file);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, content, 'utf8');
      return { content: [{ type: 'text', text: `Written: ${file}` }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// ── memory_append ─────────────────────────────────────────────────────────────
server.tool(
  'memory_append',
  {
    file: z.string().describe('Relative path from workspace root'),
    content: z.string().describe('Content to append'),
    newline: z.boolean().optional().describe('Add newline before content (default: true)'),
  },
  async ({ file, content, newline }) => {
    try {
      const path = memPath(file);
      await mkdir(dirname(path), { recursive: true });
      const prefix = newline !== false ? '\n' : '';
      await appendFile(path, prefix + content, 'utf8');
      return { content: [{ type: 'text', text: `Appended to: ${file}` }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// ── memory_list ───────────────────────────────────────────────────────────────
server.tool(
  'memory_list',
  {
    dir: z.string().optional().describe('Subdirectory to list (default: memory/)'),
  },
  async ({ dir }) => {
    try {
      const path = memPath(dir || 'memory');
      if (!existsSync(path)) {
        return { content: [{ type: 'text', text: '(no memory files)' }] };
      }
      const files = await readdir(path);
      return { content: [{ type: 'text', text: files.join('\n') }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// ── memory_log_session ────────────────────────────────────────────────────────
server.tool(
  'memory_log_session',
  {
    summary: z.string().describe('One-line session summary'),
  },
  async ({ summary }) => {
    try {
      const today = new Date().toISOString().slice(0, 10);
      const timestamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
      const line = `- **${timestamp} UTC** — ${summary}\n`;

      // Append to memory/session-log.md
      const logPath = memPath('memory/session-log.md');
      await mkdir(dirname(logPath), { recursive: true });
      await appendFile(logPath, line, 'utf8');

      // Append to today's daily log
      const dailyPath = memPath(`memory/${today}.md`);
      await appendFile(dailyPath, `\n${line}`, 'utf8');

      return { content: [{ type: 'text', text: `Session logged: ${summary}` }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
