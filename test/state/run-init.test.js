'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { initRun } = require('../../src/state/run-init');

async function makeTmpDir() {
  const suffix = crypto.randomBytes(4).toString('hex');
  const dir = path.join(os.tmpdir(), `run-init-test-${suffix}`);
  // Do NOT pre-create the dir; initRun must create it
  return dir;
}

const SAMPLE_STEPS = [
  { id: 'step-a', type: 'prompt', depends_on: [], condition: null },
  { id: 'step-b', type: 'parallel', depends_on: ['step-a'], condition: 'some-condition' },
];

test('creates run.json with correct fields', async () => {
  const runDir = await makeTmpDir();
  await fs.mkdir(runDir, { recursive: true });

  const before = new Date();
  await initRun({
    runDir,
    flowId: 'my-flow',
    flowFile: 'flows/my-flow.yml',
    flowInput: { topic: 'hello' },
    steps: SAMPLE_STEPS,
  });
  const after = new Date();

  const raw = await fs.readFile(path.join(runDir, 'run.json'), 'utf8');
  const state = JSON.parse(raw);

  assert.equal(state.run_id, path.basename(runDir));
  assert.equal(state.flow_id, 'my-flow');
  assert.equal(state.flow_file, 'flows/my-flow.yml');
  assert.deepEqual(state.flow_input, { topic: 'hello' });
  assert.equal(state.status, 'running');

  const createdAt = new Date(state.created_at);
  const updatedAt = new Date(state.updated_at);
  assert.ok(createdAt >= before && createdAt <= after, 'created_at should be within test window');
  assert.ok(updatedAt >= before && updatedAt <= after, 'updated_at should be within test window');
});

test('creates artifacts/ and steps/ subdirectories', async () => {
  const runDir = await makeTmpDir();
  await fs.mkdir(runDir, { recursive: true });

  await initRun({
    runDir,
    flowId: 'dir-test',
    flowFile: 'flows/dir-test.yml',
    flowInput: {},
    steps: [],
  });

  const artifactsStat = await fs.stat(path.join(runDir, 'artifacts'));
  const stepsStat = await fs.stat(path.join(runDir, 'steps'));

  assert.ok(artifactsStat.isDirectory(), 'artifacts/ should be a directory');
  assert.ok(stepsStat.isDirectory(), 'steps/ should be a directory');
});

test('steps map has correct initial statuses (pending)', async () => {
  const runDir = await makeTmpDir();
  await fs.mkdir(runDir, { recursive: true });

  await initRun({
    runDir,
    flowId: 'steps-test',
    flowFile: 'flows/steps-test.yml',
    flowInput: {},
    steps: SAMPLE_STEPS,
  });

  const raw = await fs.readFile(path.join(runDir, 'run.json'), 'utf8');
  const state = JSON.parse(raw);

  assert.ok(state.steps, 'steps should be present');
  assert.equal(Object.keys(state.steps).length, SAMPLE_STEPS.length);

  for (const step of SAMPLE_STEPS) {
    const entry = state.steps[step.id];
    assert.ok(entry, `step ${step.id} should exist in map`);
    assert.equal(entry.id, step.id);
    assert.equal(entry.type, step.type);
    assert.equal(entry.status, 'pending');
    assert.deepEqual(entry.depends_on, step.depends_on);
    assert.equal(entry.condition, step.condition);
  }
});

test('throws if run.json already exists (idempotency guard)', async () => {
  const runDir = await makeTmpDir();
  await fs.mkdir(runDir, { recursive: true });

  // Write an existing run.json to simulate an already-initialized run
  await fs.writeFile(path.join(runDir, 'run.json'), '{}', 'utf8');

  await assert.rejects(
    () =>
      initRun({
        runDir,
        flowId: 'dupe-flow',
        flowFile: 'flows/dupe.yml',
        flowInput: {},
        steps: [],
      }),
    (err) => {
      assert.ok(err instanceof Error, 'should throw an Error');
      return true;
    }
  );
});
