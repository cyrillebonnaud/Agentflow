'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

/**
 * Builds the per-track context object for multi-track step prompts.
 * Handles {{track}} substitution in context declarations.
 *
 * @param {object} opts
 * @param {string}   opts.runDir
 * @param {object}   opts.runState         — parsed run.json
 * @param {string}   opts.trackSlug        — current track
 * @param {number}   opts.trackIndex       — 1-based index
 * @param {number}   opts.trackTotal       — total number of tracks
 * @param {string[]} [opts.contextDecls]   — step's context: declarations; if absent, inject all
 * @returns {Promise<{
 *   artifacts: { [stepId]: string },
 *   userFeedback: { [stepId]: { decisions: string, free: string } },
 *   flowContext: { flow: {input, id}, step: {id}, track: {name, index, total} }
 * }>}
 */
async function buildTrackContext({ runDir, runState, stepId, trackSlug, trackIndex, trackTotal, contextDecls }) {
  const artifacts = {};
  const userFeedback = {};

  if (!contextDecls) {
    // Default: inject all completed artifacts
    for (const [sid, step] of Object.entries(runState.steps || {})) {
      if (step.status === 'done' && step.artifact_path) {
        const artifactPath = path.join(runDir, step.artifact_path);
        try {
          artifacts[sid] = await fs.readFile(artifactPath, 'utf8');
        } catch {
          // artifact file missing — skip silently
        }
      }
    }
  } else {
    // Explicit context declarations
    for (const decl of contextDecls) {
      const resolved = decl.replace(/\{\{track\}\}/g, trackSlug);

      if (resolved.startsWith('artifacts.')) {
        const parts = resolved.slice('artifacts.'.length).split('.');
        const sid = parts[0];
        const trackRef = parts[1]; // optional track

        const step = runState.steps?.[sid];
        if (!step || step.status !== 'done') continue;

        let artifactPath;
        if (trackRef) {
          artifactPath = path.join(runDir, 'artifacts', sid, `${trackRef}.md`);
        } else {
          artifactPath = step.artifact_path
            ? path.join(runDir, step.artifact_path)
            : path.join(runDir, 'artifacts', `${sid}.md`);
        }

        try {
          artifacts[sid] = await fs.readFile(artifactPath, 'utf8');
        } catch {
          // missing — skip
        }
      } else if (resolved.startsWith('user_feedback.')) {
        const parts = resolved.slice('user_feedback.'.length).split('.');
        const sid = parts[0];
        const field = parts[1]; // 'decisions' or 'free'

        const feedbackPath = path.join(runDir, 'steps', sid, 'user-feedback.md');
        try {
          const content = await fs.readFile(feedbackPath, 'utf8');
          if (!userFeedback[sid]) userFeedback[sid] = { decisions: '', free: '' };

          if (field === 'decisions') {
            const m = content.match(/^##\s+Decisions\s*\n([\s\S]*?)(?=^##|\Z)/m);
            userFeedback[sid].decisions = m?.[1]?.trim() || '';
          } else if (field === 'free') {
            const m = content.match(/^##\s+Free feedback\s*\n([\s\S]*?)(?=^##|\Z)/m);
            userFeedback[sid].free = m?.[1]?.trim() || '';
          }
        } catch {
          // missing — skip
        }
      }
    }
  }

  const flowContext = {
    flow: {
      input: runState.flow_input || '',
      id: runState.flow_id || '',
    },
    step: { id: stepId },
    track: {
      name: trackSlug,
      index: trackIndex,
      total: trackTotal,
    },
  };

  return { artifacts, userFeedback, flowContext };
}

module.exports = { buildTrackContext };
