cat > ~/.openclaw/workspace/skills/cro-grader/scripts/cro-grader.js << 'EOF'
#!/usr/bin/env node
const { chromium } = require('playwright-core');
const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');

const args = process.argv.slice(2);
const getArg = (flag) => { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] : null; };

const URL_TO_GRADE = getArg('--url');
const FOCUS = getArg('--focus') || 'the entire page';

if (!URL_TO_GRADE) { console.error('Usage: node cro-grader.js --url <url>'); process.exit(1); }

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function run() {
  console.log(`\n🔍 CRO Grader — Analyzing: ${URL_TO_GRADE}\n`);
  const browser = await chromium.connectOverCDP('http://localhost:9222');
  const context = browser.contexts()[0];
  const page = await context.newPage();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(URL_TO_GRADE, { waitUntil: 'load', timeout: 45000 });
  await sleep(3000);
  const screenshotPath = `/tmp/cro-screenshot-${Date.now()}.png`;
  await page.screenshot({ path: screenshotPath, fullPage: false });
  console.log('✅ Screenshot captured\n');
  await page.close();

  const client = new Anthropic();
  const imageData = fs.readFileSync(screenshotPath).toString('base64');
  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1500,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: imageData } },
        { type: 'text', text: `You are a world-class CRO expert. Analyze this landing page and identify the 3 highest-impact improvements for conversion rate. Focus on: ${FOCUS}. For each: (1) What's wrong, (2) Why it hurts conversions, (3) The exact fix. End with a conversion grade [X/10].` }
      ]
    }]
  });

  const analysis = response.content[0].text;
  console.log('━'.repeat(60));
  console.log(`CRO ANALYSIS — ${URL_TO_GRADE}`);
  console.log('━'.repeat(60));
  console.log(analysis);

  const outputPath = `/tmp/cro-report-${Date.now()}.md`;
  fs.writeFileSync(outputPath, `# CRO Report — ${URL_TO_GRADE}\n_Generated: ${new Date().toLocaleString()}_\n\n${analysis}`);
  console.log(`\n📄 Report saved: ${outputPath}`);
  fs.unlinkSync(screenshotPath);
}

run().catch(e => { console.error('❌ Error:', e.message); process.exit(1); });
EOF
