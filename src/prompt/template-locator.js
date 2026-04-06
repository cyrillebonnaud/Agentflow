'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { resolveTemplate } = require('../registry/resolver');

/**
 * Resolves an artifact template path with priority:
 *   1. Absolute path → use as-is if accessible
 *   2. localTemplatesDir/<basename>
 *   3. registry.templates via resolveTemplate()
 *   4. null if not found
 *
 * @param {string|null} templateRef - e.g. "prd.md", "design-team/ux-brief.md", or null
 * @param {{ localTemplatesDir: string, registry: object }} opts
 * @returns {Promise<string|null>} Absolute path or null
 */
async function locateTemplate(templateRef, { localTemplatesDir, registry }) {
  if (!templateRef) return null;

  // 1. Absolute path — use as-is if accessible
  if (path.isAbsolute(templateRef)) {
    try {
      await fs.access(templateRef);
      return templateRef;
    } catch {
      return null;
    }
  }

  // 2. Check localTemplatesDir/<basename>
  if (localTemplatesDir) {
    const basename = path.basename(templateRef);
    const localPath = path.join(localTemplatesDir, basename);
    try {
      await fs.access(localPath);
      return localPath;
    } catch {
      // not found locally, fall through
    }
  }

  // 3. Check registry.templates via resolveTemplate()
  if (registry) {
    const entry = await resolveTemplate(registry, templateRef);
    if (entry) return entry.path;
  }

  // 4. Not found
  return null;
}

module.exports = { locateTemplate };
