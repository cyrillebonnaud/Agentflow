'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const { SubprocessPool } = require('../../src/subprocess/subprocess-pool');

async function makeTmpDir() {
  const dir = path.join(os.tmpdir(), `af-mod-spawner-${crypto.randomBytes(4).toString('hex')}`);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

describe('spawnModerator', () => {
  let tmpDir;
  before(async () => { tmpDir = await makeTmpDir(); });
  after(async () => { await fs.rm(tmpDir, { recursive: true, force: true }); });

  it('creates correct sentinel dir path for moderator', async () => {
    const spawnCalls = [];
    const fakeSpawn = async ({ sentinelDir, promptContent }) => {
      spawnCalls.push({ sentinelDir, promptContent });
      await fs.mkdir(sentinelDir, { recursive: true });
      await fs.writeFile(path.join(sentinelDir, '.done'), JSON.stringify({ result: 'CONVERGED' }), 'utf8');
    };

    const { spawnModerator } = require('../../src/subprocess/moderator-spawner');

    const pool = new SubprocessPool({ maxTotal: 10, maxLead: 4, maxReviewer: 6, maxModerator: 4 });
    const runDir = path.join(tmpDir, 'run-moddir');
    await fs.mkdir(runDir, { recursive: true });

    const result = await spawnModerator({
      runDir,
      stepId: 'step1',
      trackSlug: 'main',
      version: 1,
      round: 2,
      promptContent: 'Moderator prompt here',
      pool,
      timeoutMs: 5000,
      _spawnSubprocess: fakeSpawn,
    });

    const expectedDir = path.join(runDir, 'steps', 'step1', 'main', 'v1', 'reviews', 'round-2', 'moderator');
    assert.equal(result.sentinelDir, expectedDir);
  });

  it('writes prompt.md to sentinel dir via spawnSubprocess', async () => {
    const spawnCalls = [];
    const fakeSpawn = async ({ sentinelDir, promptContent }) => {
      spawnCalls.push({ sentinelDir, promptContent });
      await fs.mkdir(sentinelDir, { recursive: true });
      // Write prompt.md like real spawnSubprocess does
      await fs.writeFile(path.join(sentinelDir, 'prompt.md'), promptContent, 'utf8');
      await fs.writeFile(path.join(sentinelDir, '.done'), JSON.stringify({ result: 'CONVERGED' }), 'utf8');
    };

    const { spawnModerator } = require('../../src/subprocess/moderator-spawner');

    const pool = new SubprocessPool({ maxTotal: 10, maxLead: 4, maxReviewer: 6, maxModerator: 4 });
    const runDir = path.join(tmpDir, 'run-modprompt');
    await fs.mkdir(runDir, { recursive: true });

    const expectedPrompt = 'This is the moderator prompt content';
    await spawnModerator({
      runDir,
      stepId: 'step2',
      trackSlug: 'track1',
      version: 3,
      round: 1,
      promptContent: expectedPrompt,
      pool,
      timeoutMs: 5000,
      _spawnSubprocess: fakeSpawn,
    });

    assert.equal(spawnCalls.length, 1, 'spawnSubprocess should be called once');
    assert.equal(spawnCalls[0].promptContent, expectedPrompt);

    // Also verify prompt.md was written
    const promptPath = path.join(
      runDir, 'steps', 'step2', 'track1', 'v3', 'reviews', 'round-1', 'moderator', 'prompt.md'
    );
    const written = await fs.readFile(promptPath, 'utf8');
    assert.equal(written, expectedPrompt);
  });
});
