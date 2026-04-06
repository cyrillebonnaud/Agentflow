'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

/**
 * Store an artifact for a step (optionally under a track).
 * @param {string} runDir
 * @param {string} stepId
 * @param {string} content
 * @param {string} [trackSlug]
 * @returns {Promise<string>} relative artifact path
 */
async function storeArtifact(runDir, stepId, content, trackSlug) {
  let relPath;
  let absPath;

  if (trackSlug) {
    relPath = `artifacts/${stepId}/${trackSlug}.md`;
    absPath = path.join(runDir, 'artifacts', stepId, `${trackSlug}.md`);
    await fs.mkdir(path.join(runDir, 'artifacts', stepId), { recursive: true });
    await fs.writeFile(absPath, content, 'utf8');
  } else {
    relPath = `artifacts/${stepId}.md`;
    absPath = path.join(runDir, 'artifacts', `${stepId}.md`);
    await fs.writeFile(absPath, content, 'utf8');
    // Save editable copy for user review
    await fs.writeFile(path.join(runDir, 'artifacts', `${stepId}.review.md`), content, 'utf8');
  }

  return relPath;
}

/**
 * Read an artifact for a step (optionally a specific track).
 * @param {string} runDir
 * @param {string} stepId
 * @param {string} [trackSlug]
 * @returns {Promise<string|null>}
 */
async function readArtifact(runDir, stepId, trackSlug) {
  let absPath;

  if (trackSlug) {
    absPath = path.join(runDir, 'artifacts', stepId, `${trackSlug}.md`);
  } else {
    absPath = path.join(runDir, 'artifacts', `${stepId}.md`);
  }

  try {
    return await fs.readFile(absPath, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

/**
 * List all artifacts in the run's artifacts directory.
 * @param {string} runDir
 * @returns {Promise<Array<{ stepId: string, trackSlug: string|null, path: string }>>}
 */
async function listArtifacts(runDir) {
  const artifactsDir = path.join(runDir, 'artifacts');
  const results = [];

  let entries;
  try {
    entries = await fs.readdir(artifactsDir, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }

  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith('.md')) {
      // Direct file: artifacts/<stepId>.md
      const stepId = entry.name.slice(0, -3); // strip .md
      results.push({
        stepId,
        trackSlug: null,
        path: `artifacts/${entry.name}`,
      });
    } else if (entry.isDirectory()) {
      // Subdirectory: artifacts/<stepId>/<trackSlug>.md
      const stepId = entry.name;
      let subEntries;
      try {
        subEntries = await fs.readdir(path.join(artifactsDir, entry.name), { withFileTypes: true });
      } catch {
        continue;
      }
      for (const sub of subEntries) {
        if (sub.isFile() && sub.name.endsWith('.md')) {
          const trackSlug = sub.name.slice(0, -3);
          results.push({
            stepId,
            trackSlug,
            path: `artifacts/${stepId}/${sub.name}`,
          });
        }
      }
    }
  }

  return results;
}

module.exports = { storeArtifact, readArtifact, listArtifacts };
