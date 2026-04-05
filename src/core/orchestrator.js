'use strict';

const path = require('node:path');
const fs = require('node:fs/promises');
const yaml = require('js-yaml');

const { initRun } = require('../state/run-init');
const { readRunState, updateRunState, markStepStatus } = require('../state/run-state');
const { buildRegistry } = require('../registry/resolver');
const { resolveStep } = require('./step-template-loader');
const { evaluateCondition } = require('./condition-evaluator');
const { buildPrompt } = require('../prompt/prompt-builder');
const runner = require('../subprocess/runner');
const { SentinelWatcher } = require('../subprocess/subprocess-watcher');
const { Watchdog } = require('../subprocess/subprocess-watchdog');
const { SubprocessPool } = require('../subprocess/subprocess-pool');

const DEFAULT_CONCURRENCY = {
  maxTotal: 8,
  maxLead: 4,
  maxReviewer: 6,
  maxModerator: 4,
  subprocessTimeoutMs: 120000,
  watchdogPollIntervalMs: 5000,
};

/**
 * Load and parse a YAML flow file.
 */
async function loadFlow(flowFile) {
  const content = await fs.readFile(flowFile, 'utf8');
  return yaml.load(content);
}

/**
 * Build the condition evaluation context from current run state.
 */
function buildConditionContext(runState) {
  const artifacts = {};
  for (const [stepId, step] of Object.entries(runState.steps || {})) {
    if (step.artifact_path) {
      artifacts[stepId] = step._artifactContent || '';
    }
  }
  return {
    surviving_tracks: { count: 0, names: [] },
    flow: { input: runState.flow_input, id: runState.flow_id },
    artifacts,
    user_feedback: runState.user_feedback || {},
    steps: Object.fromEntries(
      Object.entries(runState.steps || {}).map(([id, s]) => [id, { status: s.status }])
    ),
  };
}

/**
 * Check if all depends_on steps are done.
 */
function depsResolved(step, runState) {
  const deps = step.depends_on || [];
  return deps.every(dep => {
    const depStep = runState.steps[dep];
    return depStep && depStep.status === 'done';
  });
}

/**
 * Execute a single explore step (single artifact, no review cycle).
 */
async function executeExploreStep(step, runState, registry, runDir, pool, watchdog, config) {
  const { id: stepId } = step;

  // Resolve agent
  const leadId = step.lead;
  if (!leadId) throw new Error(`Step ${stepId}: missing 'lead' agent`);

  const agentEntry = registry.agents.get(leadId);
  if (!agentEntry) throw new Error(`Step ${stepId}: agent '${leadId}' not found in registry`);

  // Resolve template
  let templatePath = null;
  if (step.artifacts && step.artifacts[0] && step.artifacts[0].template) {
    const tmpl = registry.templates.get(step.artifacts[0].template);
    if (tmpl) templatePath = tmpl.path;
  }

  // Gather prior artifacts
  const artifacts = {};
  for (const [sid, s] of Object.entries(runState.steps)) {
    if (s.status === 'done' && s._artifactContent) {
      artifacts[sid] = s._artifactContent;
    }
  }

  const flowContext = {
    flow: { input: runState.flow_input, id: runState.flow_id },
    step: { id: stepId },
    track: {},
  };

  const promptContent = await buildPrompt({
    agentPath: agentEntry.path,
    skillPaths: [],
    contextPaths: [],
    templatePath,
    flowContext,
    artifacts,
    userFeedback: runState.user_feedback || {},
  });

  // Determine sentinel dir
  const sentinelDir = path.join(runDir, 'steps', stepId, 'v1', 'lead');
  await fs.mkdir(sentinelDir, { recursive: true });

  // Acquire pool slot
  const release = await pool.acquire('lead');
  watchdog.register(sentinelDir, config.subprocessTimeoutMs);

  try {
    await markStepStatus(runDir, stepId, 'running_lead');

    const watcher = new SentinelWatcher();

    await new Promise((resolve, reject) => {
      watcher.on('done', async ({ content }) => {
        watchdog.deregister(sentinelDir);
        const outputPath = path.join(sentinelDir, 'output.md');
        let artifactContent = '';
        try { artifactContent = await fs.readFile(outputPath, 'utf8'); } catch {}

        // Copy to artifacts/
        const artifactName = (step.artifacts && step.artifacts[0] && step.artifacts[0].name) || `${stepId}.md`;
        const artifactPath = path.join(runDir, 'artifacts', artifactName);
        await fs.mkdir(path.dirname(artifactPath), { recursive: true });
        await fs.writeFile(artifactPath, artifactContent, 'utf8');

        await markStepStatus(runDir, stepId, 'done', {
          artifact_path: `artifacts/${artifactName}`,
          _artifactContent: artifactContent,
          cost_usd: content.cost_usd || 0,
        });
        resolve();
      });

      watcher.on('failed', async ({ content }) => {
        watchdog.deregister(sentinelDir);
        await markStepStatus(runDir, stepId, 'failed', { error: content });
        reject(new Error(`Step ${stepId} failed: ${JSON.stringify(content)}`));
      });

      watcher.poll(sentinelDir, 500);

      // Spawn the subprocess
      runner.spawnSubprocess({
        sentinelDir,
        promptContent,
        timeout: config.subprocessTimeoutMs,
      }).catch(reject);
    });

    watcher.stop();
  } finally {
    release();
  }
}

/**
 * Main orchestrator — runs a flow from start to finish.
 *
 * @param {object} opts
 * @param {string} opts.flowFile    - path to flow YAML file
 * @param {string} opts.flowInput   - user input string
 * @param {string} opts.runsDir     - directory where runs are stored
 * @param {object} [opts.config]    - concurrency/timeout config overrides
 * @param {object} [opts.registry]  - pre-built registry (for testing)
 * @param {string} [opts.runId]     - explicit run ID (for testing / resume)
 * @returns {Promise<{ runId, runDir, runState }>}
 */
async function runFlow({ flowFile, flowInput, runsDir, config = {}, registry = null, runId = null }) {
  const mergedConfig = { ...DEFAULT_CONCURRENCY, ...config };

  // Load flow YAML
  const flow = await loadFlow(flowFile);
  const flowId = flow.flow?.id || flow.id || path.basename(flowFile, '.yaml');
  const rawSteps = flow.flow?.steps || flow.steps || [];

  // Resolve step templates
  const stepTemplatesDir = path.join(path.dirname(flowFile), '..', 'step-templates');
  const resolvedSteps = await Promise.all(
    rawSteps.map(s => resolveStep(s, { stepTemplatesDir, projectRoot: path.dirname(flowFile) }))
  );

  // Build registry if not provided
  const pluginsDir = process.env.AGENTFLOW_PLUGINS_DIR
    || path.join(process.env.HOME || process.env.USERPROFILE || '', '.claude', 'plugins');
  const localTemplatesDir = path.join(path.dirname(flowFile), '..', 'templates');

  let reg = registry;
  if (!reg) {
    const pluginDirs = [];
    try {
      const entries = await fs.readdir(pluginsDir);
      for (const e of entries) {
        pluginDirs.push(path.join(pluginsDir, e));
      }
    } catch {}
    reg = await buildRegistry({ pluginDirs, localTemplatesDir });
  }

  // Initialize run
  const crypto = require('node:crypto');
  const effectiveRunId = runId || `${flowId}-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${crypto.randomBytes(3).toString('hex')}`;
  const runDir = path.join(runsDir, effectiveRunId);

  const stepsMap = Object.fromEntries(
    resolvedSteps.map(s => [s.id, {
      id: s.id,
      type: s.type || 'explore',
      status: 'pending',
      depends_on: s.depends_on || [],
      condition: s.condition || null,
    }])
  );

  await initRun({
    runDir,
    flowId,
    flowFile,
    flowInput,
    steps: resolvedSteps,
  });

  // Set up concurrency infrastructure
  const pool = new SubprocessPool({
    maxTotal: mergedConfig.maxTotal,
    maxLead: mergedConfig.maxLead,
    maxReviewer: mergedConfig.maxReviewer,
    maxModerator: mergedConfig.maxModerator,
  });
  const watchdog = new Watchdog({ pollIntervalMs: mergedConfig.watchdogPollIntervalMs });
  watchdog.start();

  try {
    // Main step execution loop
    const executed = new Set();

    const executeReadySteps = async () => {
      const runState = await readRunState(runDir);
      const pending = resolvedSteps.filter(s =>
        !executed.has(s.id) &&
        runState.steps[s.id]?.status === 'pending'
      );

      const ready = pending.filter(s => depsResolved(s, runState));

      for (const step of ready) {
        // Evaluate condition
        if (step.condition) {
          const ctx = buildConditionContext(runState);
          const proceed = evaluateCondition(step.condition, ctx);
          if (!proceed) {
            executed.add(step.id);
            await markStepStatus(runDir, step.id, 'skipped');
            continue;
          }
        }

        executed.add(step.id);
        const stepType = step.type || 'explore';

        if (stepType === 'explore') {
          await executeExploreStep(step, runState, reg, runDir, pool, watchdog, mergedConfig);
        } else if (stepType === 'validate') {
          // validate: pause and write a request file, then mark as awaiting_validation
          const requestPath = path.join(runDir, 'steps', step.id, 'user-feedback-request.json');
          await fs.mkdir(path.dirname(requestPath), { recursive: true });
          await fs.writeFile(requestPath, JSON.stringify({ step: step.id, type: 'validate' }, null, 2));
          await markStepStatus(runDir, step.id, 'awaiting_validation');
          // For now, stop the flow — user must resume
          await updateRunState(runDir, s => ({ ...s, status: 'paused' }));
          return false; // signal to stop loop
        } else {
          // refine and decide are stubs for Phase 1b
          await markStepStatus(runDir, step.id, 'skipped', { reason: `step type '${stepType}' not yet implemented` });
        }
      }

      return true; // continue loop
    };

    let continueLoop = true;
    while (continueLoop) {
      const runState = await readRunState(runDir);
      const allDone = resolvedSteps.every(s => {
        const st = runState.steps[s.id]?.status;
        return st === 'done' || st === 'skipped' || st === 'failed';
      });

      if (allDone) break;

      continueLoop = await executeReadySteps();

      if (continueLoop) {
        // Small yield to allow async operations to settle
        await new Promise(r => setTimeout(r, 100));
      }
    }

    // Mark run as completed
    const finalState = await readRunState(runDir);
    const hasFailed = Object.values(finalState.steps).some(s => s.status === 'failed');
    const isPaused = finalState.status === 'paused';

    if (!isPaused) {
      await updateRunState(runDir, s => ({
        ...s,
        status: hasFailed ? 'failed' : 'completed',
        updated_at: new Date().toISOString(),
      }));
    }

    return {
      runId: effectiveRunId,
      runDir,
      runState: await readRunState(runDir),
    };
  } finally {
    watchdog.stop();
  }
}

module.exports = { runFlow, loadFlow, buildConditionContext, depsResolved };
