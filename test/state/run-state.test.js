'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {
  readRunState,
  writeRunState,
  updateRunState,
  markStepStatus,
  markTrackStatus,
} = require('../../src/state/run-state');

async function makeTmpDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'run-state-test-'));
}

async function writeInitialState(dir, state) {
  await fs.writeFile(path.join(dir, 'run.json'), JSON.stringify(state, null, 2), 'utf8');
}

test('readRunState reads and parses run.json', async () => {
  const dir = await makeTmpDir();
  const state = { flowId: 'test-flow', status: 'running', steps: {} };
  await writeInitialState(dir, state);

  const result = await readRunState(dir);
  assert.deepEqual(result, state);
});

test('writeRunState writes valid JSON to run.json', async () => {
  const dir = await makeTmpDir();
  const state = { flowId: 'my-flow', status: 'done', steps: { s1: { status: 'complete' } } };

  await writeRunState(dir, state);

  const raw = await fs.readFile(path.join(dir, 'run.json'), 'utf8');
  const parsed = JSON.parse(raw);
  assert.deepEqual(parsed, state);
  // Should be pretty-printed (contains newlines)
  assert.ok(raw.includes('\n'), 'JSON should be pretty-printed');
});

test('updateRunState applies patch function to current state', async () => {
  const dir = await makeTmpDir();
  const initial = { flowId: 'f1', status: 'pending', steps: {} };
  await writeInitialState(dir, initial);

  await updateRunState(dir, (state) => ({ ...state, status: 'running' }));

  const result = await readRunState(dir);
  assert.equal(result.status, 'running');
  assert.equal(result.flowId, 'f1');
});

test('concurrent updateRunState calls serialize correctly (no lost updates)', async () => {
  const dir = await makeTmpDir();
  await writeInitialState(dir, { counter: 0 });

  const N = 10;
  const updates = [];
  for (let i = 0; i < N; i++) {
    updates.push(
      updateRunState(dir, (state) => ({ ...state, counter: state.counter + 1 }))
    );
  }
  await Promise.all(updates);

  const result = await readRunState(dir);
  assert.equal(result.counter, N, `Expected counter to be ${N}, got ${result.counter}`);
});

test('markStepStatus sets step.status and merges extra fields', async () => {
  const dir = await makeTmpDir();
  await writeInitialState(dir, { steps: {} });

  await markStepStatus(dir, 'step-1', 'complete', { startedAt: '2026-01-01', output: 'done' });

  const state = await readRunState(dir);
  assert.equal(state.steps['step-1'].status, 'complete');
  assert.equal(state.steps['step-1'].startedAt, '2026-01-01');
  assert.equal(state.steps['step-1'].output, 'done');
});

test('markStepStatus works without extra fields', async () => {
  const dir = await makeTmpDir();
  await writeInitialState(dir, { steps: {} });

  await markStepStatus(dir, 'step-2', 'pending');

  const state = await readRunState(dir);
  assert.equal(state.steps['step-2'].status, 'pending');
});

test('markTrackStatus sets step.tracks[slug].status', async () => {
  const dir = await makeTmpDir();
  await writeInitialState(dir, { steps: { 'step-1': { status: 'running', tracks: {} } } });

  await markTrackStatus(dir, 'step-1', 'main', 'complete', { completedAt: '2026-01-02' });

  const state = await readRunState(dir);
  assert.equal(state.steps['step-1'].tracks['main'].status, 'complete');
  assert.equal(state.steps['step-1'].tracks['main'].completedAt, '2026-01-02');
});

test('markTrackStatus creates tracks object if missing', async () => {
  const dir = await makeTmpDir();
  await writeInitialState(dir, { steps: { 'step-1': { status: 'running' } } });

  await markTrackStatus(dir, 'step-1', 'alt', 'pending');

  const state = await readRunState(dir);
  assert.equal(state.steps['step-1'].tracks['alt'].status, 'pending');
});
