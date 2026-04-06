'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { updateRunState } = require('../state/run-state');
const { readFeedback } = require('./feedback-parser');

/**
 * Determine the appropriate step status for the given request type.
 * @param {string} type
 * @returns {string}
 */
function stepStatusForType(type) {
  if (type === 'track_selection') return 'awaiting_track_selection';
  return 'awaiting_validation';
}

/**
 * Write a user-feedback-request.json to the step's directory,
 * update the run.json step status and overall run status to "paused".
 *
 * @param {string} runDir
 * @param {string} stepId
 * @param {{ question: string, options: string[], type: string }} opts
 * @returns {Promise<void>}
 */
async function writeUserRequest(runDir, stepId, { question, options, type }) {
  const stepDir = path.join(runDir, 'steps', stepId);
  await fs.mkdir(stepDir, { recursive: true });

  const requestPayload = { question, options, type, stepId, createdAt: new Date().toISOString() };
  await fs.writeFile(
    path.join(stepDir, 'user-feedback-request.json'),
    JSON.stringify(requestPayload, null, 2),
    'utf8'
  );

  const stepStatus = stepStatusForType(type);

  await updateRunState(runDir, (state) => {
    const steps = state.steps || {};
    const existing = steps[stepId] || {};
    return {
      ...state,
      status: 'paused',
      steps: {
        ...steps,
        [stepId]: {
          ...existing,
          status: stepStatus,
        },
      },
    };
  });
}

/**
 * Read the user's response (user-feedback.md) for a step.
 * @param {string} runDir
 * @param {string} stepId
 * @returns {Promise<{ decisions: string, free: string, action: string|null }|null>}
 */
async function readUserResponse(runDir, stepId) {
  const feedbackPath = path.join(runDir, 'steps', stepId, 'user-feedback.md');
  return readFeedback(feedbackPath);
}

/**
 * Check whether the user has written a response file.
 * @param {string} runDir
 * @param {string} stepId
 * @returns {Promise<boolean>}
 */
async function hasUserResponse(runDir, stepId) {
  const feedbackPath = path.join(runDir, 'steps', stepId, 'user-feedback.md');
  try {
    await fs.access(feedbackPath);
    return true;
  } catch {
    return false;
  }
}

module.exports = { writeUserRequest, readUserResponse, hasUserResponse };
