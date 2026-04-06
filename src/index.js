'use strict';

/**
 * Agentflow — public programmatic API
 *
 * Most users interact via the CLI (`agentflow run`).
 * Import this module when embedding Agentflow in a larger Node.js program.
 */

const { runFlow } = require('./core/orchestrator');
const { buildRegistry } = require('./registry/resolver');
const { initRun } = require('./state/run-init');
const { readRunState, updateRunState } = require('./state/run-state');

module.exports = {
  runFlow,
  buildRegistry,
  initRun,
  readRunState,
  updateRunState,
};
