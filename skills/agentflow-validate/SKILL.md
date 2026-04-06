---
name: agentflow:validate
description: Validate an Agentflow flow YAML file — checks structure, agent references, template paths, and step configuration.
argument-hint: <flow-file.yaml>
allowed-tools: Bash, Read
user-invocable: true
when_to_use: Use before running a flow to catch missing agent references, invalid template paths, or structural errors in the flow YAML.
---

# Validate an Agentflow Flow

Validates the flow YAML file and reports any errors before execution.

## Usage

```
/agentflow:validate <flow-file.yaml>
```

## What is checked

- Valid YAML syntax
- All steps have `id` and `type` (or `extends`)
- Referenced agents exist in the plugin registry
- Template paths are resolvable
- `depends_on` references are valid step IDs
- `context:` selectors reference real step IDs

## Steps

```bash
npx agentflow validate $ARGUMENTS
```
