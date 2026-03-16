#!/usr/bin/env node
/**
 * mcp/browser.js — Playwright browser automation MCP server
 * Tools: browser_goto, browser_screenshot, browser_click, browser_type,
 *        browser_get_text, browser_get_html, browser_evaluate, browser_close
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { chromium } from 'playwright';

const server = new McpServer({ name: 'browser', version: '1.0.0' });

let browser = null;
let page = null;

async function getPage() {
  if (!browser || !browser.isConnected()) {
    browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--disable-dev-shm-usage',
        '--disable-gpu',
      ],
    });
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
      viewport: { width: 1440, height: 900 },
    });
    page = await context.newPage();
    // Remove navigator.webdriver flag
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });
  }
  return page;
}

// ── browser_goto ─────────────────────────────────────────────────────────────
server.tool(
  'browser_goto',
  {
    url: z.string().describe('URL to navigate to'),
    wait_until: z.enum(['load', 'domcontentloaded', 'networkidle']).optional(),
    timeout_ms: z.number().optional(),
  },
  async ({ url, wait_until, timeout_ms }) => {
    try {
      const p = await getPage();
      await p.goto(url, {
        waitUntil: wait_until || 'load',
        timeout: timeout_ms || 30000,
      });
      const title = await p.title();
      return { content: [{ type: 'text', text: `Navigated to: ${url}\nTitle: ${title}` }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// ── browser_screenshot ───────────────────────────────────────────────────────
server.tool(
  'browser_screenshot',
  {
    full_page: z.boolean().optional().describe('Capture full page (default: false)'),
    selector: z.string().optional().describe('Screenshot specific element'),
  },
  async ({ full_page, selector }) => {
    try {
      const p = await getPage();
      let buffer;
      if (selector) {
        const el = await p.locator(selector).first();
        buffer = await el.screenshot();
      } else {
        buffer = await p.screenshot({ fullPage: !!full_page });
      }
      const base64 = buffer.toString('base64');
      return {
        content: [{
          type: 'image',
          data: base64,
          mimeType: 'image/png',
        }],
      };
    } catch (err) {
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// ── browser_click ────────────────────────────────────────────────────────────
server.tool(
  'browser_click',
  {
    selector: z.string().describe('CSS selector or text to click'),
    by_text: z.boolean().optional().describe('Find element by visible text'),
  },
  async ({ selector, by_text }) => {
    try {
      const p = await getPage();
      if (by_text) {
        await p.getByText(selector).first().click();
      } else {
        await p.click(selector);
      }
      return { content: [{ type: 'text', text: `Clicked: ${selector}` }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// ── browser_type ─────────────────────────────────────────────────────────────
server.tool(
  'browser_type',
  {
    selector: z.string().describe('CSS selector for the input'),
    text: z.string().describe('Text to type'),
    clear_first: z.boolean().optional().describe('Clear existing value first (default: true)'),
  },
  async ({ selector, text, clear_first }) => {
    try {
      const p = await getPage();
      if (clear_first !== false) await p.fill(selector, '');
      await p.type(selector, text, { delay: 50 });
      return { content: [{ type: 'text', text: `Typed "${text}" into ${selector}` }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// ── browser_get_text ─────────────────────────────────────────────────────────
server.tool(
  'browser_get_text',
  {
    selector: z.string().optional().describe('CSS selector (default: body)'),
  },
  async ({ selector }) => {
    try {
      const p = await getPage();
      const text = await p.innerText(selector || 'body');
      return { content: [{ type: 'text', text: text.trim() }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// ── browser_get_html ─────────────────────────────────────────────────────────
server.tool(
  'browser_get_html',
  {
    selector: z.string().optional().describe('CSS selector (default: html)'),
  },
  async ({ selector }) => {
    try {
      const p = await getPage();
      const html = selector
        ? await p.innerHTML(selector)
        : await p.content();
      return { content: [{ type: 'text', text: html }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// ── browser_evaluate ─────────────────────────────────────────────────────────
server.tool(
  'browser_evaluate',
  {
    script: z.string().describe('JavaScript to evaluate in the browser'),
  },
  async ({ script }) => {
    try {
      const p = await getPage();
      const result = await p.evaluate(script);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// ── browser_wait ─────────────────────────────────────────────────────────────
server.tool(
  'browser_wait',
  {
    selector: z.string().optional().describe('Wait for selector to be visible'),
    ms: z.number().optional().describe('Wait for fixed milliseconds'),
  },
  async ({ selector, ms }) => {
    try {
      const p = await getPage();
      if (selector) {
        await p.waitForSelector(selector, { state: 'visible', timeout: 15000 });
        return { content: [{ type: 'text', text: `Visible: ${selector}` }] };
      } else {
        await p.waitForTimeout(ms || 2000);
        return { content: [{ type: 'text', text: `Waited ${ms || 2000}ms` }] };
      }
    } catch (err) {
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// ── browser_close ────────────────────────────────────────────────────────────
server.tool(
  'browser_close',
  {},
  async () => {
    try {
      if (browser) await browser.close();
      browser = null;
      page = null;
      return { content: [{ type: 'text', text: 'Browser closed' }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
