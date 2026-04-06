'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const { readReviewOutputs, checkConvergence, writeSynthesis } = require('../../src/review/moderator');

async function makeTmpDir() {
  const dir = path.join(os.tmpdir(), `af-moderator-${crypto.randomBytes(4).toString('hex')}`);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

// Helper: create sentinel dir with output.md for a reviewer
async function writeReviewerOutput(runDir, stepId, trackSlug, version, round, reviewerId, content) {
  const dir = path.join(
    runDir,
    'steps', stepId, trackSlug, `v${version}`, 'reviews', `round-${round}`, reviewerId
  );
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'output.md'), content, 'utf8');
  // Write .done so readReviewOutputs knows it's finished
  await fs.writeFile(path.join(dir, '.done'), JSON.stringify({ result: content }), 'utf8');
}

describe('moderator: readReviewOutputs', () => {
  let tmpDir;
  before(async () => { tmpDir = await makeTmpDir(); });
  after(async () => { await fs.rm(tmpDir, { recursive: true, force: true }); });

  it('reads reviewer output files for a given round', async () => {
    const runDir = path.join(tmpDir, 'run-read');
    await fs.mkdir(runDir, { recursive: true });

    await writeReviewerOutput(runDir, 'step1', 'main', 1, 1, 'reviewer-a', 'Review from A');
    await writeReviewerOutput(runDir, 'step1', 'main', 1, 1, 'reviewer-b', 'Review from B');

    const outputs = await readReviewOutputs(runDir, 'step1', 'main', 1, 1, ['reviewer-a', 'reviewer-b']);
    assert.equal(outputs.length, 2);

    const ids = outputs.map(o => o.reviewerId).sort();
    assert.deepEqual(ids, ['reviewer-a', 'reviewer-b']);

    const byId = Object.fromEntries(outputs.map(o => [o.reviewerId, o.content]));
    assert.equal(byId['reviewer-a'], 'Review from A');
    assert.equal(byId['reviewer-b'], 'Review from B');
  });

  it('returns empty content string if output.md is missing', async () => {
    const runDir = path.join(tmpDir, 'run-missing');
    await fs.mkdir(runDir, { recursive: true });

    // Create dir without output.md
    const dir = path.join(runDir, 'steps', 'step1', 'main', 'v1', 'reviews', 'round-1', 'reviewer-x');
    await fs.mkdir(dir, { recursive: true });

    const outputs = await readReviewOutputs(runDir, 'step1', 'main', 1, 1, ['reviewer-x']);
    assert.equal(outputs.length, 1);
    assert.equal(outputs[0].reviewerId, 'reviewer-x');
    assert.equal(outputs[0].content, '');
  });
});

describe('moderator: checkConvergence', () => {
  it('returns true when output contains "CONVERGED" (uppercase)', () => {
    assert.equal(checkConvergence('The review is CONVERGED.'), true);
  });

  it('returns true when output contains "converged" (lowercase)', () => {
    assert.equal(checkConvergence('All reviewers converged on this answer.'), true);
  });

  it('returns true when output contains "Converged" (mixed case)', () => {
    assert.equal(checkConvergence('Converged: yes, all agree.'), true);
  });

  it('returns false when no convergence signal present', () => {
    assert.equal(checkConvergence('There are still disagreements. More rounds needed.'), false);
  });

  it('returns false for empty string', () => {
    assert.equal(checkConvergence(''), false);
  });
});

describe('moderator: writeSynthesis', () => {
  let tmpDir;
  before(async () => { tmpDir = await makeTmpDir(); });
  after(async () => { await fs.rm(tmpDir, { recursive: true, force: true }); });

  it('writes synthesis.md to correct path', async () => {
    const runDir = path.join(tmpDir, 'run-synthesis');
    await fs.mkdir(runDir, { recursive: true });

    await writeSynthesis(runDir, 'step1', 'main', 2, 3, 'Final synthesis content');

    const expectedPath = path.join(
      runDir, 'steps', 'step1', 'main', 'v2', 'reviews', 'round-3', 'moderator', 'synthesis.md'
    );
    const content = await fs.readFile(expectedPath, 'utf8');
    assert.equal(content, 'Final synthesis content');
  });

  it('returns the path to synthesis.md', async () => {
    const runDir = path.join(tmpDir, 'run-synthesis-path');
    await fs.mkdir(runDir, { recursive: true });

    const result = await writeSynthesis(runDir, 'stepA', 'trackB', 1, 1, 'content');

    const expectedPath = path.join(
      runDir, 'steps', 'stepA', 'trackB', 'v1', 'reviews', 'round-1', 'moderator', 'synthesis.md'
    );
    assert.equal(result, expectedPath);
  });
});
