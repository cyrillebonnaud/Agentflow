'use strict';

const { readRunState, updateRunState, markTrackStatus } = require('../state/run-state');

/**
 * Adds a track entry to run.json:
 *   steps[stepId].tracks[trackSlug] = { status: 'pending', version: 1 }
 *
 * @param {string} runDir
 * @param {string} stepId
 * @param {string} trackSlug
 * @returns {Promise<void>}
 */
async function createTrack(runDir, stepId, trackSlug) {
  return updateRunState(runDir, (state) => {
    const steps = state.steps || {};
    const existingStep = steps[stepId] || {};
    const existingTracks = existingStep.tracks || {};
    return {
      ...state,
      steps: {
        ...steps,
        [stepId]: {
          ...existingStep,
          tracks: {
            ...existingTracks,
            [trackSlug]: {
              status: 'pending',
              version: 1,
            },
          },
        },
      },
    };
  });
}

/**
 * Sets track status to 'done' and merges extra fields (artifact_path, cost_usd, etc.).
 *
 * @param {string} runDir
 * @param {string} stepId
 * @param {string} trackSlug
 * @param {object} [extra]
 * @returns {Promise<void>}
 */
async function markTrackDone(runDir, stepId, trackSlug, extra) {
  return markTrackStatus(runDir, stepId, trackSlug, 'done', extra);
}

/**
 * Sets track status to 'failed' and stores error message.
 *
 * @param {string} runDir
 * @param {string} stepId
 * @param {string} trackSlug
 * @param {string} error
 * @returns {Promise<void>}
 */
async function markTrackFailed(runDir, stepId, trackSlug, error) {
  return markTrackStatus(runDir, stepId, trackSlug, 'failed', { error });
}

/**
 * Sets track status to 'discarded'.
 *
 * @param {string} runDir
 * @param {string} stepId
 * @param {string} trackSlug
 * @returns {Promise<void>}
 */
async function discardTrack(runDir, stepId, trackSlug) {
  return markTrackStatus(runDir, stepId, trackSlug, 'discarded');
}

/**
 * Returns array of track slugs with status === 'done'.
 *
 * @param {string} runDir
 * @param {string} stepId
 * @returns {Promise<string[]>}
 */
async function getSurvivingTracks(runDir, stepId) {
  const state = await readRunState(runDir);
  const step = (state.steps || {})[stepId] || {};
  const tracks = step.tracks || {};
  return Object.entries(tracks)
    .filter(([, track]) => track.status === 'done')
    .map(([slug]) => slug);
}

/**
 * Returns track status string or null if track not found.
 *
 * @param {string} runDir
 * @param {string} stepId
 * @param {string} trackSlug
 * @returns {Promise<string|null>}
 */
async function getTrackStatus(runDir, stepId, trackSlug) {
  const state = await readRunState(runDir);
  const step = (state.steps || {})[stepId] || {};
  const tracks = step.tracks || {};
  const track = tracks[trackSlug];
  return track ? track.status : null;
}

module.exports = {
  createTrack,
  markTrackDone,
  markTrackFailed,
  discardTrack,
  getSurvivingTracks,
  getTrackStatus,
};
