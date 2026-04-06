'use strict';

const path = require('node:path');
const fs = require('node:fs/promises');
const { SentinelWatcher } = require('./subprocess-watcher');
const runner = require('./runner');

/**
 * Spawns all reviewer subprocesses in parallel for a given track+round.
 * Each reviewer gets its own sentinel dir.
 *
 * @param {object} opts
 * @param {string}   opts.runDir
 * @param {string}   opts.stepId
 * @param {string}   opts.trackSlug
 * @param {number}   opts.version
 * @param {number}   opts.round
 * @param {string[]} opts.reviewers
 * @param {Function} opts.promptFn        async (reviewerId) => string
 * @param {object}   opts.pool            SubprocessPool
 * @param {number}   opts.timeoutMs
 * @param {Function} [opts._spawnSubprocess] — injectable for tests
 * @returns {Promise<Array<{ reviewerId, sentinelDir }>>}
 */
async function spawnReviewers({ runDir, stepId, trackSlug, version, round, reviewers, promptFn, pool, timeoutMs, _spawnSubprocess }) {
  const spawn = _spawnSubprocess || runner.spawnSubprocess;

  const jobs = reviewers.map(async (reviewerId) => {
    const sentinelDir = path.join(
      runDir, 'steps', stepId, trackSlug, `v${version}`, 'reviews', `round-${round}`, reviewerId
    );
    await fs.mkdir(sentinelDir, { recursive: true });

    const promptContent = await promptFn(reviewerId);
    const release = await pool.acquire('reviewer');

    const result = await new Promise((resolve) => {
      const watcher = new SentinelWatcher();
      watcher.on('done', ({ content }) => { watcher.stop(); resolve({ status: 'done', content }); });
      watcher.on('failed', ({ content }) => { watcher.stop(); resolve({ status: 'failed', content }); });
      watcher.poll(sentinelDir, 300);
      spawn({ sentinelDir, promptContent, timeout: timeoutMs }).catch(() => {});
    });

    release();
    return { reviewerId, sentinelDir, status: result.status };
  });

  return Promise.all(jobs);
}

module.exports = { spawnReviewers };
