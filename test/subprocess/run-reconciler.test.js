'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { initRun } = require('../../src/state/run-init');
const { markStepStatus, readRunState } = require('../../src/state/run-state');
const { reconcileRun, checkLivePid } = require('../../src/subprocess/run-reconciler');

async function makeRunDir(steps) {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'run-reconciler-test-'));
  const runDir = path.join(tmpDir, 'run-001');
  await fs.mkdir(runDir, { recursive: true });
  await initRun({
    runDir,
    flowId: 'test-flow',
    flowFile: 'flow.yaml',
    flowInput: {},
    steps: steps || [{ id: 'step-1', type: 'lead', depends_on: [], condition: null }],
  });
  return runDir;
}

test('reconcileRun updates step status to "done" when .done sentinel exists but run.json shows "running_lead"', async () => {
  const runDir = await makeRunDir();
  // Mark step as running in run.json
  await markStepStatus(runDir, 'step-1', 'running_lead');

  // Create the steps/step-1 dir and a .done sentinel
  const stepDir = path.join(runDir, 'steps', 'step-1');
  await fs.mkdir(stepDir, { recursive: true });
  await fs.writeFile(path.join(stepDir, '.done'), '', 'utf8');

  const result = await reconcileRun(runDir);

  assert.ok(result.reconciled.includes('step-1'), 'step-1 should be in reconciled');

  const state = await readRunState(runDir);
  assert.equal(state.steps['step-1'].status, 'done');
});

test('reconcileRun marks step failed when .failed sentinel exists', async () => {
  const runDir = await makeRunDir();
  await markStepStatus(runDir, 'step-1', 'running_lead');

  const stepDir = path.join(runDir, 'steps', 'step-1');
  await fs.mkdir(stepDir, { recursive: true });
  await fs.writeFile(path.join(stepDir, '.failed'), '', 'utf8');

  const result = await reconcileRun(runDir);

  assert.ok(result.reconciled.includes('step-1'), 'step-1 should be in reconciled');

  const state = await readRunState(runDir);
  assert.equal(state.steps['step-1'].status, 'failed');
});

test('reconcileRun returns step in stillRunning when no sentinel and alive PID', async () => {
  const runDir = await makeRunDir();
  await markStepStatus(runDir, 'step-1', 'running_lead');

  // Create step dir with a .pid file pointing to the current process (alive)
  const stepDir = path.join(runDir, 'steps', 'step-1');
  await fs.mkdir(stepDir, { recursive: true });
  await fs.writeFile(path.join(stepDir, '.pid'), String(process.pid), 'utf8');

  const result = await reconcileRun(runDir);

  assert.ok(result.stillRunning.includes('step-1'), 'step-1 should be in stillRunning');
});

test('reconcileRun returns step in requeued when no sentinel and dead/no PID', async () => {
  const runDir = await makeRunDir();
  await markStepStatus(runDir, 'step-1', 'running_lead');

  // Create step dir with no .pid file and no sentinel
  const stepDir = path.join(runDir, 'steps', 'step-1');
  await fs.mkdir(stepDir, { recursive: true });

  const result = await reconcileRun(runDir);

  assert.ok(result.requeued.includes('step-1'), 'step-1 should be in requeued');
});

test('reconcileRun handles running_reviews and running_moderator statuses', async () => {
  const runDir = await makeRunDir([
    { id: 'step-a', type: 'lead', depends_on: [], condition: null },
    { id: 'step-b', type: 'reviews', depends_on: [], condition: null },
  ]);
  await markStepStatus(runDir, 'step-a', 'running_reviews');
  await markStepStatus(runDir, 'step-b', 'running_moderator');

  // Write .done for step-a
  const stepDirA = path.join(runDir, 'steps', 'step-a');
  await fs.mkdir(stepDirA, { recursive: true });
  await fs.writeFile(path.join(stepDirA, '.done'), '', 'utf8');

  // No sentinel for step-b, no pid
  const stepDirB = path.join(runDir, 'steps', 'step-b');
  await fs.mkdir(stepDirB, { recursive: true });

  const result = await reconcileRun(runDir);

  assert.ok(result.reconciled.includes('step-a'));
  assert.ok(result.requeued.includes('step-b'));
});

test('checkLivePid returns "alive" for current process PID', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pid-test-'));
  await fs.writeFile(path.join(tmpDir, '.pid'), String(process.pid), 'utf8');

  const result = await checkLivePid(tmpDir);
  assert.equal(result, 'alive');
});

test('checkLivePid returns "dead" for non-existent PID (99999999)', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pid-test-'));
  await fs.writeFile(path.join(tmpDir, '.pid'), '99999999', 'utf8');

  const result = await checkLivePid(tmpDir);
  assert.equal(result, 'dead');
});

test('checkLivePid returns "no_pid" when .pid file missing', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pid-test-'));

  const result = await checkLivePid(tmpDir);
  assert.equal(result, 'no_pid');
});
