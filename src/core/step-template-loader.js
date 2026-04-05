'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const yaml = require('js-yaml');

/**
 * Read and parse a YAML step template file.
 *
 * @param {string} templatePath  Absolute path to the YAML file.
 * @returns {Promise<object>}    Parsed plain object.
 */
async function loadStepTemplate(templatePath) {
  let raw;
  try {
    raw = await fs.readFile(templatePath, 'utf8');
  } catch (err) {
    throw new Error(
      `Step template file not found or unreadable: "${templatePath}" (${err.message})`
    );
  }

  const parsed = yaml.load(raw);

  if (parsed === null || parsed === undefined || typeof parsed !== 'object') {
    throw new Error(`Step template did not parse to an object: "${templatePath}"`);
  }

  return parsed;
}

/**
 * Resolve the effective step configuration by merging an optional template.
 *
 * If `flowStep.extends` is set the template is loaded and merged:
 *   - template fields provide defaults
 *   - flowStep fields override (arrays are replaced, not merged)
 *   - the `extends` key is removed from the result
 *
 * If `flowStep.extends` is absent the step is returned as a shallow copy.
 *
 * Template path resolution order (for relative paths):
 *   1. Resolved from `stepTemplatesDir`
 *   2. Resolved from `projectRoot`
 *
 * @param {object} flowStep
 * @param {{ stepTemplatesDir: string, projectRoot: string }} options
 * @returns {Promise<object>}
 */
async function resolveStep(flowStep, { stepTemplatesDir, projectRoot }) {
  if (!flowStep.extends) {
    // Return a copy with no extends key
    return Object.assign({}, flowStep);
  }

  const templateRef = flowStep.extends;

  // Determine the absolute path to the template
  let templatePath;
  if (path.isAbsolute(templateRef)) {
    templatePath = templateRef;
  } else {
    // Try stepTemplatesDir first, then projectRoot
    const candidateA = path.resolve(stepTemplatesDir, templateRef);
    const candidateB = path.resolve(projectRoot, templateRef);

    let foundA = false;
    try {
      await fs.access(candidateA);
      foundA = true;
    } catch (_) {
      // not found in stepTemplatesDir
    }

    if (foundA) {
      templatePath = candidateA;
    } else {
      // Check projectRoot candidate — if it also doesn't exist, loadStepTemplate
      // will throw with a helpful message.
      templatePath = candidateB;
    }
  }

  const template = await loadStepTemplate(templatePath);

  // Merge: template is the base, step fields win. Arrays are replaced (Object.assign semantics).
  const { extends: _removed, ...stepWithoutExtends } = flowStep;
  const merged = Object.assign({}, template, stepWithoutExtends);

  return merged;
}

module.exports = { loadStepTemplate, resolveStep };
