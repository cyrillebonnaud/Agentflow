#!/usr/bin/env node
'use strict';

/**
 * Agentflow CLI
 *
 * Commands:
 *   agentflow run <flow-file> [input...]   — Run a flow
 *   agentflow status <run-id>              — Show run state
 *   agentflow resume <run-id>              — Resume a crashed run
 *   agentflow validate <flow-file>         — Validate flow YAML
 *   agentflow init                         — Scaffold project
 *   agentflow install                      — Register Claude Code plugin
 */

const path = require('node:path');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');

const [, , command, ...args] = process.argv;

async function main() {
  switch (command) {
    case 'run':    return cmdRun(args);
    case 'status': return cmdStatus(args);
    case 'resume': return cmdResume(args);
    case 'validate': return cmdValidate(args);
    case 'init':   return cmdInit(args);
    case 'install': return cmdInstall(args);
    default:
      console.error(`Unknown command: ${command || '(none)'}`);
      printHelp();
      process.exit(1);
  }
}

// ─── run ────────────────────────────────────────────────────────────────────

async function cmdRun([flowFile, ...inputParts]) {
  if (!flowFile) {
    console.error('Usage: agentflow run <flow-file.yaml> [input...]');
    process.exit(1);
  }

  const flowInput = inputParts.join(' ');
  const resolvedFlow = path.resolve(process.cwd(), flowFile);
  const runsDir = path.resolve(process.cwd(), 'runs');

  try {
    await fs.access(resolvedFlow);
  } catch {
    console.error(`Flow file not found: ${resolvedFlow}`);
    process.exit(1);
  }

  console.log(`Starting flow: ${resolvedFlow}`);
  console.log(`Input: ${flowInput || '(none)'}`);

  const { runFlow } = require('./core/orchestrator');

  try {
    const { runId, runDir, runState } = await runFlow({
      flowFile: resolvedFlow,
      flowInput,
      runsDir,
    });

    console.log(`\nRun completed: ${runId}`);
    console.log(`Status: ${runState.status}`);

    for (const [stepId, step] of Object.entries(runState.steps)) {
      const icon = step.status === 'done' ? '✓' : step.status === 'skipped' ? '→' : step.status === 'failed' ? '✗' : '?';
      console.log(`  ${icon} ${stepId}: ${step.status}`);
    }

    // Print artifact contents inline so they're visible in the conversation
    const artifactsDir = path.join(runDir, 'artifacts');
    try {
      await printArtifactsInline(artifactsDir);
    } catch {
      console.log(`\nArtifacts saved to: ${artifactsDir}`);
    }
  } catch (err) {
    console.error(`\nFlow failed: ${err.message}`);
    process.exit(1);
  }
}

// ─── artifact printer ───────────────────────────────────────────────────────

async function printArtifactsInline(dir, indent = '') {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const sorted = entries.sort((a, b) => {
    // Files before directories, then alphabetical
    if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? 1 : -1;
    return a.name.localeCompare(b.name);
  });
  for (const entry of sorted) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await printArtifactsInline(full, indent + '  ');
    } else {
      const content = await fs.readFile(full, 'utf8');
      console.log(`\n${'─'.repeat(60)}`);
      console.log(`${indent}${entry.name}`);
      console.log('─'.repeat(60));
      console.log(content.trim());
    }
  }
}

// ─── status ─────────────────────────────────────────────────────────────────

async function cmdStatus([runId]) {
  if (!runId) {
    // List recent runs
    const runsDir = path.resolve(process.cwd(), 'runs');
    try {
      const entries = await fs.readdir(runsDir);
      if (entries.length === 0) {
        console.log('No runs found.');
        return;
      }
      console.log('Recent runs:');
      for (const e of entries.filter(e => e !== '.gitkeep').slice(-10)) {
        console.log(`  ${e}`);
      }
    } catch {
      console.log('No runs directory found. Run a flow first.');
    }
    return;
  }

  const runsDir = path.resolve(process.cwd(), 'runs');
  const runDir = path.join(runsDir, runId);
  const runJsonPath = path.join(runDir, 'run.json');

  let state;
  try {
    const raw = await fs.readFile(runJsonPath, 'utf8');
    state = JSON.parse(raw);
  } catch {
    console.error(`Run not found: ${runId}`);
    process.exit(1);
  }

  console.log(`\nRun: ${state.run_id}`);
  console.log(`Flow: ${state.flow_id}`);
  console.log(`Status: ${state.status}`);
  console.log(`Input: ${state.flow_input}`);
  console.log(`\nSteps:`);
  for (const [stepId, step] of Object.entries(state.steps)) {
    const icon = step.status === 'done' ? '✓' : step.status === 'skipped' ? '→' : step.status === 'failed' ? '✗' : '⋯';
    console.log(`  ${icon} ${stepId} [${step.type}]: ${step.status}`);
    if (step.artifact_path) console.log(`      artifact: ${step.artifact_path}`);
  }
}

// ─── resume ──────────────────────────────────────────────────────────────────

async function cmdResume([runId]) {
  if (!runId) {
    console.error('Usage: agentflow resume <run-id>');
    process.exit(1);
  }

  const runsDir = path.resolve(process.cwd(), 'runs');
  const runDir = path.join(runsDir, runId);
  const runJsonPath = path.join(runDir, 'run.json');

  let state;
  try {
    const raw = await fs.readFile(runJsonPath, 'utf8');
    state = JSON.parse(raw);
  } catch {
    console.error(`Run not found: ${runId}`);
    process.exit(1);
  }

  console.log(`Resuming run: ${runId}`);

  const { runFlow } = require('./core/orchestrator');

  try {
    const result = await runFlow({
      flowFile: state.flow_file,
      flowInput: state.flow_input,
      runsDir,
      runId,
    });
    console.log(`Resumed and completed: ${result.runState.status}`);
  } catch (err) {
    console.error(`Resume failed: ${err.message}`);
    process.exit(1);
  }
}

// ─── validate ────────────────────────────────────────────────────────────────

async function cmdValidate([flowFile]) {
  if (!flowFile) {
    console.error('Usage: agentflow validate <flow-file.yaml>');
    process.exit(1);
  }

  const resolvedFlow = path.resolve(process.cwd(), flowFile);
  const yaml = require('js-yaml');

  try {
    const content = await fs.readFile(resolvedFlow, 'utf8');
    const flow = yaml.load(content);
    const steps = flow.flow?.steps || flow.steps || [];
    console.log(`✓ YAML valid — ${steps.length} steps defined`);

    // Basic structural validation
    let errors = 0;
    for (const step of steps) {
      if (!step.id) { console.error(`  ✗ Step missing 'id'`); errors++; }
      if (!step.type && !step.extends) { console.error(`  ✗ Step '${step.id}': missing 'type' or 'extends'`); errors++; }
    }

    if (errors === 0) {
      console.log(`✓ All ${steps.length} steps valid`);
    } else {
      console.error(`\n${errors} error(s) found`);
      process.exit(1);
    }
  } catch (err) {
    console.error(`✗ ${err.message}`);
    process.exit(1);
  }
}

// ─── init ────────────────────────────────────────────────────────────────────

async function cmdInit([]) {
  const dirs = ['flows', 'step-templates', 'templates', 'runs'];
  for (const d of dirs) {
    await fs.mkdir(path.resolve(process.cwd(), d), { recursive: true });
    console.log(`✓ Created ${d}/`);
  }

  const configPath = path.resolve(process.cwd(), 'agentflow.config.yaml');
  if (!fsSync.existsSync(configPath)) {
    const yaml = require('js-yaml');
    const config = {
      version: 1,
      defaults: { mode: 'assisted', max_iterations: 3, max_rounds: 2 },
      plugins_path: '~/.claude/plugins',
      concurrency: {
        max_subprocesses: 8,
        max_lead_parallel: 4,
        max_reviewer_parallel: 6,
        max_moderator_parallel: 4,
      },
      paths: { flows: './flows', step_templates: './step-templates', templates: './templates', runs: './runs' },
    };
    await fs.writeFile(configPath, yaml.dump(config), 'utf8');
    console.log(`✓ Created agentflow.config.yaml`);
  }

  const gitignorePath = path.resolve(process.cwd(), '.gitignore');
  const gitignoreEntry = '\n# Agentflow runs\nruns/*/\n!runs/.gitkeep\n';
  try {
    const existing = await fs.readFile(gitignorePath, 'utf8');
    if (!existing.includes('Agentflow runs')) {
      await fs.appendFile(gitignorePath, gitignoreEntry);
      console.log(`✓ Updated .gitignore`);
    }
  } catch {
    await fs.writeFile(gitignorePath, gitignoreEntry.trimStart());
    console.log(`✓ Created .gitignore`);
  }

  console.log('\n✓ Project initialized. Add flow YAML files to flows/');
}

// ─── install ─────────────────────────────────────────────────────────────────

async function cmdInstall() {
  // Copy skills from this package into .claude/skills/ in the current project.
  // Claude Code discovers skills from .claude/skills/<name>/SKILL.md — same
  // mechanism used by OpenSpec and other Claude Code plugins.
  const packageSkillsDir = path.resolve(__dirname, '..', 'skills');
  const projectSkillsDir = path.resolve(process.cwd(), '.claude', 'skills');

  await fs.mkdir(projectSkillsDir, { recursive: true });

  const skillDirs = await fs.readdir(packageSkillsDir);
  let installed = 0;

  for (const skillName of skillDirs) {
    const src = path.join(packageSkillsDir, skillName, 'SKILL.md');
    const destDir = path.join(projectSkillsDir, skillName);
    const dest = path.join(destDir, 'SKILL.md');

    try {
      await fs.access(src);
    } catch {
      continue; // skip entries without SKILL.md
    }

    await fs.mkdir(destDir, { recursive: true });
    await fs.copyFile(src, dest);
    console.log(`✓ Installed skill: ${skillName}`);
    installed++;
  }

  if (installed === 0) {
    console.error('No skills found to install.');
    process.exit(1);
  }

  console.log(`\n✓ ${installed} skill(s) installed to .claude/skills/`);
  console.log(`  Skills are now available as slash commands in Claude Code.`);
}

// ─── help ────────────────────────────────────────────────────────────────────

function printHelp() {
  console.log(`
Agentflow — declarative multi-agent orchestration

Commands:
  agentflow run <flow.yaml> [input]   Run a flow
  agentflow status [run-id]           Show run status
  agentflow resume <run-id>           Resume a paused/crashed run
  agentflow validate <flow.yaml>      Validate flow YAML
  agentflow init                      Initialize project
  agentflow install                   Register Claude Code plugin
`);
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
