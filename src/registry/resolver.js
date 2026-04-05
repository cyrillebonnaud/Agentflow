'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

/**
 * Scan a directory for files matching the given extensions.
 * Returns an array of absolute file paths, or [] if the dir doesn't exist.
 *
 * @param {string}   dir
 * @param {string[]} extensions - e.g. ['.md', '.html']
 * @returns {Promise<string[]>}
 */
async function scanDir(dir, extensions) {
  let entries;
  try {
    entries = await fs.readdir(dir);
  } catch {
    return [];
  }
  return entries
    .filter((name) => extensions.includes(path.extname(name).toLowerCase()))
    .map((name) => path.join(dir, name));
}

/**
 * Populate a Map with entries discovered in a directory.
 * Stores entries under two keys:
 *   - Plain id (first-match-wins, so subsequent plugins don't overwrite)
 *   - Namespaced "pluginName/id" (always stored, enables explicit plugin targeting)
 *
 * @param {Map}      map
 * @param {string}   scanDir_    - Absolute directory to scan (already includes subdir)
 * @param {string}   pluginName  - Human-readable plugin identifier
 * @param {string[]} extensions
 */
async function populateMapFromDir(map, scanDir_, pluginName, extensions) {
  const files = await scanDir(scanDir_, extensions);
  for (const filePath of files) {
    const id = path.basename(filePath, path.extname(filePath));
    const entry = { path: filePath, plugin: pluginName };
    // Always store namespaced key so callers can do "pluginName/id" lookups
    map.set(`${pluginName}/${id}`, entry);
    // Plain key: first-match-wins
    if (!map.has(id)) {
      map.set(id, entry);
    }
  }
}

/**
 * Build an in-memory registry by scanning plugin directories.
 *
 * Priority: localTemplatesDir (highest) > pluginDirs[0] > pluginDirs[1] > …
 *
 * @param {object}   opts
 * @param {string[]} opts.pluginDirs        - Plugin root directories to scan
 * @param {string|null} opts.localTemplatesDir - Local templates dir (overrides plugins)
 * @returns {Promise<{
 *   agents:    Map<string, { path: string, plugin: string }>,
 *   skills:    Map<string, { path: string, plugin: string }>,
 *   context:   Map<string, { path: string, plugin: string }>,
 *   templates: Map<string, { path: string, plugin: string }>,
 * }>}
 */
async function buildRegistry({ pluginDirs, localTemplatesDir }) {
  const agents = new Map();
  const skills = new Map();
  const context = new Map();
  const templates = new Map();

  // Local templates have highest priority — register them first
  if (localTemplatesDir) {
    await populateMapFromDir(templates, localTemplatesDir, 'local', ['.md', '.html']);
  }

  // Scan each plugin directory in order (first plugin wins for duplicate plain ids)
  for (const pluginDir of pluginDirs) {
    const pluginName = path.basename(pluginDir);

    await populateMapFromDir(agents, path.join(pluginDir, 'agents'), pluginName, ['.md']);
    await populateMapFromDir(skills, path.join(pluginDir, 'skills'), pluginName, ['.md']);
    await populateMapFromDir(context, path.join(pluginDir, 'context'), pluginName, ['.md']);
    await populateMapFromDir(templates, path.join(pluginDir, 'templates'), pluginName, ['.md', '.html']);
  }

  return { agents, skills, context, templates };
}

/**
 * Look up an agent by id, throwing a descriptive error if not found.
 *
 * @param {{ agents: Map }} registry
 * @param {string} agentId
 * @returns {{ path: string, plugin: string }}
 */
async function resolveAgent(registry, agentId) {
  const entry = registry.agents.get(agentId);
  if (!entry) {
    throw new Error(`Agent not found: ${agentId}`);
  }
  return entry;
}

/**
 * Resolve a template reference.
 *
 * - Namespaced: "pluginName/file.md"  → find entry whose plugin matches and id matches basename
 * - Plain:      "file.md" or "file"   → first match in the templates map
 *
 * @param {{ templates: Map }} registry
 * @param {string} templateRef
 * @returns {{ path: string, plugin: string } | null}
 */
async function resolveTemplate(registry, templateRef) {
  const parts = templateRef.split('/');

  if (parts.length >= 2) {
    // Namespaced reference: "pluginName/file.md"
    const pluginName = parts[0];
    const fileName = parts.slice(1).join('/');
    const id = path.basename(fileName, path.extname(fileName));

    // Directly look up the namespaced key "pluginName/id"
    const namespaced = registry.templates.get(`${pluginName}/${id}`);
    if (namespaced) return namespaced;

    // Fallback: linear search (handles edge cases)
    for (const [entryId, entry] of registry.templates) {
      if (entryId === id && entry.plugin === pluginName) {
        return entry;
      }
    }
    return null;
  }

  // Plain reference: match by id (filename without extension)
  const id = path.basename(templateRef, path.extname(templateRef));
  return registry.templates.get(id) || null;
}

module.exports = { buildRegistry, resolveAgent, resolveTemplate };
