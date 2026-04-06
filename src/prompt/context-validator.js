'use strict';

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
 * Validates all context: selectors against current run state before step
 * execution. Reports missing artifacts without throwing.
 *
 * Declaration formats checked:
 *   - "artifacts.stepId"               → step must exist and have artifact_path
 *   - "artifacts.stepId.trackSlug"     → step must have tracks[trackSlug].artifact_path
 *   - "user_feedback.stepId.field"     → step must exist in run state
 *
 * @param {string[]} contextDeclarations
 * @param {object} runState - parsed run.json
 * @param {string} trackSlug - current track (substituted for {{track}})
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateContextSelectors(contextDeclarations, runState, trackSlug) {
  const errors = [];
  const steps = runState.steps || {};

  if (!contextDeclarations || contextDeclarations.length === 0) {
    return { valid: true, errors };
  }

  for (const decl of contextDeclarations) {
    const resolved = substituteTrack(decl, trackSlug || '');
    const parts = resolved.split('.');

    if (parts[0] === 'artifacts') {
      const stepId = parts[1];
      const trackName = parts[2];

      if (!stepId) {
        errors.push(`Invalid artifacts declaration: '${decl}'`);
        continue;
      }

      const step = steps[stepId];
      if (!step) {
        errors.push(`artifacts.${stepId} not found in run state (step not recorded)`);
        continue;
      }

      if (trackName) {
        // Track-specific artifact
        const trackEntry = step.tracks && step.tracks[trackName];
        if (!trackEntry || !trackEntry.artifact_path) {
          const status = trackEntry ? trackEntry.status || 'unknown' : `step status: ${step.status || 'unknown'}`;
          errors.push(
            `artifacts.${stepId}.${trackName} not found in run state (${status})`
          );
        }
      } else {
        // Plain step artifact
        if (!step.artifact_path) {
          errors.push(
            `artifacts.${stepId} not found in run state (step status: ${step.status || 'unknown'})`
          );
        }
      }

    } else if (parts[0] === 'user_feedback') {
      const stepId = parts[1];

      if (!stepId) {
        errors.push(`Invalid user_feedback declaration: '${decl}'`);
        continue;
      }

      const step = steps[stepId];
      if (!step) {
        errors.push(`user_feedback.${stepId} not found in run state (step not recorded)`);
      }
      // Note: we only validate the step exists in run state.
      // The actual feedback file presence is checked at runtime by context-selector.

    } else {
      errors.push(`Unknown context declaration type: '${decl}'`);
    }
  }

  return { valid: errors.length === 0, errors };
}

module.exports = { validateContextSelectors };
