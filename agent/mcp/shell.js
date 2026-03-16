#!/usr/bin/env node
/**
 * mcp/shell.js — Shell & filesystem MCP server
 * Tools: bash_exec, read_file, write_file, list_dir, delete_path, move_path
 * No restrictions. Full access.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { exec } from 'child_process';
import { promisify } from 'util';
import {
  readFile, writeFile, mkdir, readdir,
  rm, rename, stat
} from 'fs/promises';
import { existsSync } from 'fs';
import { resolve, dirname } from 'path';

const execAsync = promisify(exec);

const server = new McpServer({ name: 'shell', version: '1.0.0' });

// ── bash_exec ────────────────────────────────────────────────────────────────
server.tool(
  'bash_exec',
  {
    command: z.string().describe('Bash command to execute'),
    cwd: z.string().optional().describe('Working directory (default: workspace root)'),
    timeout_ms: z.number().optional().describe('Timeout in ms (default: 30000)'),
  },
  async ({ command, cwd, timeout_ms }) => {
    const options = {
      cwd: cwd || process.env.WORKSPACE_DIR || process.cwd(),
      timeout: timeout_ms || 30000,
      maxBuffer: 10 * 1024 * 1024, // 10MB
    };
    try {
      const { stdout, stderr } = await execAsync(command, options);
      const out = [stdout, stderr].filter(Boolean).join('\n--- stderr ---\n');
      return { content: [{ type: 'text', text: out || '(no output)' }] };
    } catch (err) {
      const out = [err.stdout, err.stderr, err.message].filter(Boolean).join('\n');
      return {
        content: [{ type: 'text', text: `EXIT ${err.code || 1}\n${out}` }],
        isError: true,
      };
    }
  }
);

// ── read_file ────────────────────────────────────────────────────────────────
server.tool(
  'read_file',
  {
    path: z.string().describe('Absolute or relative file path'),
    encoding: z.string().optional().describe('Encoding (default: utf8)'),
  },
  async ({ path, encoding }) => {
    try {
      const absPath = resolve(process.env.WORKSPACE_DIR || process.cwd(), path);
      const content = await readFile(absPath, encoding || 'utf8');
      return { content: [{ type: 'text', text: content }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// ── write_file ───────────────────────────────────────────────────────────────
server.tool(
  'write_file',
  {
    path: z.string().describe('Absolute or relative file path'),
    content: z.string().describe('File content'),
    create_dirs: z.boolean().optional().describe('Create parent dirs if missing (default: true)'),
  },
  async ({ path, content, create_dirs }) => {
    try {
      const absPath = resolve(process.env.WORKSPACE_DIR || process.cwd(), path);
      if (create_dirs !== false) {
        await mkdir(dirname(absPath), { recursive: true });
      }
      await writeFile(absPath, content, 'utf8');
      return { content: [{ type: 'text', text: `Written: ${absPath}` }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// ── list_dir ─────────────────────────────────────────────────────────────────
server.tool(
  'list_dir',
  {
    path: z.string().describe('Directory path'),
    recursive: z.boolean().optional().describe('List recursively (default: false)'),
  },
  async ({ path, recursive }) => {
    try {
      const absPath = resolve(process.env.WORKSPACE_DIR || process.cwd(), path);

      async function walk(dir, prefix = '') {
        const entries = await readdir(dir, { withFileTypes: true });
        const lines = [];
        for (const entry of entries) {
          const indicator = entry.isDirectory() ? '/' : '';
          lines.push(`${prefix}${entry.name}${indicator}`);
          if (recursive && entry.isDirectory()) {
            const sub = await walk(`${dir}/${entry.name}`, `${prefix}  `);
            lines.push(...sub);
          }
        }
        return lines;
      }

      const lines = await walk(absPath);
      return { content: [{ type: 'text', text: lines.join('\n') || '(empty)' }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// ── delete_path ──────────────────────────────────────────────────────────────
server.tool(
  'delete_path',
  {
    path: z.string().describe('File or directory path to delete'),
    recursive: z.boolean().optional().describe('Recursive delete for directories (default: false)'),
  },
  async ({ path, recursive }) => {
    try {
      const absPath = resolve(process.env.WORKSPACE_DIR || process.cwd(), path);
      await rm(absPath, { recursive: !!recursive, force: true });
      return { content: [{ type: 'text', text: `Deleted: ${absPath}` }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// ── move_path ────────────────────────────────────────────────────────────────
server.tool(
  'move_path',
  {
    from: z.string().describe('Source path'),
    to: z.string().describe('Destination path'),
  },
  async ({ from, to }) => {
    try {
      const base = process.env.WORKSPACE_DIR || process.cwd();
      const src = resolve(base, from);
      const dst = resolve(base, to);
      await mkdir(dirname(dst), { recursive: true });
      await rename(src, dst);
      return { content: [{ type: 'text', text: `Moved: ${src} → ${dst}` }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
