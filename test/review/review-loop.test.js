'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const { SubprocessPool } = require('../../src/subprocess/subprocess-pool');
const { runReviewLoop } = require('../../src/review/review-loop');

async function makeTmpDir() {
  const dir = path.join(os.tmpdir(), `af-reviewloop-${crypto.randomBytes(4).toString('hex')}`);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

/**
 * A fake spawnSubprocess that immediately writes .done with optional output.md content.
 * outputFn: (sentinelDir) => string  — returns the output.md content
 */
function makeFakeSpawn(outputFn) {
  return async ({ sentinelDir, promptContent }) => {
    await fs.mkdir(sentinelDir, { recursive: true });
    await fs.writeFile(path.join(sentinelDir, 'prompt.md'), promptContent, 'utf8');
    const output = outputFn ? outputFn(sentinelDir) : 'Default output';
    await fs.writeFile(path.join(sentinelDir, 'output.md'), output, 'utf8');
    await fs.writeFile(path.join(sentinelDir, '.done'), JSON.stringify({ result: output }), 'utf8');
  };
}

describe('runReviewLoop', () => {
  let tmpDir;
  before(async () => { tmpDir = await makeTmpDir(); });
  after(async () => { await fs.rm(tmpDir, { recursive: true, force: true }); });

  it('runs one round with two reviewers — all get .done', async () => {
    const runDir = path.join(tmpDir, 'run-oneround');
    await fs.mkdir(runDir, { recursive: true });

    const doneDirs = [];
    const fakeSpawn = makeFakeSpawn((sentinelDir) => {
      doneDirs.push(sentinelDir);
      return 'CONVERGED: all agree';
    });

    const pool = new SubprocessPool({ maxTotal: 10, maxLead: 4, maxReviewer: 6, maxModerator: 4 });

    await runReviewLoop({
      runDir,
      stepId: 'step1',
      trackSlug: 'main',
      version: 1,
      reviewers: ['rev-a', 'rev-b'],
      moderatorId: 'mod-1',
      maxRounds: 3,
      buildReviewerPrompt: async (reviewerId, round, priorReviews) => `Reviewer ${reviewerId} round ${round}`,
      buildModeratorPrompt: async (round, reviews) => `Moderator round ${round}`,
      pool,
      subprocessTimeoutMs: 5000,
      _spawnSubprocess: fakeSpawn,
    });

    // Both reviewers should have .done
    const baseDir = path.join(runDir, 'steps', 'step1', 'main', 'v1', 'reviews', 'round-1');
    const revADone = await fs.stat(path.join(baseDir, 'rev-a', '.done')).catch(() => null);
    const revBDone = await fs.stat(path.join(baseDir, 'rev-b', '.done')).catch(() => null);
    assert.ok(revADone, 'rev-a should have .done');
    assert.ok(revBDone, 'rev-b should have .done');
  });

  it('moderator output is written to assessment.md', async () => {
    const runDir = path.join(tmpDir, 'run-assessment');
    await fs.mkdir(runDir, { recursive: true });

    const modOutput = 'CONVERGED: the answer is clear';
    const fakeSpawn = makeFakeSpawn((sentinelDir) => {
      if (path.basename(sentinelDir) === 'moderator') {
        return modOutput;
      }
      return 'reviewer output';
    });

    const pool = new SubprocessPool({ maxTotal: 10, maxLead: 4, maxReviewer: 6, maxModerator: 4 });

    await runReviewLoop({
      runDir,
      stepId: 'step2',
      trackSlug: 'main',
      version: 1,
      reviewers: ['rev-a'],
      moderatorId: 'mod-1',
      maxRounds: 3,
      buildReviewerPrompt: async (reviewerId, round, priorReviews) => `Reviewer prompt`,
      buildModeratorPrompt: async (round, reviews) => `Moderator prompt`,
      pool,
      subprocessTimeoutMs: 5000,
      _spawnSubprocess: fakeSpawn,
    });

    const assessmentPath = path.join(
      runDir, 'steps', 'step2', 'main', 'v1', 'reviews', 'round-1', 'moderator', 'assessment.md'
    );
    const content = await fs.readFile(assessmentPath, 'utf8');
    assert.equal(content, modOutput);
  });

  it('returns converged=true after one round when moderator says CONVERGED', async () => {
    const runDir = path.join(tmpDir, 'run-converged');
    await fs.mkdir(runDir, { recursive: true });

    const fakeSpawn = makeFakeSpawn((sentinelDir) => {
      return 'CONVERGED: unanimous agreement';
    });

    const pool = new SubprocessPool({ maxTotal: 10, maxLead: 4, maxReviewer: 6, maxModerator: 4 });

    const result = await runReviewLoop({
      runDir,
      stepId: 'step3',
      trackSlug: 'main',
      version: 1,
      reviewers: ['rev-a', 'rev-b'],
      moderatorId: 'mod-1',
      maxRounds: 5,
      buildReviewerPrompt: async (reviewerId, round, priorReviews) => `Reviewer prompt`,
      buildModeratorPrompt: async (round, reviews) => `Moderator prompt`,
      pool,
      subprocessTimeoutMs: 5000,
      _spawnSubprocess: fakeSpawn,
    });

    assert.equal(result.converged, true);
    assert.equal(result.rounds, 1);
    assert.ok(result.synthesisPath, 'should have a synthesisPath');
  });

  it('runs a second round when moderator says not converged (max_rounds=2)', async () => {
    const runDir = path.join(tmpDir, 'run-second-round');
    await fs.mkdir(runDir, { recursive: true });

    let moderatorCallCount = 0;
    const fakeSpawn = makeFakeSpawn((sentinelDir) => {
      if (path.basename(sentinelDir) === 'moderator') {
        moderatorCallCount++;
        // First round: not converged; second round: converged
        if (moderatorCallCount === 1) {
          return 'Not yet converged, more discussion needed';
        }
        return 'CONVERGED: all agree now';
      }
      return 'reviewer output';
    });

    const pool = new SubprocessPool({ maxTotal: 10, maxLead: 4, maxReviewer: 6, maxModerator: 4 });

    const result = await runReviewLoop({
      runDir,
      stepId: 'step4',
      trackSlug: 'main',
      version: 1,
      reviewers: ['rev-a'],
      moderatorId: 'mod-1',
      maxRounds: 2,
      buildReviewerPrompt: async (reviewerId, round, priorReviews) => `Reviewer prompt round ${round}`,
      buildModeratorPrompt: async (round, reviews) => `Moderator prompt round ${round}`,
      pool,
      subprocessTimeoutMs: 5000,
      _spawnSubprocess: fakeSpawn,
    });

    assert.equal(result.converged, true);
    assert.equal(result.rounds, 2);
    assert.equal(moderatorCallCount, 2);

    // Both rounds' reviewer dirs should exist
    const round1Dir = path.join(runDir, 'steps', 'step4', 'main', 'v1', 'reviews', 'round-1', 'rev-a');
    const round2Dir = path.join(runDir, 'steps', 'step4', 'main', 'v1', 'reviews', 'round-2', 'rev-a');
    const r1 = await fs.stat(round1Dir).catch(() => null);
    const r2 = await fs.stat(round2Dir).catch(() => null);
    assert.ok(r1, 'round-1 reviewer dir should exist');
    assert.ok(r2, 'round-2 reviewer dir should exist');
  });

  it('stops at max_rounds even if not converged', async () => {
    const runDir = path.join(tmpDir, 'run-maxrounds');
    await fs.mkdir(runDir, { recursive: true });

    let moderatorCallCount = 0;
    const fakeSpawn = makeFakeSpawn((sentinelDir) => {
      if (path.basename(sentinelDir) === 'moderator') {
        moderatorCallCount++;
        return 'Still not converged, disagreements remain';
      }
      return 'reviewer output';
    });

    const pool = new SubprocessPool({ maxTotal: 10, maxLead: 4, maxReviewer: 6, maxModerator: 4 });

    const result = await runReviewLoop({
      runDir,
      stepId: 'step5',
      trackSlug: 'main',
      version: 1,
      reviewers: ['rev-a', 'rev-b'],
      moderatorId: 'mod-1',
      maxRounds: 3,
      buildReviewerPrompt: async (reviewerId, round, priorReviews) => `Reviewer prompt`,
      buildModeratorPrompt: async (round, reviews) => `Moderator prompt`,
      pool,
      subprocessTimeoutMs: 5000,
      _spawnSubprocess: fakeSpawn,
    });

    assert.equal(result.converged, false);
    assert.equal(result.rounds, 3);
    assert.equal(moderatorCallCount, 3, 'moderator should run once per round');
    // synthesisPath should still be set (written even when not converged at max)
    assert.ok(result.synthesisPath, 'should have synthesisPath even at max rounds');
  });
});
