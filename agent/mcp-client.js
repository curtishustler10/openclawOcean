/**
 * mcp-client.js — Manages MCP server processes and provides unified tool interface
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'url';
import { resolve } from 'path';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

const MCP_SERVERS = [
  {
    name: 'shell',
    command: 'node',
    args: [resolve(__dirname, 'mcp/shell.js')],
  },
  {
    name: 'browser',
    command: 'node',
    args: [resolve(__dirname, 'mcp/browser.js')],
  },
  {
    name: 'memory',
    command: 'node',
    args: [resolve(__dirname, 'mcp/memory.js')],
  },
];

export class McpClientManager {
  constructor(workspaceDir) {
    this.workspaceDir = workspaceDir;
    this.clients = new Map(); // name → { client, tools[] }
  }

  async connect(serverNames = null) {
    const servers = serverNames
      ? MCP_SERVERS.filter(s => serverNames.includes(s.name))
      : MCP_SERVERS;

    await Promise.all(servers.map(s => this._connectServer(s)));
    console.error(`[mcp] Connected to ${this.clients.size} MCP servers`);
  }

  async _connectServer(serverDef) {
    try {
      const transport = new StdioClientTransport({
        command: serverDef.command,
        args: serverDef.args,
        env: {
          ...process.env,
          WORKSPACE_DIR: this.workspaceDir,
          PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin',
        },
      });

      const client = new Client(
        { name: 'axis-agent', version: '1.0.0' },
        { capabilities: {} }
      );

      await client.connect(transport);
      const { tools } = await client.listTools();

      this.clients.set(serverDef.name, { client, tools });
      console.error(`[mcp] ${serverDef.name}: ${tools.length} tools loaded`);
    } catch (err) {
      console.error(`[mcp] Failed to connect to ${serverDef.name}: ${err.message}`);
    }
  }

  // Returns all tools formatted for Anthropic tool_use API
  getAnthropicTools() {
    const tools = [];
    for (const [serverName, { tools: serverTools }] of this.clients) {
      for (const tool of serverTools) {
        tools.push({
          name: tool.name,
          description: tool.description || '',
          input_schema: tool.inputSchema || { type: 'object', properties: {} },
          // Track which server owns this tool
          _server: serverName,
        });
      }
    }
    return tools;
  }

  // Call a tool by name, returns string content
  async callTool(toolName, args) {
    // Find which server owns this tool
    for (const [serverName, { client, tools }] of this.clients) {
      const tool = tools.find(t => t.name === toolName);
      if (!tool) continue;

      try {
        const result = await client.callTool({ name: toolName, arguments: args });
        return this._formatResult(result);
      } catch (err) {
        return `Error calling ${toolName}: ${err.message}`;
      }
    }
    return `Tool not found: ${toolName}`;
  }

  _formatResult(result) {
    if (!result?.content) return '(no result)';
    const parts = [];
    for (const item of result.content) {
      if (item.type === 'text') parts.push(item.text);
      else if (item.type === 'image') parts.push(`[image: base64 ${item.mimeType}]`);
      else parts.push(JSON.stringify(item));
    }
    return parts.join('\n');
  }

  // Returns raw result including image content for passing back to Anthropic
  async callToolRaw(toolName, args) {
    for (const [, { client, tools }] of this.clients) {
      const tool = tools.find(t => t.name === toolName);
      if (!tool) continue;

      try {
        const result = await client.callTool({ name: toolName, arguments: args });
        if (!result?.content) return [{ type: 'text', text: '(no result)' }];

        return result.content.map(item => {
          if (item.type === 'text') return { type: 'text', text: item.text };
          if (item.type === 'image') return {
            type: 'image',
            source: { type: 'base64', media_type: item.mimeType, data: item.data },
          };
          return { type: 'text', text: JSON.stringify(item) };
        });
      } catch (err) {
        return [{ type: 'text', text: `Error calling ${toolName}: ${err.message}` }];
      }
    }
    return [{ type: 'text', text: `Tool not found: ${toolName}` }];
  }

  async disconnect() {
    for (const [name, { client }] of this.clients) {
      try {
        await client.close();
        console.error(`[mcp] Disconnected: ${name}`);
      } catch {}
    }
    this.clients.clear();
  }
}
