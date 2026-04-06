'use strict';

const path = require('node:path');
const fs = require('node:fs/promises');
const { SentinelWatcher } = require('./subprocess-watcher');
const runner = require('./runner');

/**
 * Spawns a single moderator subprocess for a track+round.
 *
 * @param {object} opts
 * @param {string}   opts.runDir
 * @param {string}   opts.stepId
 * @param {string}   opts.trackSlug
 * @param {number}   opts.version
 * @param {number}   opts.round
 * @param {string}   opts.promptContent
 * @param {object}   opts.pool
 * @param {number}   opts.timeoutMs
 * @param {Function} [opts._spawnSubprocess]
 * @returns {Promise<{ sentinelDir, status, outputContent }>}
 */
async function spawnModerator({ runDir, stepId, trackSlug, version, round, promptContent, pool, timeoutMs, _spawnSubprocess }) {
  const spawn = _spawnSubprocess || runner.spawnSubprocess;

  const sentinelDir = path.join(
    runDir, 'steps', stepId, trackSlug, `v${version}`, 'reviews', `round-${round}`, 'moderator'
  );
  await fs.mkdir(sentinelDir, { recursive: true });

  const release = await pool.acquire('moderator');

  const result = await new Promise((resolve) => {
    const watcher = new SentinelWatcher();
    watcher.on('done', ({ content }) => { watcher.stop(); resolve({ status: 'done', content }); });
    watcher.on('failed', ({ content }) => { watcher.stop(); resolve({ status: 'failed', content }); });
    watcher.poll(sentinelDir, 300);
    spawn({ sentinelDir, promptContent, timeout: timeoutMs }).catch(() => {});
  });

  release();

  let outputContent = '';
  try { outputContent = await fs.readFile(path.join(sentinelDir, 'output.md'), 'utf8'); } catch {}

  // Copy to assessment.md
  await fs.writeFile(path.join(sentinelDir, 'assessment.md'), outputContent, 'utf8');

  return { sentinelDir, status: result.status, outputContent };
}

module.exports = { spawnModerator };
