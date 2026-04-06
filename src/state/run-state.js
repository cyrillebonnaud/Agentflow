'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { WriteQueue } = require('../utils/write-queue');

/** @type {Map<string, WriteQueue>} */
const queues = new Map();

/**
 * Get (or create) the singleton WriteQueue for a given runDir.
 * @param {string} runDir
 * @returns {WriteQueue}
 */
function getQueue(runDir) {
  if (!queues.has(runDir)) {
    queues.set(runDir, new WriteQueue());
  }
  return queues.get(runDir);
}

/**
 * Read and parse run.json from runDir.
 * @param {string} runDir
 * @returns {Promise<object>}
 */
async function readRunState(runDir) {
  const filePath = path.join(runDir, 'run.json');
  const raw = await fs.readFile(filePath, 'utf8');
  return JSON.parse(raw);
}

/**
 * Overwrite run.json with the given state (pretty-printed JSON).
 * @param {string} runDir
 * @param {object} state
 * @returns {Promise<void>}
 */
async function writeRunState(runDir, state) {
  const filePath = path.join(runDir, 'run.json');
  await fs.writeFile(filePath, JSON.stringify(state, null, 2), 'utf8');
}

/**
 * Apply patchFn to the current state and write the result back,
 * serialized through the per-runDir WriteQueue to prevent lost updates.
 * @param {string} runDir
 * @param {(state: object) => object} patchFn
 * @returns {Promise<void>}
 */
async function updateRunState(runDir, patchFn) {
  const queue = getQueue(runDir);
  return queue.enqueue(async () => {
    const state = await readRunState(runDir);
    const newState = patchFn(state);
    await writeRunState(runDir, newState);
  });
}

/**
 * Set step.status and optionally merge extra fields into the step object.
 * @param {string} runDir
 * @param {string} stepId
 * @param {string} status
 * @param {object} [extra]
 * @returns {Promise<void>}
 */
async function markStepStatus(runDir, stepId, status, extra) {
  return updateRunState(runDir, (state) => {
    const steps = state.steps || {};
    const existing = steps[stepId] || {};
    return {
      ...state,
      steps: {
        ...steps,
        [stepId]: {
          ...existing,
          ...(extra || {}),
          status,
        },
      },
    };
  });
}

/**
 * Set step.tracks[trackSlug].status and optionally merge extra fields.
 * Creates the tracks object if it doesn't exist.
 * @param {string} runDir
 * @param {string} stepId
 * @param {string} trackSlug
 * @param {string} status
 * @param {object} [extra]
 * @returns {Promise<void>}
 */
async function markTrackStatus(runDir, stepId, trackSlug, status, extra) {
  return updateRunState(runDir, (state) => {
    const steps = state.steps || {};
    const existingStep = steps[stepId] || {};
    const existingTracks = existingStep.tracks || {};
    const existingTrack = existingTracks[trackSlug] || {};
    return {
      ...state,
      steps: {
        ...steps,
        [stepId]: {
          ...existingStep,
          tracks: {
            ...existingTracks,
            [trackSlug]: {
              ...existingTrack,
              ...(extra || {}),
              status,
            },
          },
        },
      },
    };
  });
}

module.exports = {
  readRunState,
  writeRunState,
  updateRunState,
  markStepStatus,
  markTrackStatus,
};
