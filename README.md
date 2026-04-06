# Agentflow

**Local-first declarative multi-agent orchestration for Claude Code**

Agentflow is a lightweight meta-framework that turns YAML flow definitions into coordinated Claude subprocesses — each running as an independent agent with its own identity, skills, and business context. Artifacts accumulate across steps; review loops converge by consensus; parallel tracks let Claude explore multiple directions before committing to one.

Everything is a file. No cloud dependency. No new auth to manage — subprocesses inherit the parent Claude Code session.

---

## Table of Contents

- [Installation](#installation)
- [Quick start](#quick-start)
- [Core concepts](#core-concepts)
- [Flow YAML reference](#flow-yaml-reference)
- [Step types](#step-types)
- [Step templates](#step-templates)
- [Authoring a plugin](#authoring-a-plugin)
- [CLI reference](#cli-reference)
- [Programmatic API](#programmatic-api)

---

## Installation

From GitHub (no npm account needed):

```bash
npm install github:cyrillebonnaud/agentflow
npx agentflow install
```

Or as a global install (once npm is published):

```bash
npm install -g agentflow
agentflow install
```

`agentflow install` copies the slash commands into `.claude/skills/` so Claude Code picks them up automatically.

Node ≥ 18 required.

---

## Quick start

```bash
# 1. Scaffold a new project
agentflow init

# 2. Run a built-in sample flow
agentflow run flows/quick-prototype.yaml "Build a habit-tracker app"

# 3. Check status mid-run
agentflow status <run-id>

# 4. Resume a crashed run
agentflow resume <run-id>
```

---

## Core concepts

### Everything is a file

| Concern | File type | Location |
|---|---|---|
| Agent identity | Markdown (`agent.md`) | `~/.claude/plugins/<plugin>/agents/` |
| Skills | Markdown (`skill.md`) | `~/.claude/plugins/<plugin>/skills/` |
| Business context | Markdown (`context.md`) | `~/.claude/plugins/<plugin>/context/` |
| Artifact templates | Markdown (`template.md`) | `templates/` |
| Step templates | YAML | `step-templates/` |
| Flow definitions | YAML | `flows/` |
| Run state | JSON | `runs/<run-id>/run.json` |
| Artifacts | Markdown | `runs/<run-id>/artifacts/` |

### Subprocess model

Each step spawns one or more Claude subprocesses via `claude -p "<prompt>" --output-format json`. Subprocesses signal completion by writing `.done` or `.failed` sentinel files — no IPC, no shared memory. The orchestrator polls these files and advances the run graph.

### Plugin convention

A plugin is a directory of Markdown files. Agents reference skills by name; the orchestrator resolves them at runtime via a registry built from configured plugin directories. Plugins have zero dependency on Agentflow.

```
my-plugin/
  agents/
    product-manager.md    # frontmatter: skills: [prd-writing]
    product-critic.md
  skills/
    prd-writing.md        # ## What / ## How
  context/
    product-vision.md
```

### 4-layer prompt assembly

Every subprocess prompt is assembled in order:

1. **Identity** — the agent's `agent.md` (who I am, how I work)
2. **Skills** — each referenced `skill.md` (what I know how to do)
3. **Business context** — selected `context.md` files (domain knowledge)
4. **Flow context** — step instructions, artifacts from prior steps, user feedback

### Sentinel pattern

Subprocesses write `.pid` on start, then `.done` or `.failed` on exit. The watchdog monitors for stale PIDs (process died without writing sentinel). On `agentflow resume`, `run-reconciler` replays all sentinel files to restore in-flight state.

### Write queue

All mutations to `run.json` are serialized through a per-run `WriteQueue` — a FIFO async queue that eliminates write contention when parallel tracks complete simultaneously.

---

## Flow YAML reference

```yaml
id: my-flow
name: My Flow
description: What this flow produces

steps:
  - id: research
    type: explore              # explore | refine | decide | validate
    agent: product-team/market-researcher
    skills:
      - product-team/market-sizing
      - product-team/competitive-analysis
    context:
      - product-team/product-vision
    template: templates/research.md
    artifact: research-output.md
    depends_on: []

  - id: write-prd
    type: refine
    agent: product-team/product-manager
    skills:
      - product-team/prd-writing
    context:
      - product-team/product-vision
      - product-team/target-personas
    template: templates/prd.md
    artifact: prd.md
    depends_on: [research]
    reviewers:
      - agent: product-team/product-critic
        skill: product-team/product-critique
    max_rounds: 3

  - id: select-direction
    type: decide
    depends_on: [write-prd]
    tracks:
      - id: conservative
      - id: ambitious

  - id: approve
    type: validate
    depends_on: [select-direction]
    question: "Does the PRD meet the bar for engineering handoff?"
    options: [yes, no, needs-revision]

  - id: conditional-step
    type: explore
    depends_on: [approve]
    condition: "approve.response == 'needs-revision'"
    agent: product-team/product-manager
    artifact: revision.md
```

### Top-level fields

| Field | Required | Description |
|---|---|---|
| `id` | yes | Unique flow identifier |
| `name` | yes | Human-readable name |
| `description` | no | Shown in `agentflow status` |
| `steps` | yes | Ordered list of step definitions |

### Step fields

| Field | Type | Description |
|---|---|---|
| `id` | string | Unique within flow |
| `type` | string | `explore`, `refine`, `decide`, `validate` |
| `agent` | string | `plugin/agent-name` or plain `agent-name` |
| `skills` | string[] | Additional skills to inject |
| `context` | string[] | Context files to inject; supports `{{track}}` |
| `template` | string | Artifact template path |
| `artifact` | string | Output filename in `artifacts/` |
| `depends_on` | string[] | Step IDs that must complete first |
| `condition` | string | Boolean expression; step skipped if false |
| `extends` | string | Step template to inherit from |
| `reviewers` | object[] | `refine` only — reviewer agent + skill |
| `max_rounds` | number | `refine` only — convergence limit (default 3) |
| `tracks` | object[] | `decide` only — parallel track definitions |
| `question` | string | `validate` only — question shown to user |
| `options` | string[] | `validate` only — allowed responses |

### Condition expressions

Conditions reference step outputs via dot-path syntax:

```yaml
condition: "research.status == 'done'"
condition: "score > 7"
condition: "tags contains 'urgent' and priority == 'high'"
condition: "a == 1 or b == 2"
```

Operators: `==`, `>`, `>=`, `<`, `<=`, `contains`, `and`, `or`

---

## Step types

### `explore`

A single lead agent produces an artifact. No review loop.

```yaml
type: explore
agent: market-researcher
artifact: market-research.md
```

### `refine`

Lead agent drafts; reviewers critique in rounds until convergence or `max_rounds` is reached. A moderator assesses convergence after each round.

```yaml
type: refine
agent: product-manager
reviewers:
  - agent: product-critic
    skill: product-critique
max_rounds: 3
artifact: prd.md
```

### `decide`

Spawns parallel tracks (one lead per track). A `track-selector` agent picks the winning track; discarded tracks are tombstoned in `run.json`.

```yaml
type: decide
tracks:
  - id: approach-a
  - id: approach-b
  - id: approach-c
```

### `validate`

Pauses the run and writes a request file. The user responds via the `agentflow:resume` skill or `agentflow resume` CLI. The response is recorded in `run.json` and available to downstream conditions.

```yaml
type: validate
question: "Is the research sufficient to proceed?"
options: [yes, no, redo]
```

---

## Step templates

Step templates live in `step-templates/` and define reusable step configurations. A flow step uses `extends: template-name` to inherit fields; step-level fields override template fields.

```yaml
# step-templates/standard-refine.yaml
type: refine
max_rounds: 3
reviewers:
  - agent: product-team/product-critic
    skill: product-team/product-critique
```

```yaml
# In a flow step
- id: write-prd
  extends: standard-refine
  agent: product-team/product-manager
  artifact: prd.md
  # max_rounds and reviewers inherited from template
```

Built-in templates: `explore`, `light-refine`, `standard-refine`, `design-refine`.

---

## Authoring a plugin

### 1. Scaffold

```bash
# Copy the starter template
cp -r $(npm root -g)/agentflow/plugin-starter my-plugin
```

Or use `agentflow init` to scaffold a new project with a sample plugin.

### 2. Define agents

```markdown
---
skills:
  - my-plugin/research
  - my-plugin/competitive-analysis
---

# Market Researcher

I am a rigorous market researcher specializing in B2B SaaS.

## My approach

I always...
- Ground claims in verifiable market data
- Separate signal from noise
- Quantify market size with a bottom-up and top-down model
- Flag assumptions explicitly
- Deliver actionable conclusions
```

### 3. Define skills

```markdown
# Competitive Analysis

## What
Structured evaluation of competitor positioning, features, and pricing.

## How

1. Identify the top 5 competitors by market share or mindshare
2. For each: document positioning, key features, pricing model, weaknesses
3. Map the competitive landscape on 2 axes (e.g. price vs. capability)
4. Identify white space and differentiation opportunities
5. Summarize findings in a table
```

### 4. Define context

Any Markdown file. Referenced in flow steps via `context:` selector. Supports `{{track}}` substitution for multi-track steps.

```markdown
# Product Vision

We are building a B2B habit-tracking platform for remote teams...
```

### 5. Install

```bash
agentflow install --plugin ./my-plugin --name my-plugin
```

This copies files to `~/.claude/plugins/my-plugin/` and registers the plugin in the Agentflow config.

### Plugin conventions

- Agent files: one per agent, YAML frontmatter with `skills:` array
- Skill files: `## What` + `## How` sections with numbered steps
- Context files: plain Markdown, no required structure
- No runtime dependency on Agentflow — pure Markdown

---

## CLI reference

```
agentflow <command> [options]
```

| Command | Description |
|---|---|
| `run <flow.yaml> [input]` | Start a new flow run |
| `status <run-id>` | Show run state and step statuses |
| `resume <run-id>` | Resume a paused or crashed run |
| `validate <flow.yaml>` | Validate flow YAML without running |
| `init` | Scaffold a new Agentflow project |
| `install [--plugin <dir>] [--name <n>]` | Register a plugin with Claude Code |

### `agentflow run`

```bash
agentflow run flows/prd-generator.yaml "Build a habit tracker for remote teams"
```

Outputs run ID, step-by-step progress, and artifact location on completion.

### `agentflow status`

```bash
agentflow status run-prd-generator-20260401-143022
```

Shows each step's status (`pending`, `running`, `done`, `failed`, `skipped`) and artifact paths.

### `agentflow resume`

```bash
agentflow resume run-prd-generator-20260401-143022
```

Replays sentinel files to recover in-flight state, then continues from the last checkpoint. Also used to respond to `validate` steps.

### Claude Code skills

After `agentflow install`, the following skills are available inside Claude Code:

- `/agentflow:run` — start a flow
- `/agentflow:status` — check run status
- `/agentflow:resume` — resume / respond to validate step
- `/agentflow:validate` — validate a flow file

---

## Programmatic API

```js
const { runFlow, buildRegistry, readRunState } = require('agentflow');

// Run a flow programmatically
const { runId, runDir, runState } = await runFlow({
  flowFile: './flows/prd-generator.yaml',
  flowInput: 'Build a habit tracker',
  runsDir: './runs',
  pluginDirs: ['~/.claude/plugins/product-team'],
});

// Read run state
const state = await readRunState(runDir);
console.log(state.status); // 'done' | 'failed' | 'paused' | 'running'

// Build registry manually
const registry = await buildRegistry({
  pluginDirs: ['~/.claude/plugins/my-plugin'],
  localTemplatesDir: './templates',
});
```

---

## Run file structure

```
runs/
  run-prd-generator-20260401-143022/
    run.json                  ← live state (WriteQueue-serialized)
    steps/
      research/
        v1/
          prompt.md           ← assembled prompt
          output.md           ← subprocess output
          .pid                ← subprocess PID
          .done               ← sentinel: success
      write-prd/
        v1/
          prompt.md
          output.md
          .done
        review-round-1/
          reviewer-product-critic/
            prompt.md
            output.md
            .done
          moderator/
            prompt.md
            output.md
            .done
    artifacts/
      research-output.md
      prd.md
    user-requests/
      approve-request.md      ← written by validate step
      approve-response.md     ← written by user / agentflow resume
```

---

## License

MIT
