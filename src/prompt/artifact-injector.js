'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

/**
 * Reads a single artifact file relative to runDir and returns its content.
 *
 * @param {string} runDir
 * @param {string} artifactPath - relative path like "artifacts/user-research.md"
 * @returns {Promise<string>}
 */
async function injectArtifact(runDir, artifactPath) {
  const fullPath = path.join(runDir, artifactPath);
  return fs.readFile(fullPath, 'utf8');
}

/**
 * Default artifact injection — injects all completed step artifacts into prompt
 * context when no explicit context: selector is declared.
 *
 * Reads all steps with status='done' that have artifact_path, reads each file,
 * and returns a map of stepId → content.
 *
 * @param {string} runDir
 * @param {object} runState - parsed run.json
 * @returns {Promise<{ [stepId]: string }>}
 */
async function injectAllArtifacts(runDir, runState) {
  const result = {};
  const steps = runState.steps || {};

  await Promise.all(
    Object.entries(steps).map(async ([stepId, step]) => {
      if (step.status !== 'done') return;
      if (!step.artifact_path) return;

      try {
        result[stepId] = await injectArtifact(runDir, step.artifact_path);
      } catch (err) {
        process.stderr.write(`[artifact-injector] Could not read artifact for step '${stepId}': ${err.message}\n`);
      }
    })
  );

  return result;
}

module.exports = { injectAllArtifacts, injectArtifact };
