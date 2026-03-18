/**
 * loop.js — Core agentic loop using Anthropic SDK + MCP tools
 *
 * Routing:
 *   admin/conversational → cheap model (haiku or alt provider)
 *   coding               → Claude Code CLI
 *   complex reasoning    → claude-sonnet-4-6
 */

import Anthropic from '@anthropic-ai/sdk';
import { config, buildSystemPrompt, WORKSPACE_DIR } from './config.js';
import { McpClientManager } from './mcp-client.js';
import { updateTask } from './queue.js';
import { classifyTask, getModelConfig, runWithClaudeCode } from './router.js';
import { getRecentContext, recordExchange } from './conversation-buffer.js';

export async function runTask(task, { onStep } = {}) {
  // ── 1. Classify task and select model tier ──────────────────────────────
  const tier = classifyTask(task.prompt);
  const modelConfig = getModelConfig(tier);

  console.error(`[loop] Task ${task.id.slice(0, 8)} → tier: ${tier} | model: ${modelConfig.label}`);
  updateTask(task.id, { status: 'running', tier, model: modelConfig.label });

  // ── 2. Coding tasks → delegate to Claude Code CLI ───────────────────────
  if (modelConfig.useClaudeCodeCli) {
    try {
      const { ok, result, error } = await runWithClaudeCode(task.prompt, WORKSPACE_DIR);
      updateTask(task.id, {
        status: ok ? 'done' : 'failed',
        result: ok ? result : null,
        error: ok ? null : error,
      });
      recordExchange(task.prompt, ok ? result : `Error: ${error}`);
      if (onStep) await onStep({ iteration: 1, text: result || error, stopReason: 'end_turn' });
      return ok ? { ok: true, result } : { ok: false, error };
    } catch (err) {
      updateTask(task.id, { status: 'failed', error: err.message });
      recordExchange(task.prompt, `Error: ${err.message}`);
      return { ok: false, error: err.message };
    }
  }

  // ── 3. Admin / complex → Anthropic SDK agentic loop ─────────────────────
  const anthropic = new Anthropic({
    apiKey: modelConfig.apiKey || config.anthropicApiKey,
    ...(modelConfig.baseURL ? { baseURL: modelConfig.baseURL } : {}),
  });

  // Boot MCP servers (skip browser for admin to save overhead)
  const mcp = new McpClientManager(WORKSPACE_DIR);
  const serversToLoad = tier === 'admin'
    ? ['shell', 'memory']   // lightweight
    : ['shell', 'memory', 'browser']; // full toolset

  await mcp.connect(serversToLoad);

  const tools = mcp.getAnthropicTools().map(({ _server, ...tool }) => tool);
  const recentContext = getRecentContext();
  const systemPrompt = buildSystemPrompt() + (recentContext ? '\n\n' + recentContext : '');

  const messages = [{ role: 'user', content: task.prompt }];
  let iterations = 0;
  let finalResult = null;

  try {
    while (iterations < config.maxIterations) {
      iterations++;

      updateTask(task.id, { messages: [...messages] });

      const response = await anthropic.messages.create({
        model: modelConfig.model,
        max_tokens: tier === 'admin' ? 2048 : 8192,
        system: systemPrompt,
        messages,
        tools: tools.length > 0 ? tools : undefined,
      });

      messages.push({ role: 'assistant', content: response.content });

      if (onStep) {
        const text = response.content.find(b => b.type === 'text')?.text || '';
        const toolCalls = response.content.filter(b => b.type === 'tool_use');
        await onStep({ iteration: iterations, text, toolCalls, stopReason: response.stop_reason });
      }

      if (response.stop_reason === 'end_turn') {
        finalResult = response.content
          .filter(b => b.type === 'text')
          .map(b => b.text)
          .join('\n')
          .trim();
        break;
      }

      if (response.stop_reason !== 'tool_use') {
        finalResult = response.content.find(b => b.type === 'text')?.text || '(done)';
        break;
      }

      // Execute tool calls
      const toolResults = [];
      for (const block of response.content) {
        if (block.type !== 'tool_use') continue;

        console.error(`[loop] Tool: ${block.name}`, JSON.stringify(block.input).slice(0, 120));

        const resultContent = await mcp.callToolRaw(block.name, block.input);
        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: resultContent,
        });

        if (onStep) {
          await onStep({ iteration: iterations, toolResult: { name: block.name, content: resultContent } });
        }
      }

      messages.push({ role: 'user', content: toolResults });
    }

    if (!finalResult) finalResult = `Max iterations (${config.maxIterations}) reached.`;

    updateTask(task.id, { status: 'done', result: finalResult, messages });
    recordExchange(task.prompt, finalResult);
    return { ok: true, result: finalResult };

  } catch (err) {
    console.error(`[loop] Error:`, err);
    updateTask(task.id, { status: 'failed', error: err.message, messages });
    recordExchange(task.prompt, `Error: ${err.message}`);
    return { ok: false, error: err.message };
  } finally {
    await mcp.disconnect();
  }
}
