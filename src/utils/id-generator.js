'use strict';

const crypto = require('node:crypto');

/**
 * Returns today's date as YYYYMMDD string.
 */
function todayString() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${yyyy}${mm}${dd}`;
}

/**
 * Generate a unique run ID incorporating the flowId and today's date.
 * Example: "ux-brief-20260405-a1b2c3"
 * @param {string} flowId
 * @returns {string}
 */
function generateRunId(flowId) {
  const date = todayString();
  const suffix = crypto.randomBytes(3).toString('hex');
  return `${flowId}-${date}-${suffix}`;
}

/**
 * Sanitize a path segment by replacing forward slashes with hyphens.
 * @param {string} segment
 * @returns {string}
 */
function sanitizeSegment(segment) {
  return String(segment).replace(/\//g, '-');
}

/**
 * Generate a step directory name in the format "stepId/track/vN".
 * Sanitizes slashes within individual inputs so the structure stays predictable.
 * Example: "step-id/track-slug/v1"
 * @param {string} stepId
 * @param {string} track
 * @param {number} version
 * @returns {string}
 */
function generateStepDirName(stepId, track, version) {
  const safeStepId = sanitizeSegment(stepId);
  const safeTrack = sanitizeSegment(track);
  return `${safeStepId}/${safeTrack}/v${version}`;
}

module.exports = { generateRunId, generateStepDirName };
