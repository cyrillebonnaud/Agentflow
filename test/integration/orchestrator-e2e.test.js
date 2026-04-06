'use strict';

/**
 * Integration test — runs the quick-prototype flow end-to-end using fake agents.
 *
 * This test exercises the full orchestrator pipeline:
 *   explore step → artifact stored → next step → context injected → artifacts/
 *
 * Uses monkey-patched runner.spawnSubprocess so no real Claude invocation is made.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const yaml = require('js-yaml');

const { runFlow } = require('../../src/core/orchestrator');
const runner = require('../../src/subprocess/runner');

async function makeTmpDir() {
  const dir = path.join(os.tmpdir(), `af-e2e-${crypto.randomBytes(4).toString('hex')}`);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

/**
 * Build a minimal registry with fake agents from a tmp agents dir.
 */
function makeRegistry(agentPaths) {
  const agents = new Map();
  for (const [id, filePath] of Object.entries(agentPaths)) {
    agents.set(id, { path: filePath, plugin: 'test' });
  }
  return { agents, skills: new Map(), context: new Map(), templates: new Map() };
}

/**
 * Create a fake agent MD file.
 */
async function createAgent(dir, id, content) {
  const filePath = path.join(dir, `${id}.md`);
  await fs.writeFile(filePath, content || `# ${id}\nI am the ${id} agent.`, 'utf8');
  return filePath;
}

/**
 * Build a flows dir with the quick-prototype YAML, pointing to stepTemplatesDir.
 */
async function createQuickPrototypeFlow(tmpDir, agentIds) {
  const flowsDir = path.join(tmpDir, 'flows');
  const stepTemplatesDir = path.join(tmpDir, 'step-templates');
  await fs.mkdir(flowsDir, { recursive: true });
  await fs.mkdir(stepTemplatesDir, { recursive: true });

  const flow = {
    flow: {
      id: 'quick-prototype-v1',
      name: 'Quick Prototype',
      steps: [
        {
          id: 'mini-prd',
          type: 'explore',
          lead: agentIds[0],
          artifacts: [{ name: 'mini-prd.md' }],
        },
        {
          id: 'ux-brief',
          type: 'explore',
          lead: agentIds[1] || agentIds[0],
          depends_on: ['mini-prd'],
          artifacts: [{ name: 'ux-brief.md' }],
          context: ['artifacts.mini-prd', 'flow.input'],
        },
        {
          id: 'ux-directions',
          type: 'explore',
          lead: agentIds[1] || agentIds[0],
          depends_on: ['ux-brief'],
          artifact_type: 'md',
          context: ['artifacts.mini-prd', 'artifacts.ux-brief', 'flow.input'],
        },
      ],
    },
  };

  const flowFile = path.join(flowsDir, 'quick-prototype.yaml');
  await fs.writeFile(flowFile, yaml.dump(flow), 'utf8');
  return { flowFile, stepTemplatesDir };
}

describe('Integration: quick-prototype flow (3 explore steps)', () => {
  let tmpDir;
  let agentsDir;
  let runsDir;
  let savedSpawn;
  const capturedPrompts = [];

  before(async () => {
    tmpDir = await makeTmpDir();
    agentsDir = path.join(tmpDir, 'agents');
    runsDir = path.join(tmpDir, 'runs');
    await fs.mkdir(agentsDir, { recursive: true });
    await fs.mkdir(runsDir, { recursive: true });

    // Save and replace runner.spawnSubprocess with fake
    savedSpawn = runner.spawnSubprocess;
    runner.spawnSubprocess = async ({ sentinelDir, promptContent }) => {
      capturedPrompts.push({ sentinelDir, promptContent });
      const step = path.basename(path.dirname(path.dirname(sentinelDir)));
      const output = `# Output for ${step}\n\nGenerated content for ${step}.\n\nThis is the artifact.`;
      await fs.writeFile(path.join(sentinelDir, 'output.md'), output, 'utf8');
      await fs.writeFile(
        path.join(sentinelDir, '.done'),
        JSON.stringify({ result: output, cost_usd: 0.01 }),
        'utf8'
      );
    };
  });

  after(async () => {
    runner.spawnSubprocess = savedSpawn;
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('completes with status=completed', async () => {
    const pmPath = await createAgent(agentsDir, 'product-manager');
    const uxPath = await createAgent(agentsDir, 'ux-designer');
    const registry = makeRegistry({ 'product-manager': pmPath, 'ux-designer': uxPath });

    const { flowFile } = await createQuickPrototypeFlow(tmpDir, ['product-manager', 'ux-designer']);

    const { runState } = await runFlow({
      flowFile,
      flowInput: 'Expense approval flow for mobile',
      runsDir,
      registry,
      config: { subprocessTimeoutMs: 10000, watchdogPollIntervalMs: 1000 },
    });

    assert.equal(runState.status, 'completed', `expected completed, got ${runState.status}`);
  });

  it('all 3 steps are done', async () => {
    const runs = await fs.readdir(runsDir);
    const runId = runs.filter(r => r !== '.gitkeep')[0];
    const runStateRaw = await fs.readFile(path.join(runsDir, runId, 'run.json'), 'utf8');
    const runState = JSON.parse(runStateRaw);

    assert.equal(runState.steps['mini-prd'].status, 'done', 'mini-prd should be done');
    assert.equal(runState.steps['ux-brief'].status, 'done', 'ux-brief should be done');
    assert.equal(runState.steps['ux-directions'].status, 'done', 'ux-directions should be done');
  });

  it('mini-prd artifact exists at artifacts/mini-prd.md', async () => {
    const runs = await fs.readdir(runsDir);
    const runId = runs.filter(r => r !== '.gitkeep')[0];
    const artifactPath = path.join(runsDir, runId, 'artifacts', 'mini-prd.md');
    const content = await fs.readFile(artifactPath, 'utf8');
    assert.ok(content.includes('Generated content'), 'artifact should have generated content');
  });

  it('ux-brief artifact exists at artifacts/ux-brief.md', async () => {
    const runs = await fs.readdir(runsDir);
    const runId = runs.filter(r => r !== '.gitkeep')[0];
    const content = await fs.readFile(path.join(runsDir, runId, 'artifacts', 'ux-brief.md'), 'utf8');
    assert.ok(content.length > 0, 'ux-brief artifact should not be empty');
  });

  it('ux-directions artifact exists', async () => {
    const runs = await fs.readdir(runsDir);
    const runId = runs.filter(r => r !== '.gitkeep')[0];
    const artifactsDir = path.join(runsDir, runId, 'artifacts');
    const entries = await fs.readdir(artifactsDir);
    const hasDirOrFile = entries.some(e => e.includes('ux-directions') || e === 'ux-directions');
    assert.ok(hasDirOrFile, 'ux-directions artifact should exist');
  });

  it('steps ran in dependency order (mini-prd before ux-brief)', async () => {
    // Verify that mini-prd prompt was captured before ux-brief prompt
    const prdIndex = capturedPrompts.findIndex(p => p.sentinelDir.includes('mini-prd'));
    const uxBriefIndex = capturedPrompts.findIndex(p => p.sentinelDir.includes('ux-brief'));
    assert.ok(prdIndex >= 0, 'mini-prd should have been spawned');
    assert.ok(uxBriefIndex >= 0, 'ux-brief should have been spawned');
    assert.ok(prdIndex < uxBriefIndex, 'mini-prd should run before ux-brief');
  });

  it('ux-brief prompt includes mini-prd artifact content (context injection)', async () => {
    const uxBriefPrompt = capturedPrompts.find(p => p.sentinelDir.includes('ux-brief'));
    assert.ok(uxBriefPrompt, 'ux-brief should have been spawned');
    // The prompt should include prior artifact content since context: [artifacts.mini-prd]
    assert.ok(
      uxBriefPrompt.promptContent.includes('mini-prd') ||
      uxBriefPrompt.promptContent.includes('Generated content') ||
      uxBriefPrompt.promptContent.includes('Flow context'),
      'ux-brief prompt should include context from prior steps'
    );
  });
});

describe('Integration: conditional step skipping', () => {
  let tmpDir;
  let savedSpawn;

  before(async () => {
    tmpDir = await makeTmpDir();
    savedSpawn = runner.spawnSubprocess;
    runner.spawnSubprocess = async ({ sentinelDir }) => {
      const output = 'Generated output without enterprise or compliance mention.';
      await fs.writeFile(path.join(sentinelDir, 'output.md'), output, 'utf8');
      await fs.writeFile(path.join(sentinelDir, '.done'), JSON.stringify({ result: output, cost_usd: 0 }), 'utf8');
    };
  });

  after(async () => {
    runner.spawnSubprocess = savedSpawn;
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('skips step when condition is false', async () => {
    const agentsDir = path.join(tmpDir, 'agents');
    const runsDir = path.join(tmpDir, 'runs');
    const flowsDir = path.join(tmpDir, 'flows');
    await fs.mkdir(agentsDir, { recursive: true });
    await fs.mkdir(runsDir, { recursive: true });
    await fs.mkdir(flowsDir, { recursive: true });

    const agentPath = await createAgent(agentsDir, 'pm');

    const flow = {
      flow: {
        id: 'cond-test',
        steps: [
          { id: 'step-a', type: 'explore', lead: 'pm', artifacts: [{ name: 'a.md' }] },
          {
            id: 'step-b',
            type: 'explore',
            lead: 'pm',
            depends_on: ['step-a'],
            condition: "flow.input contains 'enterprise'",
            artifacts: [{ name: 'b.md' }],
          },
        ],
      },
    };

    const flowFile = path.join(flowsDir, 'cond.yaml');
    await fs.writeFile(flowFile, yaml.dump(flow), 'utf8');

    const registry = makeRegistry({ pm: agentPath });
    const { runState } = await runFlow({
      flowFile,
      flowInput: 'simple consumer app',  // no 'enterprise'
      runsDir,
      registry,
      config: { subprocessTimeoutMs: 5000, watchdogPollIntervalMs: 500 },
    });

    assert.equal(runState.steps['step-a'].status, 'done');
    assert.equal(runState.steps['step-b'].status, 'skipped');
    assert.equal(runState.status, 'completed');
  });
});
