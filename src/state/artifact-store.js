'use strict';

const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');

/**
 * Determine the next version number for a step's artifact directory.
 * Scans artifacts/<stepId>/ for existing v1, v2, … folders.
 */
async function nextVersion(runDir, stepId) {
  const stepArtifactsDir = path.join(runDir, 'artifacts', stepId);
  try {
    const entries = await fs.readdir(stepArtifactsDir);
    const versions = entries
      .map(e => /^v(\d+)$/.exec(e))
      .filter(Boolean)
      .map(m => parseInt(m[1], 10));
    return versions.length > 0 ? Math.max(...versions) + 1 : 1;
  } catch {
    return 1;
  }
}

/**
 * Store an artifact for a step under artifacts/<stepId>/v<N>/<stepId>.md
 * Also saves a <stepId>.review.md copy for user editing.
 * @param {string} runDir
 * @param {string} stepId
 * @param {string} content
 * @param {string} [trackSlug]
 * @returns {Promise<string>} relative artifact path
 */
async function storeArtifact(runDir, stepId, content, trackSlug) {
  if (trackSlug) {
    // Multi-track: keep flat layout artifacts/<stepId>/<trackSlug>.md
    const dir = path.join(runDir, 'artifacts', stepId);
    await fs.mkdir(dir, { recursive: true });
    const absPath = path.join(dir, `${trackSlug}.md`);
    await fs.writeFile(absPath, content, 'utf8');
    return `artifacts/${stepId}/${trackSlug}.md`;
  }

  // Single-step versioned layout: artifacts/<stepId>/v<N>/<stepId>.md
  const version = await nextVersion(runDir, stepId);
  const vDir = path.join(runDir, 'artifacts', stepId, `v${version}`);
  await fs.mkdir(vDir, { recursive: true });

  await fs.writeFile(path.join(vDir, `${stepId}.md`), content, 'utf8');
  await fs.writeFile(path.join(vDir, `${stepId}.review.md`), content, 'utf8');

  return `artifacts/${stepId}/v${version}/${stepId}.md`;
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
    // Read latest version: artifacts/<stepId>/v<N>/<stepId>.md
    const version = (await nextVersion(runDir, stepId)) - 1;
    if (version < 1) return null;
    absPath = path.join(runDir, 'artifacts', stepId, `v${version}`, `${stepId}.md`);
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
    if (!entry.isDirectory()) continue;
    const stepId = entry.name;
    const stepDir = path.join(artifactsDir, stepId);
    let stepEntries;
    try {
      stepEntries = await fs.readdir(stepDir, { withFileTypes: true });
    } catch { continue; }

    // Versioned layout: artifacts/<stepId>/v<N>/<stepId>.md
    const versionDirs = stepEntries.filter(e => e.isDirectory() && /^v\d+$/.test(e.name));
    if (versionDirs.length > 0) {
      const latest = versionDirs.sort((a, b) => {
        return parseInt(a.name.slice(1)) - parseInt(b.name.slice(1));
      }).at(-1).name;
      results.push({
        stepId,
        trackSlug: null,
        path: `artifacts/${stepId}/${latest}/${stepId}.md`,
      });
    } else {
      // Multi-track layout: artifacts/<stepId>/<trackSlug>.md
      for (const sub of stepEntries) {
        if (sub.isFile() && sub.name.endsWith('.md') && !sub.name.includes('.review') && !sub.name.includes('_final')) {
          results.push({
            stepId,
            trackSlug: sub.name.slice(0, -3),
            path: `artifacts/${stepId}/${sub.name}`,
          });
        }
      }
    }
  }

  return results;
}

module.exports = { storeArtifact, readArtifact, listArtifacts };
