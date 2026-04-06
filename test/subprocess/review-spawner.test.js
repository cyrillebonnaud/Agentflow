'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const { SubprocessPool } = require('../../src/subprocess/subprocess-pool');

async function makeTmpDir() {
  const dir = path.join(os.tmpdir(), `af-rev-spawner-${crypto.randomBytes(4).toString('hex')}`);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

describe('spawnReviewers', () => {
  let tmpDir;
  let spawnReviewers;

  before(async () => {
    tmpDir = await makeTmpDir();
  });
  after(async () => { await fs.rm(tmpDir, { recursive: true, force: true }); });

  // Load module fresh each test by using a fresh require and injecting fake spawn
  it('creates correct sentinel dirs for each reviewer', async () => {
    const spawnCalls = [];
    const fakeSpawn = async ({ sentinelDir, promptContent }) => {
      spawnCalls.push({ sentinelDir, promptContent });
      await fs.mkdir(sentinelDir, { recursive: true });
      await fs.writeFile(path.join(sentinelDir, '.done'), JSON.stringify({ result: 'ok' }), 'utf8');
    };

    const { spawnReviewers } = require('../../src/subprocess/review-spawner');

    const pool = new SubprocessPool({ maxTotal: 10, maxLead: 4, maxReviewer: 6, maxModerator: 4 });
    const runDir = path.join(tmpDir, 'run-dirs');
    await fs.mkdir(runDir, { recursive: true });

    const result = await spawnReviewers({
      runDir,
      stepId: 'step1',
      trackSlug: 'main',
      version: 1,
      round: 1,
      reviewers: ['rev-a', 'rev-b'],
      promptFn: async (reviewerId) => `Prompt for ${reviewerId}`,
      pool,
      timeoutMs: 5000,
      _spawnSubprocess: fakeSpawn,
    });

    // Check dirs
    const expectedA = path.join(runDir, 'steps', 'step1', 'main', 'v1', 'reviews', 'round-1', 'rev-a');
    const expectedB = path.join(runDir, 'steps', 'step1', 'main', 'v1', 'reviews', 'round-1', 'rev-b');

    const dirs = result.map(r => r.sentinelDir).sort();
    assert.ok(dirs.includes(expectedA), `should include ${expectedA}`);
    assert.ok(dirs.includes(expectedB), `should include ${expectedB}`);
  });

  it('all reviewers spawned in parallel (all start before any finishes)', async () => {
    const startTimes = {};
    const endTimes = {};

    const fakeSpawn = async ({ sentinelDir, promptContent }) => {
      const reviewerId = path.basename(sentinelDir);
      startTimes[reviewerId] = Date.now();
      // Simulate work with a small delay
      await new Promise(r => setTimeout(r, 50));
      await fs.mkdir(sentinelDir, { recursive: true });
      await fs.writeFile(path.join(sentinelDir, '.done'), JSON.stringify({ result: 'ok' }), 'utf8');
      endTimes[reviewerId] = Date.now();
    };

    const { spawnReviewers } = require('../../src/subprocess/review-spawner');

    const pool = new SubprocessPool({ maxTotal: 10, maxLead: 4, maxReviewer: 6, maxModerator: 4 });
    const runDir = path.join(tmpDir, 'run-parallel');
    await fs.mkdir(runDir, { recursive: true });

    const reviewers = ['rev-x', 'rev-y', 'rev-z'];
    await spawnReviewers({
      runDir,
      stepId: 'step2',
      trackSlug: 'main',
      version: 1,
      round: 1,
      reviewers,
      promptFn: async (reviewerId) => `Prompt for ${reviewerId}`,
      pool,
      timeoutMs: 5000,
      _spawnSubprocess: fakeSpawn,
    });

    // All should have started before any ended — parallel means start times overlap
    // The earliest end time should be after the latest start time (all started before first ended)
    const allStarted = Object.keys(startTimes);
    assert.equal(allStarted.length, 3, 'all three reviewers should have started');

    const minEnd = Math.min(...Object.values(endTimes));
    const maxStart = Math.max(...Object.values(startTimes));
    // All started within 20ms of each other (parallel), not sequential (which would be 50ms apart)
    const startSpread = maxStart - Math.min(...Object.values(startTimes));
    assert.ok(startSpread < 30, `Start times should be close together (parallel), spread was ${startSpread}ms`);
  });

  it('returns array with reviewerId and sentinelDir for each reviewer', async () => {
    const fakeSpawn = async ({ sentinelDir }) => {
      await fs.mkdir(sentinelDir, { recursive: true });
      await fs.writeFile(path.join(sentinelDir, '.done'), JSON.stringify({ result: 'ok' }), 'utf8');
    };

    const { spawnReviewers } = require('../../src/subprocess/review-spawner');

    const pool = new SubprocessPool({ maxTotal: 10, maxLead: 4, maxReviewer: 6, maxModerator: 4 });
    const runDir = path.join(tmpDir, 'run-return');
    await fs.mkdir(runDir, { recursive: true });

    const result = await spawnReviewers({
      runDir,
      stepId: 'step3',
      trackSlug: 'alpha',
      version: 2,
      round: 3,
      reviewers: ['rev-1', 'rev-2'],
      promptFn: async (reviewerId) => `prompt`,
      pool,
      timeoutMs: 5000,
      _spawnSubprocess: fakeSpawn,
    });

    assert.equal(result.length, 2);
    for (const item of result) {
      assert.ok(item.reviewerId, 'should have reviewerId');
      assert.ok(item.sentinelDir, 'should have sentinelDir');
      assert.ok(item.sentinelDir.includes(item.reviewerId), 'sentinelDir should include reviewerId');
    }

    const ids = result.map(r => r.reviewerId).sort();
    assert.deepEqual(ids, ['rev-1', 'rev-2']);
  });
});
