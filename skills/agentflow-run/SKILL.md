---
name: agentflow:run
description: Run an Agentflow flow. Starts a new run for the given flow YAML file with optional input.
argument-hint: <flow-file.yaml> [input text]
allowed-tools: Bash
user-invocable: true
when_to_use: Use when the user wants to run an Agentflow flow, start a multi-agent task, execute a declarative agent pipeline, generate a PRD, UX brief, tech design, or any other artifact defined in a flow YAML file.
---

# Run an Agentflow Flow

Execute a declarative flow defined in a YAML file. This starts the Agentflow orchestrator which spawns Claude agent subprocesses in sequence.

## Usage

```
/agentflow:run <flow-file.yaml> [input text]
```

## Examples

```
/agentflow:run flows/ux-brief.yaml "Mobile onboarding — B2B SaaS, HR managers"
/agentflow:run flows/prd-generator.yaml "AI scheduling tool for distributed teams"
/agentflow:run flows/quick-prototype.yaml "Expense approval flow for mobile"
```

## What happens

1. Loads and validates the flow YAML
2. Initializes a run directory under `runs/<run-id>/`
3. Executes each step in order, respecting `depends_on` and `condition`
4. For `explore` steps: spawns a lead agent, saves output to `artifacts/`
5. Prints run ID and artifact paths when complete

## Steps

Run the flow:

```bash
node "$(npm root -g)/agentflow/src/cli.js" run $ARGUMENTS
```

If not globally installed, try:

```bash
npx agentflow run $ARGUMENTS
```
