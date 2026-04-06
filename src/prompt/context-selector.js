'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

/**
 * Substitute {{track}} placeholder in a string with the actual trackSlug.
 *
 * @param {string} str
 * @param {string} trackSlug
 * @returns {string}
 */
function substituteTrack(str, trackSlug) {
  return str.replace(/\{\{track\}\}/g, trackSlug);
}

/**
 * Read a user-feedback markdown file for a step and extract sections.
 * Expects headings like "## Decisions" and "## Free feedback".
 *
 * @param {string} runDir
 * @param {string} stepId
 * @returns {Promise<{ decisions: string, free: string } | null>}
 */
async function readUserFeedback(runDir, stepId) {
  const feedbackPath = path.join(runDir, 'steps', stepId, 'user-feedback.md');
  let raw;
  try {
    raw = await fs.readFile(feedbackPath, 'utf8');
  } catch {
    return null;
  }

  const decisionsMatch = raw.match(/##\s+Decisions\s*\n([\s\S]*?)(?=##|$)/i);
  const freeMatch = raw.match(/##\s+Free feedback\s*\n([\s\S]*?)(?=##|$)/i);

  return {
    decisions: decisionsMatch ? decisionsMatch[1].trim() : '',
    free: freeMatch ? freeMatch[1].trim() : '',
  };
}

/**
 * Resolves a step's context: declarations into actual artifact contents,
 * handling {{track}} substitution.
 *
 * Declaration formats:
 *   - "artifacts.stepId"           → read step's artifact_path
 *   - "artifacts.stepId.trackSlug" → read step's tracks[trackSlug].artifact_path
 *   - "user_feedback.stepId.decisions" → read user-feedback for step, return decisions
 *
 * Unknown or missing entries are silently skipped (logged to stderr).
 *
 * @param {string[]} contextDeclarations
 * @param {{ runDir: string, runState: object, trackSlug: string }} opts
 * @returns {Promise<{ artifacts: object, userFeedback: object }>}
 */
async function selectContext(contextDeclarations, { runDir, runState, trackSlug }) {
  const artifacts = {};
  const userFeedback = {};

  if (!contextDeclarations || contextDeclarations.length === 0) {
    return { artifacts, userFeedback };
  }

  const steps = runState.steps || {};

  await Promise.all(
    contextDeclarations.map(async (decl) => {
      // Substitute {{track}} in the declaration
      const resolved = substituteTrack(decl, trackSlug || '');
      const parts = resolved.split('.');

      if (parts[0] === 'artifacts') {
        const stepId = parts[1];
        const trackName = parts[2]; // may be undefined

        if (!stepId) {
          process.stderr.write(`[context-selector] Invalid artifacts declaration: '${decl}'\n`);
          return;
        }

        const step = steps[stepId];
        if (!step) {
          process.stderr.write(`[context-selector] Step '${stepId}' not found in run state (from '${decl}')\n`);
          return;
        }

        let artifactPath;

        if (trackName) {
          // Track-specific: artifacts.stepId.trackSlug
          const trackEntry = step.tracks && step.tracks[trackName];
          if (!trackEntry || !trackEntry.artifact_path) {
            process.stderr.write(
              `[context-selector] Track '${trackName}' artifact not found for step '${stepId}' (from '${decl}')\n`
            );
            return;
          }
          artifactPath = trackEntry.artifact_path;
        } else {
          // Plain step artifact
          if (!step.artifact_path) {
            process.stderr.write(
              `[context-selector] No artifact_path for step '${stepId}' (from '${decl}')\n`
            );
            return;
          }
          artifactPath = step.artifact_path;
        }

        try {
          artifacts[stepId] = await fs.readFile(path.join(runDir, artifactPath), 'utf8');
        } catch (err) {
          process.stderr.write(
            `[context-selector] Could not read artifact '${artifactPath}' for step '${stepId}': ${err.message}\n`
          );
        }

      } else if (parts[0] === 'user_feedback') {
        const stepId = parts[1];
        // parts[2] is the sub-field: "decisions" or "free"

        if (!stepId) {
          process.stderr.write(`[context-selector] Invalid user_feedback declaration: '${decl}'\n`);
          return;
        }

        const step = steps[stepId];
        if (!step) {
          process.stderr.write(
            `[context-selector] Step '${stepId}' not found in run state (from '${decl}')\n`
          );
          return;
        }

        const feedback = await readUserFeedback(runDir, stepId);
        if (feedback) {
          userFeedback[stepId] = feedback;
        } else {
          process.stderr.write(
            `[context-selector] No user-feedback file found for step '${stepId}' (from '${decl}')\n`
          );
        }

      } else {
        process.stderr.write(`[context-selector] Unknown declaration type: '${decl}'\n`);
      }
    })
  );

  return { artifacts, userFeedback };
}

module.exports = { selectContext };
