'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const { runFlow, depsResolved, buildConditionContext } = require('../../src/core/orchestrator');

async function makeTmpDir() {
  const dir = path.join(os.tmpdir(), `af-orch-${crypto.randomBytes(4).toString('hex')}`);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

// Creates a minimal flow YAML file and a fake agent MD
async function createFlowFixture(tmpDir, steps = null) {
  const flowsDir = path.join(tmpDir, 'flows');
  const agentsDir = path.join(tmpDir, 'agents');
  const runsDir = path.join(tmpDir, 'runs');
  await fs.mkdir(flowsDir, { recursive: true });
  await fs.mkdir(agentsDir, { recursive: true });
  await fs.mkdir(runsDir, { recursive: true });

  // Create a fake agent
  await fs.writeFile(path.join(agentsDir, 'test-agent.md'), '# Test Agent\nI am a test agent.');

  const defaultSteps = [{
    id: 'step-one',
    type: 'explore',
    lead: 'test-agent',
    artifacts: [{ name: 'step-one.md' }],
  }];

  const flow = {
    flow: {
      id: 'test-flow',
      steps: steps || defaultSteps,
    },
  };

  const flowFile = path.join(flowsDir, 'test-flow.yaml');
  const yaml = require('js-yaml');
  await fs.writeFile(flowFile, yaml.dump(flow), 'utf8');

  return { flowFile, runsDir, agentsDir };
}

// Build a fake registry with a test agent
function makeRegistry(agentPath) {
  return {
    agents: new Map([['test-agent', { path: agentPath, plugin: 'test' }]]),
    skills: new Map(),
    context: new Map(),
    templates: new Map(),
  };
}

// A fake claude subprocess that outputs a success JSON
function fakeClaudeScript(outputText) {
  return ['-e', `process.stdout.write(JSON.stringify({type:"result",subtype:"success",is_error:false,result:${JSON.stringify(outputText)}}))`];
}

describe('depsResolved', () => {
  it('returns true when no depends_on', () => {
    const step = { id: 'a', depends_on: [] };
    const runState = { steps: {} };
    assert.ok(depsResolved(step, runState));
  });

  it('returns true when all deps are done', () => {
    const step = { id: 'b', depends_on: ['a'] };
    const runState = { steps: { a: { status: 'done' } } };
    assert.ok(depsResolved(step, runState));
  });

  it('returns false when dep is still pending', () => {
    const step = { id: 'b', depends_on: ['a'] };
    const runState = { steps: { a: { status: 'pending' } } };
    assert.ok(!depsResolved(step, runState));
  });

  it('returns false when dep is missing from runState', () => {
    const step = { id: 'b', depends_on: ['missing'] };
    const runState = { steps: {} };
    assert.ok(!depsResolved(step, runState));
  });
});

describe('buildConditionContext', () => {
  it('includes flow input and step statuses', () => {
    const runState = {
      flow_input: 'hello',
      flow_id: 'test',
      steps: { 'step-a': { status: 'done', artifact_path: null } },
      user_feedback: {},
    };
    const ctx = buildConditionContext(runState);
    assert.equal(ctx.flow.input, 'hello');
    assert.equal(ctx.steps['step-a'].status, 'done');
  });
});

describe('runFlow — explore step', () => {
  let tmpDir;
  before(async () => { tmpDir = await makeTmpDir(); });
  after(async () => { await fs.rm(tmpDir, { recursive: true, force: true }); });

  it('runs a single explore step and produces an artifact', async () => {
    const { flowFile, runsDir, agentsDir } = await createFlowFixture(tmpDir);
    const registry = makeRegistry(path.join(agentsDir, 'test-agent.md'));

    // Override claude invocation to use node -e (fake subprocess)
    const originalSpawn = require('../../src/subprocess/runner').spawnSubprocess;
    // Monkey-patch spawnSubprocess for this test
    const runner = require('../../src/subprocess/runner');
    const saved = runner.spawnSubprocess;
    runner.spawnSubprocess = async ({ sentinelDir, promptContent, timeout }) => {
      const result = { type: 'result', subtype: 'success', is_error: false, result: '# Step One Output\nGenerated content.' };
      const fs2 = require('node:fs/promises');
      await fs2.writeFile(require('node:path').join(sentinelDir, 'output.md'), result.result);
      await fs2.writeFile(require('node:path').join(sentinelDir, '.done'), JSON.stringify({ result: result.result, cost_usd: 0 }));
    };

    try {
      const { runId, runDir, runState } = await runFlow({
        flowFile,
        flowInput: 'test input',
        runsDir,
        registry,
        config: { subprocessTimeoutMs: 5000, watchdogPollIntervalMs: 500 },
      });

      assert.ok(runId.startsWith('test-flow-'), `runId should start with flow id, got ${runId}`);
      assert.equal(runState.status, 'completed');
      assert.equal(runState.steps['step-one'].status, 'done');

      // Artifact should exist
      const artifactPath = path.join(runDir, 'artifacts', 'step-one.md');
      const artifactContent = await fs.readFile(artifactPath, 'utf8');
      assert.ok(artifactContent.includes('Generated content.'));
    } finally {
      runner.spawnSubprocess = saved;
    }
  });

  it('marks step as failed when subprocess fails', async () => {
    const { flowFile, runsDir, agentsDir } = await createFlowFixture(
      await makeTmpDir(),
    );
    const registry = makeRegistry(path.join(agentsDir, 'test-agent.md'));

    const runner = require('../../src/subprocess/runner');
    const saved = runner.spawnSubprocess;
    runner.spawnSubprocess = async ({ sentinelDir }) => {
      const fs2 = require('node:fs/promises');
      const p2 = require('node:path');
      await fs2.writeFile(p2.join(sentinelDir, '.failed'), JSON.stringify({ reason: 'non_zero_exit', error: 'test error' }));
    };

    try {
      await assert.rejects(
        () => runFlow({ flowFile, flowInput: 'test', runsDir, registry, config: { subprocessTimeoutMs: 5000, watchdogPollIntervalMs: 500 } }),
        /failed/i
      );
    } finally {
      runner.spawnSubprocess = saved;
    }
  });

  it('skips steps with a false condition', async () => {
    const tmpDir2 = await makeTmpDir();
    const { flowFile, runsDir, agentsDir } = await createFlowFixture(tmpDir2, [
      {
        id: 'conditional-step',
        type: 'explore',
        lead: 'test-agent',
        condition: "flow.input contains 'skip-me'",  // will be false for our input
        artifacts: [{ name: 'out.md' }],
      },
    ]);
    const registry = makeRegistry(path.join(agentsDir, 'test-agent.md'));

    // Input does NOT contain 'skip-me', but condition uses 'contains' — let's use input that doesn't match
    // Actually condition says "contains 'skip-me'" so input 'hello' -> false -> skip
    const { runState } = await runFlow({
      flowFile,
      flowInput: 'hello world',
      runsDir,
      registry,
      config: { subprocessTimeoutMs: 5000, watchdogPollIntervalMs: 500 },
    });

    assert.equal(runState.steps['conditional-step'].status, 'skipped');
    await fs.rm(tmpDir2, { recursive: true, force: true });
  });

  it('respects depends_on ordering (runs step2 after step1 done)', async () => {
    const tmpDir3 = await makeTmpDir();
    const order = [];
    const { flowFile, runsDir, agentsDir } = await createFlowFixture(tmpDir3, [
      { id: 'step1', type: 'explore', lead: 'test-agent', artifacts: [{ name: 'step1.md' }] },
      { id: 'step2', type: 'explore', lead: 'test-agent', depends_on: ['step1'], artifacts: [{ name: 'step2.md' }] },
    ]);
    const registry = makeRegistry(path.join(agentsDir, 'test-agent.md'));

    const runner = require('../../src/subprocess/runner');
    const saved = runner.spawnSubprocess;
    runner.spawnSubprocess = async ({ sentinelDir }) => {
      const stepName = sentinelDir.split(require('node:path').sep).slice(-3)[0];
      order.push(stepName);
      const fs2 = require('node:fs/promises');
      const p2 = require('node:path');
      await fs2.writeFile(p2.join(sentinelDir, 'output.md'), `output of ${stepName}`);
      await fs2.writeFile(p2.join(sentinelDir, '.done'), JSON.stringify({ result: 'ok', cost_usd: 0 }));
    };

    try {
      const { runState } = await runFlow({
        flowFile, flowInput: 'test', runsDir, registry,
        config: { subprocessTimeoutMs: 5000, watchdogPollIntervalMs: 500 },
      });

      assert.equal(runState.steps.step1.status, 'done');
      assert.equal(runState.steps.step2.status, 'done');
      assert.equal(order[0], 'step1', 'step1 should run before step2');
    } finally {
      runner.spawnSubprocess = saved;
      await fs.rm(tmpDir3, { recursive: true, force: true });
    }
  });
});
