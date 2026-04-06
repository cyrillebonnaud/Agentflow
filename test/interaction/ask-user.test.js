'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { initRun } = require('../../src/state/run-init');
const { readRunState } = require('../../src/state/run-state');
const { writeUserRequest, readUserResponse, hasUserResponse } = require('../../src/interaction/ask-user');

async function makeRunDir() {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ask-user-test-'));
  const runDir = path.join(tmpDir, 'run-001');
  await fs.mkdir(runDir, { recursive: true });
  await initRun({
    runDir,
    flowId: 'test-flow',
    flowFile: 'flow.yaml',
    flowInput: {},
    steps: [{ id: 'step-1', type: 'lead', depends_on: [], condition: null }],
  });
  return runDir;
}

test('writeUserRequest creates user-feedback-request.json in step dir', async () => {
  const runDir = await makeRunDir();
  await writeUserRequest(runDir, 'step-1', {
    question: 'Please review this step',
    options: ['approve', 'reject'],
    type: 'validate',
  });

  const requestPath = path.join(runDir, 'steps', 'step-1', 'user-feedback-request.json');
  const raw = await fs.readFile(requestPath, 'utf8');
  const parsed = JSON.parse(raw);

  assert.equal(parsed.question, 'Please review this step');
  assert.deepEqual(parsed.options, ['approve', 'reject']);
  assert.equal(parsed.type, 'validate');
});

test('writeUserRequest updates run.json status to "paused"', async () => {
  const runDir = await makeRunDir();
  await writeUserRequest(runDir, 'step-1', {
    question: 'Make a decision',
    options: [],
    type: 'decisions',
  });

  const state = await readRunState(runDir);
  assert.equal(state.status, 'paused');
});

test('writeUserRequest sets step status to "awaiting_validation" for validate type', async () => {
  const runDir = await makeRunDir();
  await writeUserRequest(runDir, 'step-1', {
    question: 'Validate this',
    options: [],
    type: 'validate',
  });

  const state = await readRunState(runDir);
  assert.equal(state.steps['step-1'].status, 'awaiting_validation');
});

test('writeUserRequest sets step status to "awaiting_track_selection" for track_selection type', async () => {
  const runDir = await makeRunDir();
  await writeUserRequest(runDir, 'step-1', {
    question: 'Select a track',
    options: ['track-a', 'track-b'],
    type: 'track_selection',
  });

  const state = await readRunState(runDir);
  assert.equal(state.steps['step-1'].status, 'awaiting_track_selection');
});

test('readUserResponse returns null when file does not exist', async () => {
  const runDir = await makeRunDir();
  const result = await readUserResponse(runDir, 'step-1');
  assert.equal(result, null);
});

test('readUserResponse returns parsed feedback when file exists', async () => {
  const runDir = await makeRunDir();
  const feedbackContent = `# User Feedback — step-1 / lead / v1

## Decisions
- Approve changes: yes

## Free feedback
Looks good.

## Action
validate → proceed
`;
  const feedbackDir = path.join(runDir, 'steps', 'step-1');
  await fs.mkdir(feedbackDir, { recursive: true });
  await fs.writeFile(path.join(feedbackDir, 'user-feedback.md'), feedbackContent, 'utf8');

  const result = await readUserResponse(runDir, 'step-1');
  assert.ok(result !== null);
  assert.equal(result.action, 'validate');
});

test('hasUserResponse returns false initially', async () => {
  const runDir = await makeRunDir();
  const result = await hasUserResponse(runDir, 'step-1');
  assert.equal(result, false);
});

test('hasUserResponse returns true after user-feedback.md is written', async () => {
  const runDir = await makeRunDir();
  const feedbackDir = path.join(runDir, 'steps', 'step-1');
  await fs.mkdir(feedbackDir, { recursive: true });
  await fs.writeFile(path.join(feedbackDir, 'user-feedback.md'), '# Feedback\n', 'utf8');

  const result = await hasUserResponse(runDir, 'step-1');
  assert.equal(result, true);
});
