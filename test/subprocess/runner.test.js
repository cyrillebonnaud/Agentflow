'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const { spawnSubprocess } = require('../../src/subprocess/runner');

async function makeTmpDir() {
  const dir = path.join(os.tmpdir(), `af-runner-${crypto.randomBytes(4).toString('hex')}`);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

describe('spawnSubprocess', () => {
  let tmpDir;

  before(async () => { tmpDir = await makeTmpDir(); });
  after(async () => { await fs.rm(tmpDir, { recursive: true, force: true }); });

  it('writes .pid file immediately after spawn', async () => {
    const sentinelDir = path.join(tmpDir, 'test-pid');
    await fs.mkdir(sentinelDir, { recursive: true });
    const promptContent = 'echo hello';

    // We don't await spawnSubprocess so we can check .pid before .done
    const promise = spawnSubprocess({
      sentinelDir,
      promptContent,
      command: process.execPath,
      args: ['-e', 'process.stdout.write(JSON.stringify({type:"result",subtype:"success",is_error:false,result:"hello"}))'],
      timeout: 10000,
    });

    // Poll for .pid file (up to 2 seconds)
    let pidExists = false;
    for (let i = 0; i < 40; i++) {
      try {
        await fs.access(path.join(sentinelDir, '.pid'));
        pidExists = true;
        break;
      } catch {
        await new Promise(r => setTimeout(r, 50));
      }
    }
    assert.ok(pidExists, '.pid file should exist shortly after spawn');
    await promise;
  });

  it('writes .done sentinel and output.md on success', async () => {
    const sentinelDir = path.join(tmpDir, 'test-done');
    await fs.mkdir(sentinelDir, { recursive: true });

    const result = { type: 'result', subtype: 'success', is_error: false, result: 'The output content' };
    await spawnSubprocess({
      sentinelDir,
      promptContent: 'test prompt',
      command: process.execPath,
      args: ['-e', `process.stdout.write(${JSON.stringify(JSON.stringify(result))})`],
      timeout: 10000,
    });

    const doneStat = await fs.stat(path.join(sentinelDir, '.done')).catch(() => null);
    assert.ok(doneStat, '.done file should exist');

    const failedStat = await fs.stat(path.join(sentinelDir, '.failed')).catch(() => null);
    assert.equal(failedStat, null, '.failed file should NOT exist');

    const outputContent = await fs.readFile(path.join(sentinelDir, 'output.md'), 'utf8');
    assert.equal(outputContent, 'The output content');
  });

  it('writes .failed sentinel when process exits with error JSON', async () => {
    const sentinelDir = path.join(tmpDir, 'test-failed-json');
    await fs.mkdir(sentinelDir, { recursive: true });

    const result = { type: 'result', subtype: 'error', is_error: true, result: 'Something went wrong' };
    await spawnSubprocess({
      sentinelDir,
      promptContent: 'test prompt',
      command: process.execPath,
      args: ['-e', `process.stdout.write(${JSON.stringify(JSON.stringify(result))})`],
      timeout: 10000,
    });

    const failedStat = await fs.stat(path.join(sentinelDir, '.failed')).catch(() => null);
    assert.ok(failedStat, '.failed file should exist on error result');
  });

  it('writes .failed sentinel when process exits non-zero', async () => {
    const sentinelDir = path.join(tmpDir, 'test-nonzero');
    await fs.mkdir(sentinelDir, { recursive: true });

    await spawnSubprocess({
      sentinelDir,
      promptContent: 'test prompt',
      command: process.execPath,
      args: ['-e', 'process.exit(1)'],
      timeout: 10000,
    });

    const failedStat = await fs.stat(path.join(sentinelDir, '.failed')).catch(() => null);
    assert.ok(failedStat, '.failed file should exist for non-zero exit');
  });

  it('writes prompt.md to sentinelDir before spawning', async () => {
    const sentinelDir = path.join(tmpDir, 'test-prompt');
    await fs.mkdir(sentinelDir, { recursive: true });

    const result = { type: 'result', subtype: 'success', is_error: false, result: 'ok' };
    await spawnSubprocess({
      sentinelDir,
      promptContent: 'My special prompt',
      command: process.execPath,
      args: ['-e', `process.stdout.write(${JSON.stringify(JSON.stringify(result))})`],
      timeout: 10000,
    });

    const promptContent = await fs.readFile(path.join(sentinelDir, 'prompt.md'), 'utf8');
    assert.equal(promptContent, 'My special prompt');
  });

  it('writes .failed on timeout', async () => {
    const sentinelDir = path.join(tmpDir, 'test-timeout');
    await fs.mkdir(sentinelDir, { recursive: true });

    await spawnSubprocess({
      sentinelDir,
      promptContent: 'test',
      command: process.execPath,
      args: ['-e', 'setTimeout(() => {}, 60000)'],  // hangs for 60s
      timeout: 300,  // 300ms timeout
    });

    const failedContent = await fs.readFile(path.join(sentinelDir, '.failed'), 'utf8');
    const failed = JSON.parse(failedContent);
    assert.equal(failed.reason, 'timeout', 'should record timeout reason');
  });
});
