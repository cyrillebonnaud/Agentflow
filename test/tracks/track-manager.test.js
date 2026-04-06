'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { initRun } = require('../../src/state/run-init');
const { readRunState } = require('../../src/state/run-state');
const {
  createTrack,
  markTrackDone,
  markTrackFailed,
  discardTrack,
  getSurvivingTracks,
  getTrackStatus,
} = require('../../src/tracks/track-manager');

async function makeTmpDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'track-manager-test-'));
}

async function makeRunDir(tmpDir) {
  const runDir = path.join(tmpDir, 'run-001');
  await fs.mkdir(runDir, { recursive: true });
  await initRun({
    runDir,
    flowId: 'test-flow',
    flowFile: '/tmp/flow.yaml',
    flowInput: {},
    steps: [{ id: 'step-1', type: 'lead', depends_on: [], condition: null }],
  });
  return runDir;
}

test('createTrack: adds track with pending status and version 1', async () => {
  const tmp = await makeTmpDir();
  const runDir = await makeRunDir(tmp);

  await createTrack(runDir, 'step-1', 'my-track');

  const state = await readRunState(runDir);
  const track = state.steps['step-1'].tracks['my-track'];
  assert.ok(track, 'track entry should exist');
  assert.equal(track.status, 'pending');
  assert.equal(track.version, 1);
});

test('createTrack: multiple tracks can be added to same step', async () => {
  const tmp = await makeTmpDir();
  const runDir = await makeRunDir(tmp);

  await createTrack(runDir, 'step-1', 'track-a');
  await createTrack(runDir, 'step-1', 'track-b');

  const state = await readRunState(runDir);
  const tracks = state.steps['step-1'].tracks;
  assert.ok(tracks['track-a'], 'track-a should exist');
  assert.ok(tracks['track-b'], 'track-b should exist');
  assert.equal(tracks['track-a'].status, 'pending');
  assert.equal(tracks['track-b'].status, 'pending');
});

test('markTrackDone: sets status to done and merges extra fields', async () => {
  const tmp = await makeTmpDir();
  const runDir = await makeRunDir(tmp);

  await createTrack(runDir, 'step-1', 'my-track');
  await markTrackDone(runDir, 'step-1', 'my-track', {
    artifact_path: '/artifacts/my-track.md',
    cost_usd: 0.05,
  });

  const state = await readRunState(runDir);
  const track = state.steps['step-1'].tracks['my-track'];
  assert.equal(track.status, 'done');
  assert.equal(track.artifact_path, '/artifacts/my-track.md');
  assert.equal(track.cost_usd, 0.05);
});

test('markTrackDone: works without extra fields', async () => {
  const tmp = await makeTmpDir();
  const runDir = await makeRunDir(tmp);

  await createTrack(runDir, 'step-1', 'simple-track');
  await markTrackDone(runDir, 'step-1', 'simple-track');

  const state = await readRunState(runDir);
  assert.equal(state.steps['step-1'].tracks['simple-track'].status, 'done');
});

test('markTrackFailed: sets status to failed and stores error', async () => {
  const tmp = await makeTmpDir();
  const runDir = await makeRunDir(tmp);

  await createTrack(runDir, 'step-1', 'bad-track');
  await markTrackFailed(runDir, 'step-1', 'bad-track', 'Something went wrong');

  const state = await readRunState(runDir);
  const track = state.steps['step-1'].tracks['bad-track'];
  assert.equal(track.status, 'failed');
  assert.equal(track.error, 'Something went wrong');
});

test('discardTrack: sets status to discarded', async () => {
  const tmp = await makeTmpDir();
  const runDir = await makeRunDir(tmp);

  await createTrack(runDir, 'step-1', 'unwanted-track');
  await discardTrack(runDir, 'step-1', 'unwanted-track');

  const state = await readRunState(runDir);
  const track = state.steps['step-1'].tracks['unwanted-track'];
  assert.equal(track.status, 'discarded');
});

test('getSurvivingTracks: returns only done tracks', async () => {
  const tmp = await makeTmpDir();
  const runDir = await makeRunDir(tmp);

  await createTrack(runDir, 'step-1', 'track-done');
  await createTrack(runDir, 'step-1', 'track-failed');
  await createTrack(runDir, 'step-1', 'track-discarded');
  await createTrack(runDir, 'step-1', 'track-pending');

  await markTrackDone(runDir, 'step-1', 'track-done');
  await markTrackFailed(runDir, 'step-1', 'track-failed', 'err');
  await discardTrack(runDir, 'step-1', 'track-discarded');
  // track-pending stays pending

  const surviving = await getSurvivingTracks(runDir, 'step-1');
  assert.deepEqual(surviving, ['track-done']);
});

test('getSurvivingTracks: returns empty array when no tracks', async () => {
  const tmp = await makeTmpDir();
  const runDir = await makeRunDir(tmp);

  const surviving = await getSurvivingTracks(runDir, 'step-1');
  assert.deepEqual(surviving, []);
});

test('getTrackStatus: returns correct status string', async () => {
  const tmp = await makeTmpDir();
  const runDir = await makeRunDir(tmp);

  await createTrack(runDir, 'step-1', 'my-track');
  assert.equal(await getTrackStatus(runDir, 'step-1', 'my-track'), 'pending');

  await markTrackDone(runDir, 'step-1', 'my-track');
  assert.equal(await getTrackStatus(runDir, 'step-1', 'my-track'), 'done');
});

test('getTrackStatus: returns null when track not found', async () => {
  const tmp = await makeTmpDir();
  const runDir = await makeRunDir(tmp);

  const status = await getTrackStatus(runDir, 'step-1', 'nonexistent');
  assert.equal(status, null);
});
