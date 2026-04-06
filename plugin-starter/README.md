# Agentflow Plugin Starter

A minimal starter template for creating an Agentflow plugin — a set of business agents distributed as a Claude Code plugin.

## Quick start

```bash
# Copy this directory to your business team's repo
cp -r plugin-starter/ my-team-plugin/
cd my-team-plugin/

# Register as a Claude Code plugin (for development)
claude --plugin-dir .

# Validate your agents and flows
agentflow validate
```

## Convention

An Agentflow plugin is any directory that follows this structure:

```
my-plugin/
├── agents/       ← MD files defining each agent's role and posture
├── skills/       ← MD files defining reusable capabilities
├── context/      ← Business context injected into all agents
└── templates/    ← Artifact templates owned by this team (optional)
```

**Zero dependency on Agentflow** — these are plain Markdown files. The Agentflow orchestrator discovers them via the registry at runtime.

## Plugin structure

### Agent MD (`agents/<id>.md`)

```markdown
---
skills:
  - skill-name-one
  - skill-name-two
---
# Agent Name

Identity and posture in 3-5 sentences. What this agent knows, how it thinks, what it always does.

I always:
- [Working principle 1]
- [Working principle 2]
- [Working principle 3]
```

The frontmatter `skills:` list references files in your `skills/` directory (without `.md`).

### Skill MD (`skills/<id>.md`)

```markdown
# Skill Name

## What
One paragraph — what this capability is and when to apply it.

## How
1. Step one
2. Step two
3. Step three
```

### Context MD (`context/<id>.md`)

Free-form Markdown. Injected into all agents in this plugin. Keep it factual and concise — business context, not instructions.

### Template MD (`templates/<id>.md`)

Pure structure — section names and what each section contains. No instructions, no context, no prompts. The agent fills it in.

## Installing your plugin

```bash
# Register for local development
agentflow install --plugin-dir /path/to/my-plugin

# Or point Claude Code directly
claude --plugin-dir /path/to/my-plugin
```

After installation, your agents are available in any Agentflow flow YAML by their `id` (filename without `.md`).

## Referencing your agents in flows

```yaml
steps:
  - id: analysis
    type: explore
    lead: my-agent-id          # matches agents/my-agent-id.md
    artifacts:
      - name: analysis.md
        template: my-plugin/my-template.md  # namespaced reference
```

## Updating context

Business context files are the main thing you'll update over time:

```bash
# Pull latest context into your plugin
agentflow plugin update my-plugin

# Or just edit the files directly — they're plain Markdown
```

## Plugin anatomy checklist

- [ ] `agents/` — at least one agent MD with frontmatter `skills:`
- [ ] `skills/` — one MD per skill referenced in agent frontmatter  
- [ ] `context/` — business context your agents need (product, design system, ICP, etc.)
- [ ] `templates/` — artifact templates if your team owns the output structure
- [ ] No references to Agentflow internals — pure Markdown, zero coupling

## Examples

See `sample-plugin/` in the Agentflow repo for a complete example with product, design, and engineering teams.
