'use strict';

const fs = require('node:fs/promises');

/**
 * Interpolates {{variable.path}} tokens in a template string.
 * Supports dot-notation paths up to 3 levels deep.
 * Unknown variables are left as-is.
 *
 * @param {string} template
 * @param {object} context - flat or nested context object
 * @returns {string}
 */
function interpolateVariables(template, context) {
  return template.replace(/\{\{([^}]+)\}\}/g, (match, path) => {
    const parts = path.trim().split('.');
    let value = context;
    for (const part of parts) {
      if (value == null || typeof value !== 'object') return match;
      value = value[part];
    }
    if (value == null) return match;
    return String(value);
  });
}

/**
 * Reads a file and returns its content, or null if path is falsy.
 */
async function readOptional(filePath) {
  if (!filePath) return null;
  return fs.readFile(filePath, 'utf8');
}

/**
 * Assembles the full prompt for a Claude agent call.
 *
 * Layers (in order):
 *   1. Identity and posture  — agent MD
 *   2. Skills                — skill MD files
 *   3. Business context      — context MD files
 *   4. Flow context          — injected variables + artifacts + user feedback
 *   5. Output structure      — artifact template
 *
 * @param {object} opts
 * @param {string}   opts.agentPath       - path to agent MD file
 * @param {string[]} opts.skillPaths      - paths to skill MD files
 * @param {string[]} opts.contextPaths    - paths to context MD files
 * @param {string|null} opts.templatePath - path to artifact template MD/HTML (or null)
 * @param {object}   opts.flowContext     - { flow, step, track } for variable interpolation
 * @param {object}   opts.artifacts       - { [stepId]: string } prior artifact contents
 * @param {object}   opts.userFeedback    - { [stepId]: { decisions, free } }
 * @returns {Promise<string>} assembled prompt
 */
async function buildPrompt({
  agentPath,
  skillPaths = [],
  contextPaths = [],
  templatePath = null,
  flowContext = {},
  artifacts = {},
  userFeedback = {},
}) {
  const sections = [];

  // 1. Identity and posture
  const agentContent = await readOptional(agentPath);
  if (agentContent) {
    sections.push(`## Identity and posture\n\n${agentContent.trim()}`);
  }

  // 2. Skills
  if (skillPaths.length > 0) {
    const skillContents = await Promise.all(skillPaths.map(p => fs.readFile(p, 'utf8')));
    const skillSection = skillContents
      .map(c => c.trim())
      .join('\n\n---\n\n');
    sections.push(`## Skills\n\n${skillSection}`);
  }

  // 3. Business context
  if (contextPaths.length > 0) {
    const contextContents = await Promise.all(contextPaths.map(p => fs.readFile(p, 'utf8')));
    const contextSection = contextContents
      .map(c => c.trim())
      .join('\n\n---\n\n');
    sections.push(`## Business context\n\n${contextSection}`);
  }

  // 4. Flow context
  const flowLines = [];

  const input = flowContext?.flow?.input;
  if (input) flowLines.push(`**Input:** ${input}`);

  const trackName = flowContext?.track?.name;
  const trackIndex = flowContext?.track?.index;
  const trackTotal = flowContext?.track?.total;
  if (trackName) {
    flowLines.push(`**Track:** ${trackName}${trackIndex != null ? ` (${trackIndex} of ${trackTotal})` : ''}`);
  }

  // Inject artifact contents
  for (const [stepId, content] of Object.entries(artifacts)) {
    if (content) {
      flowLines.push(`\n### Artifact: ${stepId}\n\n${content.trim()}`);
    }
  }

  // Inject user feedback
  for (const [stepId, feedback] of Object.entries(userFeedback)) {
    if (feedback?.decisions) {
      flowLines.push(`\n### User decisions — ${stepId}\n\n${feedback.decisions.trim()}`);
    }
    if (feedback?.free) {
      flowLines.push(`\n### User feedback — ${stepId}\n\n${feedback.free.trim()}`);
    }
  }

  if (flowLines.length > 0) {
    sections.push(`## Flow context\n\n${flowLines.join('\n')}`);
  }

  // 5. Output structure
  const templateContent = await readOptional(templatePath);
  if (templateContent) {
    sections.push(`## Output structure\n\n${templateContent.trim()}`);
  }

  const assembled = sections.join('\n\n---\n\n');

  // Interpolate variables throughout the assembled prompt
  const interp = { ...flowContext };
  return interpolateVariables(assembled, interp);
}

module.exports = { buildPrompt, interpolateVariables };
