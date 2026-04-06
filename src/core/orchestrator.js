'use strict';

const path = require('node:path');
const fs = require('node:fs/promises');
const yaml = require('js-yaml');

const { initRun } = require('../state/run-init');
const { readRunState, updateRunState, markStepStatus, markTrackStatus } = require('../state/run-state');
const { buildRegistry } = require('../registry/resolver');
const { resolveStep } = require('./step-template-loader');
const { evaluateCondition } = require('./condition-evaluator');
const { buildPrompt } = require('../prompt/prompt-builder');
const { buildTrackContext } = require('../prompt/track-context-builder');
const { storeArtifact } = require('../state/artifact-store');
const { spawnLeadsParallel } = require('../subprocess/track-spawner');
const { runReviewLoop } = require('../review/review-loop');
const { writeUserRequest, readUserResponse, hasUserResponse } = require('../interaction/ask-user');
const { writeTrackSelectionRequest, readTrackSelection } = require('../interaction/ask-track-selection');
const { createTrack, markTrackDone, markTrackFailed, getSurvivingTracks } = require('../tracks/track-manager');
const { resolveArtifactMode } = require('../tracks/artifact-mode-resolver');
const { parseSlug } = require('../tracks/slug-parser');
const { sanitizeSlug, ensureUnique } = require('../tracks/slug-sanitizer');
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
    // Multi-track: also expose per-track artifacts
    if (step.tracks) {
      for (const [trackSlug, track] of Object.entries(step.tracks)) {
        if (track.artifact_path) {
          artifacts[`${stepId}.${trackSlug}`] = '';
        }
      }
    }
  }

  const survivingTracks = Object.values(runState.steps || {})
    .flatMap(s => Object.entries(s.tracks || {})
      .filter(([, t]) => t.status === 'done')
      .map(([slug]) => slug));

  return {
    surviving_tracks: { count: survivingTracks.length, names: survivingTracks },
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
    return depStep && (depStep.status === 'done' || depStep.status === 'skipped');
  });
}

/**
 * Resolve the agent entry from registry, throw with clear message if missing.
 */
function requireAgent(registry, agentId, stepId) {
  const entry = registry.agents.get(agentId);
  if (!entry) throw new Error(`Step ${stepId}: agent '${agentId}' not found in registry`);
  return entry;
}

/**
 * Execute a single explore step — single or multi-track, no review cycle.
 */
async function executeExploreStep(step, runState, registry, runDir, pool, watchdog, config) {
  const { id: stepId } = step;
  const leadId = step.lead;
  if (!leadId) throw new Error(`Step ${stepId}: missing 'lead' agent`);
  const agentEntry = requireAgent(registry, leadId, stepId);

  // Determine artifact mode
  const mode = step.artifact_type ? 'delegated' : (step.artifacts ? 'declarative' : 'delegated');

  if (mode === 'declarative' && step.artifacts && step.artifacts.length > 0) {
    // Single or multi-artifact declarative mode
    const trackDefs = step.artifacts.map((art, i) => ({
      slug: art.name?.replace(/\.(md|html)$/, '') || `track-${i + 1}`,
      artifactName: art.name || `${stepId}.md`,
      template: art.template || null,
    }));

    const usedSlugs = new Set();
    const tracks = await Promise.all(trackDefs.map(async (td, i) => {
      const slug = ensureUnique(sanitizeSlug(td.slug), usedSlugs);
      usedSlugs.add(slug);

      let templatePath = null;
      if (td.template) {
        const tmpl = registry.templates.get(td.template);
        if (tmpl) templatePath = tmpl.path;
      }

      const { artifacts: ctxArtifacts, userFeedback, flowContext } = await buildTrackContext({
        runDir, runState, stepId, trackSlug: slug,
        trackIndex: i + 1, trackTotal: trackDefs.length,
        contextDecls: step.context,
      });

      const promptContent = await buildPrompt({
        agentPath: agentEntry.path,
        skillPaths: [],
        contextPaths: [],
        templatePath,
        flowContext,
        artifacts: ctxArtifacts,
        userFeedback,
      });

      await createTrack(runDir, stepId, slug);
      return { slug, promptContent, artifactName: td.artifactName };
    }));

    await markStepStatus(runDir, stepId, 'running_lead');

    const results = await spawnLeadsParallel({
      runDir, stepId,
      tracks: tracks.map(t => ({ slug: t.slug, promptContent: t.promptContent })),
      version: 1, pool, timeoutMs: config.subprocessTimeoutMs,
    });

    // Store artifacts and update track state
    let anyFailed = false;
    for (const result of results) {
      const trackDef = tracks.find(t => t.slug === result.slug);
      if (result.status === 'done') {
        const outputPath = path.join(runDir, 'steps', stepId, result.slug, 'v1', 'lead', 'output.md');
        let content = '';
        try { content = await fs.readFile(outputPath, 'utf8'); } catch {}

        // Single track → artifacts/<stepId>.md; multi-track → artifacts/<stepId>/<slug>.md
        const isSingleArtifact = tracks.length === 1;
        const trackSlugForStore = isSingleArtifact ? undefined : result.slug;
        const artifactPath = await storeArtifact(runDir, stepId, content, trackSlugForStore);
        await markTrackDone(runDir, stepId, result.slug, { artifact_path: artifactPath });
      } else {
        anyFailed = true;
        await markTrackFailed(runDir, stepId, result.slug, result.content);
      }
    }

    if (anyFailed && tracks.length === 1) {
      await markStepStatus(runDir, stepId, 'failed');
      throw new Error(`Step ${stepId} failed`);
    }

    await markStepStatus(runDir, stepId, 'done');
  } else {
    // Delegated mode — single lead, Claude decides output structure
    const sentinelDir = path.join(runDir, 'steps', stepId, 'v1', 'lead');
    await fs.mkdir(sentinelDir, { recursive: true });

    const { artifacts: ctxArtifacts, userFeedback, flowContext } = await buildTrackContext({
      runDir, runState, stepId, trackSlug: 'main',
      trackIndex: 1, trackTotal: 1,
      contextDecls: step.context,
    });

    const promptContent = await buildPrompt({
      agentPath: agentEntry.path,
      skillPaths: [],
      contextPaths: [],
      templatePath: null,
      flowContext,
      artifacts: ctxArtifacts,
      userFeedback,
    });

    const release = await pool.acquire('lead');
    watchdog.register(sentinelDir, config.subprocessTimeoutMs);
    await markStepStatus(runDir, stepId, 'running_lead');

    try {
      const watcher = new SentinelWatcher();
      await new Promise((resolve, reject) => {
        watcher.on('done', async ({ content }) => {
          watchdog.deregister(sentinelDir);
          let artifactContent = '';
          try { artifactContent = await fs.readFile(path.join(sentinelDir, 'output.md'), 'utf8'); } catch {}
          const artifactPath = await storeArtifact(runDir, stepId, artifactContent);
          await markStepStatus(runDir, stepId, 'done', {
            artifact_path: artifactPath,
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
        runner.spawnSubprocess({ sentinelDir, promptContent, timeout: config.subprocessTimeoutMs }).catch(reject);
      });
      watcher.stop();
    } finally {
      release();
    }
  }
}

/**
 * Execute a refine step — lead + review cycle per track.
 */
async function executeRefineStep(step, runState, registry, runDir, pool, watchdog, config) {
  const { id: stepId } = step;
  const leadId = step.lead;
  if (!leadId) throw new Error(`Step ${stepId}: missing 'lead' agent`);
  const agentEntry = requireAgent(registry, leadId, stepId);

  const reviewers = step.reviewers || [];
  const moderatorId = step.moderator || 'moderator';
  const maxRounds = step.max_rounds || 2;
  const maxIterations = step.max_iterations || 3;

  // Determine tracks (inherit from depends_on step or declarative)
  let tracks;
  if (step.tracks === 'inherit') {
    // Find the last step with tracks
    const depStepId = (step.depends_on || [])[0];
    const depStep = depStepId ? runState.steps[depStepId] : null;
    if (depStep && depStep.tracks) {
      const surviving = await getSurvivingTracks(runDir, depStepId);
      tracks = surviving.map(slug => ({ slug, artifactName: `${slug}.md` }));
    } else {
      tracks = [{ slug: 'main', artifactName: `${stepId}.md` }];
    }
  } else if (step.artifacts && step.artifacts.length > 0) {
    const usedSlugs = new Set();
    tracks = step.artifacts.map(art => {
      const slug = ensureUnique(sanitizeSlug(art.name?.replace(/\.(md|html)$/, '') || 'main'), usedSlugs);
      usedSlugs.add(slug);
      return { slug, artifactName: art.name || `${slug}.md` };
    });
  } else {
    tracks = [{ slug: 'main', artifactName: `${stepId}.md` }];
  }

  await markStepStatus(runDir, stepId, 'running_lead');

  // Execute lead + review loop for each track
  for (const track of tracks) {
    await createTrack(runDir, stepId, track.slug);

    // Phase 1: Lead
    const sentinelDir = path.join(runDir, 'steps', stepId, track.slug, 'v1', 'lead');
    await fs.mkdir(sentinelDir, { recursive: true });

    const { artifacts: ctxArtifacts, userFeedback, flowContext } = await buildTrackContext({
      runDir, runState, stepId, trackSlug: track.slug,
      trackIndex: tracks.indexOf(track) + 1, trackTotal: tracks.length,
      contextDecls: step.context,
    });

    const leadPrompt = await buildPrompt({
      agentPath: agentEntry.path, skillPaths: [], contextPaths: [], templatePath: null,
      flowContext, artifacts: ctxArtifacts, userFeedback,
    });

    const leadRelease = await pool.acquire('lead');
    watchdog.register(sentinelDir, config.subprocessTimeoutMs);

    try {
      const leadWatcher = new SentinelWatcher();
      await new Promise((resolve, reject) => {
        leadWatcher.on('done', async () => { watchdog.deregister(sentinelDir); leadWatcher.stop(); resolve(); });
        leadWatcher.on('failed', async ({ content }) => {
          watchdog.deregister(sentinelDir);
          leadWatcher.stop();
          reject(new Error(`Step ${stepId} track ${track.slug} lead failed`));
        });
        leadWatcher.poll(sentinelDir, 500);
        runner.spawnSubprocess({ sentinelDir, promptContent: leadPrompt, timeout: config.subprocessTimeoutMs }).catch(reject);
      });
    } finally {
      leadRelease();
    }

    // Phase 2: Review loop
    await markStepStatus(runDir, stepId, 'running_reviews');

    const reviewLoopResult = await runReviewLoop({
      runDir, stepId, trackSlug: track.slug, version: 1,
      reviewers, moderatorId,
      maxRounds,
      buildReviewerPrompt: async (reviewerId, round, priorReviews) => {
        const leadOutput = await fs.readFile(path.join(sentinelDir, 'output.md'), 'utf8').catch(() => '');
        return `Review the following artifact:\n\n${leadOutput}\n\nRound: ${round}`;
      },
      buildModeratorPrompt: async (round, reviews) => {
        return `Assess reviewer convergence for round ${round}. Reviews:\n\n${reviews.map(r => `### ${r.reviewerId}\n${r.content}`).join('\n\n')}`;
      },
      pool,
      subprocessTimeoutMs: config.subprocessTimeoutMs,
    });

    // Phase 3: Store final artifact
    const leadOutput = await fs.readFile(path.join(sentinelDir, 'output.md'), 'utf8').catch(() => '');
    const isSingle = tracks.length === 1;
    const artifactPath = await storeArtifact(runDir, stepId, leadOutput, isSingle ? undefined : track.slug);
    await markTrackDone(runDir, stepId, track.slug, { artifact_path: artifactPath });

    // Phase 4: User feedback (awaiting_user_feedback)
    if (reviewLoopResult.synthesisPath) {
      await markStepStatus(runDir, stepId, 'awaiting_user_feedback');
      await writeUserRequest(runDir, stepId, {
        question: `Review synthesis for step "${stepId}" track "${track.slug}" and provide feedback.`,
        type: 'decisions',
      });
      // In Phase 1b we pause here — user resumes with /agentflow:resume
      await updateRunState(runDir, s => ({ ...s, status: 'paused' }));
      return; // stop execution, user must resume
    }
  }

  await markStepStatus(runDir, stepId, 'done');
}

/**
 * Execute a decide step — presents track selection to user.
 */
async function executeDecideStep(step, runState, registry, runDir, pool, watchdog, config) {
  const { id: stepId } = step;
  const depStepId = (step.depends_on || [])[0];

  if (!depStepId) {
    throw new Error(`Step ${stepId} (decide): must have at least one depends_on step`);
  }

  const allTracks = Object.keys(runState.steps[depStepId]?.tracks || {})
    .filter(slug => runState.steps[depStepId].tracks[slug].status === 'done');

  if (allTracks.length === 0) {
    // Nothing to select, skip
    await markStepStatus(runDir, stepId, 'skipped', { reason: 'no surviving tracks' });
    return;
  }

  // Check if user has already provided selection
  if (await hasUserResponse(runDir, stepId)) {
    const selection = await readTrackSelection(runDir, stepId, allTracks);
    if (selection) {
      // Apply selection — discard the dropped tracks
      for (const slug of selection.discard) {
        await markTrackStatus(runDir, depStepId, slug, 'discarded');
      }
      await markStepStatus(runDir, stepId, 'done', {
        surviving_tracks: selection.keep,
        discarded_tracks: selection.discard,
      });
      return;
    }
  }

  // Pause and ask user for track selection
  await writeTrackSelectionRequest(runDir, stepId, allTracks);
  // Note: writeTrackSelectionRequest already sets status to 'awaiting_track_selection' and pauses run
}

/**
 * Main orchestrator — runs a flow from start to finish.
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
    // Global plugins (~/.claude/plugins/)
    try {
      const entries = await fs.readdir(pluginsDir);
      for (const e of entries) pluginDirs.push(path.join(pluginsDir, e));
    } catch {}
    // Local project agents (agentflow/<team>/ subdirs next to flows/)
    const localAgentflowDir = path.join(path.dirname(flowFile), '..');
    try {
      const entries = await fs.readdir(localAgentflowDir, { withFileTypes: true });
      for (const e of entries) {
        if (e.isDirectory() && !['flows', 'step-templates', 'templates'].includes(e.name)) {
          pluginDirs.push(path.join(localAgentflowDir, e.name));
        }
      }
    } catch {}
    reg = await buildRegistry({ pluginDirs, localTemplatesDir });
  }

  // Initialize run
  const crypto = require('node:crypto');
  const effectiveRunId = runId || `${flowId}-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${crypto.randomBytes(3).toString('hex')}`;
  const runDir = path.join(runsDir, effectiveRunId);

  try {
    await initRun({ runDir, flowId, flowFile, flowInput, steps: resolvedSteps });
  } catch (err) {
    if (!err.message.includes('already exists')) throw err;
    // Resume mode — run already initialized
  }

  // Set up concurrency infrastructure
  const pool = new SubprocessPool({
    maxTotal: mergedConfig.maxTotal, maxLead: mergedConfig.maxLead,
    maxReviewer: mergedConfig.maxReviewer, maxModerator: mergedConfig.maxModerator,
  });
  const watchdog = new Watchdog({ pollIntervalMs: mergedConfig.watchdogPollIntervalMs });
  watchdog.start();

  try {
    const executed = new Set();

    const executeReadySteps = async () => {
      const runState = await readRunState(runDir);
      const pending = resolvedSteps.filter(s =>
        !executed.has(s.id) && runState.steps[s.id]?.status === 'pending'
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
        const currentState = await readRunState(runDir);

        switch (stepType) {
          case 'explore':
            await executeExploreStep(step, currentState, reg, runDir, pool, watchdog, mergedConfig);
            break;
          case 'refine':
            await executeRefineStep(step, currentState, reg, runDir, pool, watchdog, mergedConfig);
            break;
          case 'decide':
            await executeDecideStep(step, currentState, reg, runDir, pool, watchdog, mergedConfig);
            break;
          case 'validate': {
            const reqPath = path.join(runDir, 'steps', step.id, 'user-feedback-request.json');
            await fs.mkdir(path.dirname(reqPath), { recursive: true });
            await fs.writeFile(reqPath, JSON.stringify({ step: step.id, type: 'validate' }, null, 2));
            await markStepStatus(runDir, step.id, 'awaiting_validation');
            await updateRunState(runDir, s => ({ ...s, status: 'paused' }));
            return false;
          }
          default:
            await markStepStatus(runDir, step.id, 'skipped', { reason: `unknown step type '${stepType}'` });
        }

        // Check if we paused
        const afterState = await readRunState(runDir);
        if (afterState.status === 'paused') return false;
      }
      return true;
    };

    let continueLoop = true;
    while (continueLoop) {
      const runState = await readRunState(runDir);
      if (runState.status === 'paused') break;

      const allDone = resolvedSteps.every(s => {
        const st = runState.steps[s.id]?.status;
        return ['done', 'skipped', 'failed'].includes(st);
      });
      if (allDone) break;

      continueLoop = await executeReadySteps();
      if (continueLoop) await new Promise(r => setTimeout(r, 100));
    }

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

    return { runId: effectiveRunId, runDir, runState: await readRunState(runDir) };
  } finally {
    watchdog.stop();
  }
}

module.exports = { runFlow, loadFlow, buildConditionContext, depsResolved };
