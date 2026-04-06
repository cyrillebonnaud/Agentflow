'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { storeArtifact, readArtifact, listArtifacts } = require('../../src/state/artifact-store');

async function makeTmpDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'artifact-store-test-'));
  // Create the artifacts dir as initRun would
  await fs.mkdir(path.join(dir, 'artifacts'), { recursive: true });
  return dir;
}

test('storeArtifact writes to artifacts/<stepId>.md when no trackSlug', async () => {
  const runDir = await makeTmpDir();
  const content = 'Hello artifact';
  const relPath = await storeArtifact(runDir, 'step-1', content);

  assert.equal(relPath, 'artifacts/step-1.md');
  const written = await fs.readFile(path.join(runDir, 'artifacts', 'step-1.md'), 'utf8');
  assert.equal(written, content);
});

test('storeArtifact writes to artifacts/<stepId>/<trackSlug>.md when trackSlug provided', async () => {
  const runDir = await makeTmpDir();
  const content = 'Track artifact content';
  const relPath = await storeArtifact(runDir, 'step-2', content, 'review-track');

  assert.equal(relPath, 'artifacts/step-2/review-track.md');
  const written = await fs.readFile(path.join(runDir, 'artifacts', 'step-2', 'review-track.md'), 'utf8');
  assert.equal(written, content);
});

test('readArtifact reads correct content for step without track', async () => {
  const runDir = await makeTmpDir();
  const content = 'Some content here';
  await storeArtifact(runDir, 'step-3', content);

  const result = await readArtifact(runDir, 'step-3');
  assert.equal(result, content);
});

test('readArtifact reads correct content for step with track', async () => {
  const runDir = await makeTmpDir();
  const content = 'Track specific content';
  await storeArtifact(runDir, 'step-4', content, 'my-track');

  const result = await readArtifact(runDir, 'step-4', 'my-track');
  assert.equal(result, content);
});

test('readArtifact returns null for missing artifact', async () => {
  const runDir = await makeTmpDir();
  const result = await readArtifact(runDir, 'nonexistent-step');
  assert.equal(result, null);
});

test('readArtifact returns null for missing track artifact', async () => {
  const runDir = await makeTmpDir();
  const result = await readArtifact(runDir, 'step-x', 'missing-track');
  assert.equal(result, null);
});

test('listArtifacts finds all artifacts including single and multi-track', async () => {
  const runDir = await makeTmpDir();
  await storeArtifact(runDir, 'step-a', 'content a');
  await storeArtifact(runDir, 'step-b', 'content b track 1', 'track-1');
  await storeArtifact(runDir, 'step-b', 'content b track 2', 'track-2');

  const artifacts = await listArtifacts(runDir);

  assert.equal(artifacts.length, 3);

  const stepA = artifacts.find(a => a.stepId === 'step-a');
  assert.ok(stepA, 'should find step-a artifact');
  assert.equal(stepA.trackSlug, null);
  assert.equal(stepA.path, 'artifacts/step-a.md');

  const track1 = artifacts.find(a => a.stepId === 'step-b' && a.trackSlug === 'track-1');
  assert.ok(track1, 'should find step-b/track-1 artifact');
  assert.equal(track1.path, 'artifacts/step-b/track-1.md');

  const track2 = artifacts.find(a => a.stepId === 'step-b' && a.trackSlug === 'track-2');
  assert.ok(track2, 'should find step-b/track-2 artifact');
  assert.equal(track2.path, 'artifacts/step-b/track-2.md');
});

test('listArtifacts returns empty array when no artifacts exist', async () => {
  const runDir = await makeTmpDir();
  const artifacts = await listArtifacts(runDir);
  assert.deepEqual(artifacts, []);
});
