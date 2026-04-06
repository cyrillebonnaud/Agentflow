---
name: agentflow:resume
description: Resume a paused or crashed Agentflow run from where it left off.
argument-hint: <run-id>
allowed-tools: Bash
user-invocable: true
when_to_use: Use when an Agentflow run was interrupted (crash, timeout, validate pause) and needs to continue. Reconciles sentinel files against run.json state before resuming.
---

# Resume an Agentflow Run

Reconciles `.done`/`.failed` sentinel files against `run.json` state, then continues the flow from the last consistent checkpoint.

## Usage

```
/agentflow:resume <run-id>
```

## When to use

- After an orchestrator crash
- After a `validate` step where the user has written their feedback to `user-feedback.md`
- After fixing a failed step manually

## Steps

```bash
npx agentflow resume $ARGUMENTS
```
