'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const { SentinelWatcher } = require('../../src/subprocess/subprocess-watcher');
const { Watchdog } = require('../../src/subprocess/subprocess-watchdog');

async function makeTmpDir() {
  const dir = path.join(os.tmpdir(), `af-watcher-${crypto.randomBytes(4).toString('hex')}`);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

describe('SentinelWatcher', () => {
  let tmpDir;
  before(async () => { tmpDir = await makeTmpDir(); });
  after(async () => { await fs.rm(tmpDir, { recursive: true, force: true }); });

  it('emits done when .done file is written after watch()', async () => {
    const sentinelDir = path.join(tmpDir, 'done-test');
    await fs.mkdir(sentinelDir, { recursive: true });

    const watcher = new SentinelWatcher();
    const result = await new Promise((resolve) => {
      watcher.on('done', resolve);
      watcher.watch(sentinelDir);
      // Write .done after a short delay
      setTimeout(() => {
        fs.writeFile(path.join(sentinelDir, '.done'), JSON.stringify({ result: 'ok' }), 'utf8');
      }, 50);
    });

    watcher.stop();
    assert.equal(result.content.result, 'ok');
    assert.equal(result.sentinelDir, sentinelDir);
  });

  it('emits failed when .failed file is written after watch()', async () => {
    const sentinelDir = path.join(tmpDir, 'failed-test');
    await fs.mkdir(sentinelDir, { recursive: true });

    const watcher = new SentinelWatcher();
    const result = await new Promise((resolve) => {
      watcher.on('failed', resolve);
      watcher.watch(sentinelDir);
      setTimeout(() => {
        fs.writeFile(path.join(sentinelDir, '.failed'), JSON.stringify({ reason: 'error' }), 'utf8');
      }, 50);
    });

    watcher.stop();
    assert.equal(result.content.reason, 'error');
  });

  it('emits done immediately if .done already exists when watch() is called', async () => {
    const sentinelDir = path.join(tmpDir, 'already-done');
    await fs.mkdir(sentinelDir, { recursive: true });
    await fs.writeFile(path.join(sentinelDir, '.done'), JSON.stringify({ result: 'preexisting' }), 'utf8');

    const watcher = new SentinelWatcher();
    const result = await new Promise((resolve) => {
      watcher.on('done', resolve);
      watcher.watch(sentinelDir);
    });

    watcher.stop();
    assert.equal(result.content.result, 'preexisting');
  });

  it('poll() finds sentinel via interval', async () => {
    const sentinelDir = path.join(tmpDir, 'poll-test');
    await fs.mkdir(sentinelDir, { recursive: true });

    const watcher = new SentinelWatcher();
    const result = await new Promise((resolve) => {
      watcher.on('done', resolve);
      watcher.poll(sentinelDir, 100);
      setTimeout(() => {
        fs.writeFile(path.join(sentinelDir, '.done'), JSON.stringify({ result: 'polled' }), 'utf8');
      }, 150);
    });

    watcher.stop();
    assert.equal(result.content.result, 'polled');
  });

  it('stop() prevents further events', async () => {
    const sentinelDir = path.join(tmpDir, 'stop-test');
    await fs.mkdir(sentinelDir, { recursive: true });

    const watcher = new SentinelWatcher();
    let eventCount = 0;
    watcher.on('done', () => eventCount++);
    watcher.watch(sentinelDir);
    watcher.stop();

    await fs.writeFile(path.join(sentinelDir, '.done'), JSON.stringify({}), 'utf8');
    await new Promise(r => setTimeout(r, 100));
    assert.ok(eventCount <= 1, 'after stop, no more events should fire');
  });
});

describe('Watchdog', () => {
  let tmpDir;
  before(async () => { tmpDir = await makeTmpDir(); });
  after(async () => { await fs.rm(tmpDir, { recursive: true, force: true }); });

  it('writes .failed with reason=timeout when timeout elapses', async () => {
    const sentinelDir = path.join(tmpDir, 'watchdog-timeout');
    await fs.mkdir(sentinelDir, { recursive: true });

    const watchdog = new Watchdog({ pollIntervalMs: 100 });
    watchdog.register(sentinelDir, 150); // 150ms timeout
    watchdog.start();

    // Wait for watchdog to trigger
    await new Promise(r => setTimeout(r, 400));
    watchdog.stop();

    const failedContent = await fs.readFile(path.join(sentinelDir, '.failed'), 'utf8');
    const failed = JSON.parse(failedContent);
    assert.equal(failed.reason, 'timeout');
  });

  it('does not write .failed if .done already exists', async () => {
    const sentinelDir = path.join(tmpDir, 'watchdog-done');
    await fs.mkdir(sentinelDir, { recursive: true });
    await fs.writeFile(path.join(sentinelDir, '.done'), JSON.stringify({}), 'utf8');

    const watchdog = new Watchdog({ pollIntervalMs: 100 });
    watchdog.register(sentinelDir, 50); // Very short timeout
    watchdog.start();

    await new Promise(r => setTimeout(r, 300));
    watchdog.stop();

    const failedStat = await fs.stat(path.join(sentinelDir, '.failed')).catch(() => null);
    assert.equal(failedStat, null, '.failed should NOT exist when .done is present');
  });

  it('deregister() prevents watchdog from firing for that dir', async () => {
    const sentinelDir = path.join(tmpDir, 'watchdog-deregistered');
    await fs.mkdir(sentinelDir, { recursive: true });

    const watchdog = new Watchdog({ pollIntervalMs: 100 });
    watchdog.register(sentinelDir, 50);
    watchdog.deregister(sentinelDir); // immediately deregister
    watchdog.start();

    await new Promise(r => setTimeout(r, 300));
    watchdog.stop();

    const failedStat = await fs.stat(path.join(sentinelDir, '.failed')).catch(() => null);
    assert.equal(failedStat, null, 'deregistered entry should not produce .failed');
  });
});
