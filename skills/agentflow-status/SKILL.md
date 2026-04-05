---
name: agentflow:status
description: Show the current status of an Agentflow run, including per-step status and artifact paths.
argument-hint: [run-id]
allowed-tools: Bash, Read
user-invocable: true
when_to_use: Use when the user wants to check the progress of a running or completed Agentflow flow, see which steps are done, or find artifact file paths.
---

# Show Agentflow Run Status

Displays the current state of a run: step statuses, artifact locations, and overall run status.

## Usage

```
/agentflow:status              — list recent runs
/agentflow:status <run-id>     — show detail for a specific run
```

## Steps

```bash
node "$(npm root -g)/agentflow/src/cli.js" status $ARGUMENTS
```

If not globally installed:

```bash
npx agentflow status $ARGUMENTS
```
