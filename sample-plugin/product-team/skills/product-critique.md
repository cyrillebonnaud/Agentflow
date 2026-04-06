# Product Critique

## What
A structured critical review of a product artifact (PRD, roadmap, strategy doc, user story map) that identifies gaps, flawed assumptions, missing metrics, and scope risks before the team invests in execution.

## How
1. Read the artifact once to understand intent, then again to look for problems
2. Evaluate the problem statement:
   - Is the problem real and validated, or assumed?
   - Is the target user specific enough to be actionable?
3. Evaluate success metrics:
   - Is there a primary metric? Is it measurable with current instrumentation?
   - Are there guardrail metrics to prevent gaming the primary metric?
4. Identify scope risks:
   - Features that imply unacknowledged dependencies
   - Anything described as "simple" or "just" that is likely not
   - Non-goals that are missing and will cause arguments later
5. Identify assumption risks: list load-bearing assumptions and rate their validation status
6. Check for stakeholder gaps: who is affected that the document does not mention?
7. Produce a structured finding list, each with: severity (blocking / major / minor), finding, and recommended resolution
