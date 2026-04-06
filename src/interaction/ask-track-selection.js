'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { updateRunState, markStepStatus } = require('../state/run-state');

/**
 * Presents a track keep/discard prompt by writing a structured request file.
 * Uses the file-based (Option A) approach: writes request, pauses run, user resumes.
 *
 * @param {object} opts
 * @param {string}   opts.runDir
 * @param {string}   opts.stepId     — the explore/decide step whose tracks need selection
 * @param {string[]} opts.trackSlugs — available track slugs to choose from
 * @param {object}   [opts.summaries] — optional { [slug]: string } short summary per track
 */
async function writeTrackSelectionRequest(runDir, stepId, trackSlugs, summaries = {}) {
  const requestDir = path.join(runDir, 'steps', stepId);
  await fs.mkdir(requestDir, { recursive: true });

  const request = {
    type: 'track_selection',
    step_id: stepId,
    available_tracks: trackSlugs,
    summaries,
    instructions: [
      'Review the artifacts in runs/<run-id>/artifacts/<step-id>/ for each track.',
      'Edit user-feedback.md in this directory to specify which tracks to keep.',
      'Format: list track slugs under "## Keep" and optionally "## Discard".',
      'Then run: /agentflow:resume <run-id>',
    ],
    user_feedback_path: path.join(requestDir, 'user-feedback.md'),
  };

  await fs.writeFile(
    path.join(requestDir, 'user-feedback-request.json'),
    JSON.stringify(request, null, 2),
    'utf8'
  );

  // Write a template user-feedback.md to guide the user
  const template = `# Track Selection — ${stepId}

## Keep
${trackSlugs.map(s => `- ${s}`).join('\n')}

## Discard
(move slugs here that should be dropped)

## Notes
(optional notes about your selection)
`;

  const feedbackPath = path.join(requestDir, 'user-feedback.md');
  // Only write template if file doesn't already exist
  try {
    await fs.access(feedbackPath);
  } catch {
    await fs.writeFile(feedbackPath, template, 'utf8');
  }

  await markStepStatus(runDir, stepId, 'awaiting_track_selection');
  await updateRunState(runDir, s => ({ ...s, status: 'paused' }));
}

/**
 * Reads the user's track selection from user-feedback.md.
 * Returns null if the user hasn't responded yet (file has template content only).
 *
 * @param {string} runDir
 * @param {string} stepId
 * @param {string[]} allTracks — all available track slugs
 * @returns {{ keep: string[], discard: string[] } | null}
 */
async function readTrackSelection(runDir, stepId, allTracks) {
  const feedbackPath = path.join(runDir, 'steps', stepId, 'user-feedback.md');

  let content;
  try {
    content = await fs.readFile(feedbackPath, 'utf8');
  } catch {
    return null;
  }

  // Parse ## Keep and ## Discard sections
  const keepMatch = content.match(/^##\s+Keep\s*\n([\s\S]*?)(?=^##|\Z)/m);
  const discardMatch = content.match(/^##\s+Discard\s*\n([\s\S]*?)(?=^##|\Z)/m);

  const parseList = (raw) => {
    if (!raw) return [];
    return raw
      .split('\n')
      .map(l => l.replace(/^[-*]\s*/, '').trim())
      .filter(l => l.length > 0 && !l.startsWith('('));
  };

  const keep = parseList(keepMatch?.[1]);
  const discard = parseList(discardMatch?.[1]);

  // If keep list is identical to allTracks (template not edited), return null
  if (keep.length === allTracks.length && keep.every((s, i) => s === allTracks[i]) && discard.length === 0) {
    return null; // user hasn't made a selection yet
  }

  return { keep, discard };
}

module.exports = { writeTrackSelectionRequest, readTrackSelection };
