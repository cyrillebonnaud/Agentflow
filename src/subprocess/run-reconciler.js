'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { readRunState, markStepStatus } = require('../state/run-state');

/** Statuses that indicate a step was actively running when the process died */
const RUNNING_STATUSES = new Set(['running_lead', 'running_reviews', 'running_moderator']);

/**
 * Check whether the process whose PID is in <sentinelDir>/.pid is still alive.
 * @param {string} sentinelDir  Directory containing (possibly) a .pid file
 * @returns {Promise<'alive'|'dead'|'no_pid'>}
 */
async function checkLivePid(sentinelDir) {
  const pidFile = path.join(sentinelDir, '.pid');
  let pidStr;
  try {
    pidStr = await fs.readFile(pidFile, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return 'no_pid';
    throw err;
  }

  const pid = parseInt(pidStr.trim(), 10);
  if (isNaN(pid)) return 'dead';

  try {
    process.kill(pid, 0);
    return 'alive';
  } catch {
    return 'dead';
  }
}

/**
 * Reconcile sentinel files on disk against run.json state.
 * Called on orchestrator restart to enable crash-safe resume.
 *
 * @param {string} runDir
 * @returns {Promise<{ reconciled: string[], stillRunning: string[], requeued: string[] }>}
 */
async function reconcileRun(runDir) {
  const state = await readRunState(runDir);
  const steps = state.steps || {};

  const reconciled = [];
  const stillRunning = [];
  const requeued = [];

  for (const [stepId, stepState] of Object.entries(steps)) {
    if (!RUNNING_STATUSES.has(stepState.status)) continue;

    const stepDir = path.join(runDir, 'steps', stepId);

    // Check for .done sentinel
    const doneSentinel = path.join(stepDir, '.done');
    try {
      await fs.access(doneSentinel);
      // Found .done — update to "done"
      await markStepStatus(runDir, stepId, 'done');
      reconciled.push(stepId);
      continue;
    } catch {
      // Not found — continue checking
    }

    // Check for .failed sentinel
    const failedSentinel = path.join(stepDir, '.failed');
    try {
      await fs.access(failedSentinel);
      // Found .failed — update to "failed"
      await markStepStatus(runDir, stepId, 'failed');
      reconciled.push(stepId);
      continue;
    } catch {
      // Not found — continue checking
    }

    // No sentinel found — check if PID is still alive
    const pidStatus = await checkLivePid(stepDir);
    if (pidStatus === 'alive') {
      stillRunning.push(stepId);
    } else {
      // dead or no_pid — needs re-spawn
      requeued.push(stepId);
    }
  }

  return { reconciled, stillRunning, requeued };
}

module.exports = { reconcileRun, checkLivePid };
