'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

/**
 * Create the full run directory structure and initial run.json.
 *
 * @param {object} opts
 * @param {string}   opts.runDir       - Absolute path to run directory (must already exist)
 * @param {string}   opts.flowId       - Flow identifier
 * @param {string}   opts.flowFile     - Path to the flow YAML file
 * @param {object}   opts.flowInput    - Input values for the flow
 * @param {Array}    opts.steps        - Array of step descriptors { id, type, depends_on, condition }
 * @returns {Promise<void>}
 * @throws {Error} if run.json already exists in runDir
 */
async function initRun({ runDir, flowId, flowFile, flowInput, steps }) {
  const runJsonPath = path.join(runDir, 'run.json');

  // Idempotency guard: refuse to overwrite an existing run
  try {
    await fs.access(runJsonPath);
    // If we reach here, the file exists
    throw new Error(`run.json already exists in ${runDir} — refusing to overwrite an existing run`);
  } catch (err) {
    // Re-throw our own guard error
    if (err.message.startsWith('run.json already exists')) {
      throw err;
    }
    // Otherwise the file doesn't exist, which is what we want — proceed
  }

  // Build the steps map
  const stepsMap = {};
  for (const step of steps) {
    stepsMap[step.id] = {
      id: step.id,
      type: step.type,
      status: 'pending',
      depends_on: step.depends_on,
      condition: step.condition,
    };
  }

  const now = new Date().toISOString();
  const state = {
    run_id: path.basename(runDir),
    flow_id: flowId,
    flow_file: flowFile,
    flow_input: flowInput,
    status: 'running',
    created_at: now,
    updated_at: now,
    steps: stepsMap,
  };

  // Create subdirectories
  await fs.mkdir(path.join(runDir, 'artifacts'), { recursive: true });
  await fs.mkdir(path.join(runDir, 'steps'), { recursive: true });

  // Write initial run.json
  await fs.writeFile(runJsonPath, JSON.stringify(state, null, 2), 'utf8');
}

module.exports = { initRun };
