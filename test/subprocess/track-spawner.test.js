'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const { spawnLeadsParallel } = require('../../src/subprocess/track-spawner');
const { SubprocessPool } = require('../../src/subprocess/subprocess-pool');
const runner = require('../../src/subprocess/runner');

async function makeTmpDir() {
  const dir = path.join(os.tmpdir(), `af-ts-${crypto.randomBytes(4).toString('hex')}`);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

describe('spawnLeadsParallel', () => {
  let tmpDir;
  before(async () => { tmpDir = await makeTmpDir(); });
  after(async () => { await fs.rm(tmpDir, { recursive: true, force: true }); });

  it('spawns all tracks in parallel and returns results', async () => {
    const pool = new SubprocessPool({ maxTotal: 10, maxLead: 10, maxReviewer: 4, maxModerator: 4 });
    const saved = runner.spawnSubprocess;
    const startTimes = {};

    runner.spawnSubprocess = async ({ sentinelDir }) => {
      const slug = sentinelDir.split(path.sep).slice(-3)[0];
      startTimes[slug] = Date.now();
      const f = require('node:fs/promises');
      await f.writeFile(path.join(sentinelDir, 'output.md'), `output for ${slug}`);
      await f.writeFile(path.join(sentinelDir, '.done'), JSON.stringify({ result: `output for ${slug}`, cost_usd: 0 }));
    };

    try {
      const tracks = [
        { slug: 'track-a', promptContent: 'Prompt A' },
        { slug: 'track-b', promptContent: 'Prompt B' },
        { slug: 'track-c', promptContent: 'Prompt C' },
      ];

      const results = await spawnLeadsParallel({
        runDir: tmpDir,
        stepId: 'step-one',
        tracks,
        version: 1,
        pool,
        timeoutMs: 5000,
      });

      assert.equal(results.length, 3);
      assert.ok(results.every(r => r.status === 'done'), 'all tracks should be done');
      assert.deepEqual(results.map(r => r.slug).sort(), ['track-a', 'track-b', 'track-c']);
    } finally {
      runner.spawnSubprocess = saved;
    }
  });

  it('creates correct sentinel dir structure', async () => {
    const tmpDir2 = await makeTmpDir();
    const pool = new SubprocessPool({ maxTotal: 4, maxLead: 4, maxReviewer: 4, maxModerator: 4 });
    const saved = runner.spawnSubprocess;

    runner.spawnSubprocess = async ({ sentinelDir }) => {
      const f = require('node:fs/promises');
      await f.writeFile(path.join(sentinelDir, 'output.md'), 'ok');
      await f.writeFile(path.join(sentinelDir, '.done'), JSON.stringify({ result: 'ok', cost_usd: 0 }));
    };

    try {
      await spawnLeadsParallel({
        runDir: tmpDir2,
        stepId: 'my-step',
        tracks: [{ slug: 'minimalist', promptContent: 'p' }],
        version: 1,
        pool,
        timeoutMs: 5000,
      });

      const sentinelDir = path.join(tmpDir2, 'steps', 'my-step', 'minimalist', 'v1', 'lead');
      const stat = await fs.stat(sentinelDir);
      assert.ok(stat.isDirectory(), 'sentinel dir should exist');

      const done = await fs.stat(path.join(sentinelDir, '.done'));
      assert.ok(done.isFile());
    } finally {
      runner.spawnSubprocess = saved;
      await fs.rm(tmpDir2, { recursive: true, force: true });
    }
  });

  it('reports failed tracks correctly', async () => {
    const tmpDir3 = await makeTmpDir();
    const pool = new SubprocessPool({ maxTotal: 4, maxLead: 4, maxReviewer: 4, maxModerator: 4 });
    const saved = runner.spawnSubprocess;

    runner.spawnSubprocess = async ({ sentinelDir }) => {
      const f = require('node:fs/promises');
      await f.writeFile(path.join(sentinelDir, '.failed'), JSON.stringify({ reason: 'test_failure' }));
    };

    try {
      const results = await spawnLeadsParallel({
        runDir: tmpDir3,
        stepId: 'fail-step',
        tracks: [{ slug: 'track-x', promptContent: 'p' }],
        version: 1,
        pool,
        timeoutMs: 5000,
      });

      assert.equal(results[0].status, 'failed');
    } finally {
      runner.spawnSubprocess = saved;
      await fs.rm(tmpDir3, { recursive: true, force: true });
    }
  });
});
