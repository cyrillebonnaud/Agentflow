'use strict';

/**
 * Run the quick-prototype flow for "a quiz app" with REAL Claude invocations.
 *
 * Usage: node scripts/run-quiz-app-real.js
 */

const path = require('node:path');
const fs = require('node:fs/promises');
const os = require('node:os');
const crypto = require('node:crypto');
const yaml = require('js-yaml');

const { runFlow } = require('../src/core/orchestrator');

const FLOW_INPUT = 'A quiz app — users create and take quizzes on any topic, with scoring and leaderboards';

async function main() {
  const tmpDir = path.join(os.tmpdir(), `af-quiz-real-${crypto.randomBytes(4).toString('hex')}`);
  const agentsDir = path.join(tmpDir, 'agents');
  const runsDir = path.join(tmpDir, 'runs');

  await fs.mkdir(agentsDir, { recursive: true });
  await fs.mkdir(runsDir, { recursive: true });

  // Minimal agent files — each just holds a role description
  const agents = {
    'product-manager': '# Product Manager\nYou are an expert product manager. Write concise, structured product documents in Markdown.',
    'ux-designer': '# UX Designer\nYou are a senior UX designer. Write clear UX briefs and direction documents in Markdown.',
  };
  for (const [id, content] of Object.entries(agents)) {
    await fs.writeFile(path.join(agentsDir, `${id}.md`), content, 'utf8');
  }

  const registry = {
    agents: new Map(
      Object.keys(agents).map(id => [id, { path: path.join(agentsDir, `${id}.md`), plugin: 'local' }])
    ),
    skills: new Map(),
    context: new Map(),
    templates: new Map(),
  };

  const flowFile = path.resolve(__dirname, '../flows/quick-prototype.yaml');

  console.log('=== Agentflow: quick-prototype (real Claude) ===');
  console.log(`Input : "${FLOW_INPUT}"`);
  console.log(`Flow  : ${flowFile}\n`);

  const start = Date.now();

  const { runId, runDir, runState } = await runFlow({
    flowFile,
    flowInput: FLOW_INPUT,
    runsDir,
    registry,
    config: { subprocessTimeoutMs: 120000, watchdogPollIntervalMs: 2000 },
  });

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);

  console.log(`\nRun ID  : ${runId}`);
  console.log(`Status  : ${runState.status}`);
  console.log(`Elapsed : ${elapsed}s\n`);

  console.log('Steps:');
  for (const [stepId, step] of Object.entries(runState.steps)) {
    const icon = step.status === 'done' ? '✓' : step.status === 'skipped' ? '→' : '✗';
    const cost = step.cost_usd ? ` ($${step.cost_usd.toFixed(4)})` : '';
    console.log(`  ${icon} ${stepId}: ${step.status}${cost}`);
  }

  console.log('\nArtifacts:');
  const artifactsDir = path.join(runDir, 'artifacts');

  async function printArtifacts(dir, indent = '  ') {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        console.log(`${indent}${entry.name}/`);
        await printArtifacts(full, indent + '  ');
      } else {
        const content = await fs.readFile(full, 'utf8');
        console.log(`\n${indent}── ${entry.name} ──`);
        console.log(content.trim());
      }
    }
  }

  await printArtifacts(artifactsDir);

  // Copy artifacts to local ./runs/ for inspection
  const localRunDir = path.resolve(__dirname, '..', 'runs', path.basename(runDir));
  await fs.cp(runDir, localRunDir, { recursive: true });
  console.log(`\nArtifacts saved to: runs/${path.basename(runDir)}/artifacts/`);

  await fs.rm(tmpDir, { recursive: true, force: true });
}

main().catch(err => {
  console.error('Error:', err.message);
  console.error(err.stack);
  process.exit(1);
});
