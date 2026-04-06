'use strict';

const path = require('node:path');
const fs = require('node:fs/promises');
const runner = require('./runner');
const { SentinelWatcher } = require('./subprocess-watcher');

/**
 * Spawns lead subprocesses in parallel for all tracks in a step.
 * Each track gets its own sentinel dir: steps/<stepId>/<trackSlug>/v<N>/lead/
 *
 * @param {object} opts
 * @param {string}   opts.runDir
 * @param {string}   opts.stepId
 * @param {Array<{slug: string, promptContent: string}>} opts.tracks
 * @param {number}   opts.version         — e.g. 1 for v1
 * @param {object}   opts.pool            — SubprocessPool
 * @param {number}   opts.timeoutMs
 * @returns {Promise<Array<{ slug, sentinelDir, status: 'done'|'failed', content }>>}
 */
async function spawnLeadsParallel({ runDir, stepId, tracks, version, pool, timeoutMs }) {
  const jobs = tracks.map(async ({ slug, promptContent }) => {
    const sentinelDir = path.join(runDir, 'steps', stepId, slug, `v${version}`, 'lead');
    await fs.mkdir(sentinelDir, { recursive: true });

    const release = await pool.acquire('lead');

    return new Promise((resolve) => {
      const watcher = new SentinelWatcher();

      watcher.on('done', ({ content }) => {
        watcher.stop();
        release();
        resolve({ slug, sentinelDir, status: 'done', content });
      });

      watcher.on('failed', ({ content }) => {
        watcher.stop();
        release();
        resolve({ slug, sentinelDir, status: 'failed', content });
      });

      watcher.poll(sentinelDir, 500);

      runner.spawnSubprocess({ sentinelDir, promptContent, timeout: timeoutMs }).catch(() => {});
    });
  });

  return Promise.all(jobs);
}

module.exports = { spawnLeadsParallel };
