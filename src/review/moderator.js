'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

/**
 * Build the base path for a review round.
 * steps/<stepId>/<trackSlug>/v<N>/reviews/round-<R>
 */
function roundDir(runDir, stepId, trackSlug, version, round) {
  return path.join(runDir, 'steps', stepId, trackSlug, `v${version}`, 'reviews', `round-${round}`);
}

/**
 * Read all reviewer output.md files for this round.
 * @param {string} runDir
 * @param {string} stepId
 * @param {string} trackSlug
 * @param {number} version
 * @param {number} round
 * @param {string[]} reviewers - reviewer IDs
 * @returns {Promise<Array<{ reviewerId: string, content: string }>>}
 */
async function readReviewOutputs(runDir, stepId, trackSlug, version, round, reviewers) {
  const base = roundDir(runDir, stepId, trackSlug, version, round);
  return Promise.all(
    reviewers.map(async (reviewerId) => {
      const outputPath = path.join(base, reviewerId, 'output.md');
      let content = '';
      try {
        content = await fs.readFile(outputPath, 'utf8');
      } catch {
        // Missing output.md — return empty string
      }
      return { reviewerId, content };
    })
  );
}

/**
 * Check whether a moderator output indicates convergence.
 * Returns true if the text contains "CONVERGED" (case-insensitive).
 * @param {string} moderatorOutput
 * @returns {boolean}
 */
function checkConvergence(moderatorOutput) {
  // Reject explicit negation patterns first
  if (/not\s+(?:yet\s+)?converged/i.test(moderatorOutput)) return false;
  if (/still\s+not\s+converged/i.test(moderatorOutput)) return false;
  // Then check for any occurrence of "converged"
  return /\bconverged\b/i.test(moderatorOutput);
}

/**
 * Write synthesis.md to the moderator's directory for this round.
 * Path: steps/<stepId>/<trackSlug>/v<N>/reviews/round-<R>/moderator/synthesis.md
 * @param {string} runDir
 * @param {string} stepId
 * @param {string} trackSlug
 * @param {number} version
 * @param {number} round
 * @param {string} content
 * @returns {Promise<string>} full path to synthesis.md
 */
async function writeSynthesis(runDir, stepId, trackSlug, version, round, content) {
  const modDir = path.join(roundDir(runDir, stepId, trackSlug, version, round), 'moderator');
  await fs.mkdir(modDir, { recursive: true });
  const synthPath = path.join(modDir, 'synthesis.md');
  await fs.writeFile(synthPath, content, 'utf8');
  return synthPath;
}

module.exports = { readReviewOutputs, checkConvergence, writeSynthesis };
