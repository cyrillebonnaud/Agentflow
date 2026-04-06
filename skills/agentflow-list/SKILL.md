---
name: agentflow:list
description: List all available Agentflow flow templates in the current project.
argument-hint: ""
allowed-tools: Bash
user-invocable: true
when_to_use: Use when the user wants to see what flows are available, discover templates, or pick a flow to run.
---

# List Agentflow Flow Templates

Lists all `.yaml` flow files found in the `flows/` directory, with their name and description.

## Usage

```
/agentflow:list
```

## Steps

```bash
npx agentflow list
```
