'use strict';

const path = require('node:path');
const fs = require('node:fs/promises');
const { SentinelWatcher } = require('../subprocess/subprocess-watcher');
const runner = require('../subprocess/runner');
const { checkConvergence, writeSynthesis, readReviewOutputs } = require('./moderator');

/**
 * Spawn a single subprocess and wait for its sentinel.
 * Accepts an optional _spawnSubprocess override for testing.
 */
async function spawnAndWait({ sentinelDir, promptContent, timeoutMs, _spawnSubprocess }) {
  await fs.mkdir(sentinelDir, { recursive: true });

  const spawn = _spawnSubprocess || runner.spawnSubprocess;

  return new Promise((resolve) => {
    const watcher = new SentinelWatcher();

    watcher.on('done', async ({ content }) => {
      watcher.stop();
      // Copy output.md → assessment.md for moderator dirs
      resolve({ status: 'done', content });
    });

    watcher.on('failed', ({ content }) => {
      watcher.stop();
      resolve({ status: 'failed', content });
    });

    watcher.poll(sentinelDir, 200);
    spawn({ sentinelDir, promptContent, timeout: timeoutMs }).catch(() => {});
  });
}

/**
 * Spawn all reviewers in parallel for one round, wait for all to complete.
 * Returns array of { reviewerId, sentinelDir, status, outputContent }
 */
async function spawnReviewers({ runDir, stepId, trackSlug, version, round, reviewers, buildPrompt, pool, timeoutMs, _spawnSubprocess }) {
  const jobs = reviewers.map(async (reviewerId) => {
    const sentinelDir = path.join(
      runDir, 'steps', stepId, trackSlug, `v${version}`, 'reviews', `round-${round}`, reviewerId
    );

    const priorReviews = [];
    const promptContent = await buildPrompt(reviewerId, round, priorReviews);

    const release = await pool.acquire('reviewer');
    try {
      const result = await spawnAndWait({ sentinelDir, promptContent, timeoutMs, _spawnSubprocess });
      let outputContent = '';
      try { outputContent = await fs.readFile(path.join(sentinelDir, 'output.md'), 'utf8'); } catch {}
      return { reviewerId, sentinelDir, status: result.status, outputContent };
    } finally {
      release();
    }
  });

  return Promise.all(jobs);
}

/**
 * Spawn the moderator for one round, wait for it to complete.
 * Copies output.md → assessment.md.
 * Returns { sentinelDir, status, outputContent }
 */
async function spawnModerator({ runDir, stepId, trackSlug, version, round, moderatorId, buildPrompt, pool, timeoutMs, _spawnSubprocess }) {
  const sentinelDir = path.join(
    runDir, 'steps', stepId, trackSlug, `v${version}`, 'reviews', `round-${round}`, 'moderator'
  );

  const reviewOutputs = await readReviewOutputs(runDir, stepId, trackSlug, version, round,
    // We don't have the reviewer list here, so scan the dir
    await getReviewerIds(path.join(runDir, 'steps', stepId, trackSlug, `v${version}`, 'reviews', `round-${round}`))
  );

  const promptContent = await buildPrompt(round, reviewOutputs);

  const release = await pool.acquire('moderator');
  try {
    await spawnAndWait({ sentinelDir, promptContent, timeoutMs, _spawnSubprocess });

    let outputContent = '';
    try { outputContent = await fs.readFile(path.join(sentinelDir, 'output.md'), 'utf8'); } catch {}

    // Write assessment.md (copy of output.md)
    const assessmentPath = path.join(sentinelDir, 'assessment.md');
    await fs.writeFile(assessmentPath, outputContent, 'utf8');

    return { sentinelDir, status: 'done', outputContent };
  } finally {
    release();
  }
}

async function getReviewerIds(roundDir) {
  try {
    const entries = await fs.readdir(roundDir);
    return entries.filter(e => e !== 'moderator');
  } catch {
    return [];
  }
}

/**
 * Run the full review loop for one track of a refine step.
 *
 * @param {object} opts
 * @param {string}   opts.runDir
 * @param {string}   opts.stepId
 * @param {string}   opts.trackSlug
 * @param {number}   opts.version
 * @param {string[]} opts.reviewers
 * @param {string}   opts.moderatorId
 * @param {number}   opts.maxRounds
 * @param {Function} opts.buildReviewerPrompt  async (reviewerId, round, priorReviews) => string
 * @param {Function} opts.buildModeratorPrompt async (round, reviews) => string
 * @param {object}   opts.pool
 * @param {number}   opts.subprocessTimeoutMs
 * @param {Function} [opts._spawnSubprocess]   — injectable for tests
 * @returns {Promise<{ converged: boolean, rounds: number, synthesisPath: string|null }>}
 */
async function runReviewLoop({
  runDir, stepId, trackSlug, version, reviewers, moderatorId,
  maxRounds, buildReviewerPrompt, buildModeratorPrompt, pool,
  subprocessTimeoutMs, _spawnSubprocess,
}) {
  let converged = false;
  let synthesisPath = null;

  for (let round = 1; round <= maxRounds; round++) {
    // Phase 1: spawn all reviewers in parallel
    await spawnReviewers({
      runDir, stepId, trackSlug, version, round, reviewers,
      buildPrompt: buildReviewerPrompt,
      pool, timeoutMs: subprocessTimeoutMs, _spawnSubprocess,
    });

    // Phase 2: spawn moderator
    const modResult = await spawnModerator({
      runDir, stepId, trackSlug, version, round, moderatorId,
      buildPrompt: buildModeratorPrompt,
      pool, timeoutMs: subprocessTimeoutMs, _spawnSubprocess,
    });

    converged = checkConvergence(modResult.outputContent);

    // Write synthesis.md (always — even on last round if not converged)
    if (converged || round === maxRounds) {
      synthesisPath = await writeSynthesis(runDir, stepId, trackSlug, version, round, modResult.outputContent);
    }

    if (converged) {
      return { converged: true, rounds: round, synthesisPath };
    }
  }

  return { converged: false, rounds: maxRounds, synthesisPath };
}

module.exports = { runReviewLoop };
