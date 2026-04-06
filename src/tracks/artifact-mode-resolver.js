'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { parseSlug } = require('./slug-parser');

/**
 * Determines whether a step uses delegated or declarative artifact mode.
 * - 'delegated' if step.artifact_type is set
 * - 'declarative' if step.artifacts is a non-empty array
 * - throws if neither is set (or artifacts is empty)
 *
 * @param {object} step - resolved flow step object
 * @returns {'delegated'|'declarative'}
 */
function resolveArtifactMode(step) {
  if (step.artifact_type) {
    return 'delegated';
  }
  if (Array.isArray(step.artifacts) && step.artifacts.length > 0) {
    return 'declarative';
  }
  throw new Error(
    'Step must define either artifact_type (delegated mode) or a non-empty artifacts array (declarative mode)',
  );
}

/**
 * In delegated mode: scan stepDir for subdirectories with v1/lead/output.md.
 * Each subdir name is a potential track. Read output.md, parse slug from frontmatter.
 *
 * @param {string} stepDir - path to runs/<run-id>/steps/<step-id>/
 * @param {function(string): string} sanitizeSlugFn - function to sanitize a raw slug
 * @param {function(): Set<string>} existingSlugsFn - function returning current set of existing slugs
 * @returns {Promise<Array<{ rawSlug: string, sanitizedSlug: string, outputPath: string }>>}
 */
async function discoverTracks(stepDir, sanitizeSlugFn, existingSlugsFn) {
  let entries;
  try {
    entries = await fs.readdir(stepDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const results = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const subdirName = entry.name;
    const outputPath = path.join(stepDir, subdirName, 'v1', 'lead', 'output.md');

    // Check if output.md exists at expected location
    let content;
    try {
      content = await fs.readFile(outputPath, 'utf8');
    } catch {
      // No output.md at this path — skip this subdir
      continue;
    }

    // Parse slug from frontmatter; use subdir name as fallback index placeholder
    // We use a special approach: pass a numeric index via a sentinel, but since
    // parseSlug uses fallbackIndex for "track-N" format we'll handle the dir-name
    // fallback ourselves by comparing the result.
    const parsedSlug = parseSlugWithDirFallback(content, subdirName);
    const sanitizedSlug = sanitizeSlugFn(parsedSlug);

    results.push({
      rawSlug: parsedSlug,
      sanitizedSlug,
      outputPath,
    });
  }

  return results;
}

/**
 * Parse slug from content frontmatter, falling back to dirName (not track-N).
 *
 * @param {string} content
 * @param {string} dirName
 * @returns {string}
 */
function parseSlugWithDirFallback(content, dirName) {
  // Use a sentinel index that would produce "track-__SENTINEL__"
  // Then detect whether the result is the fallback and replace with dirName.
  const SENTINEL = '__SENTINEL__';
  // parseSlug returns `track-${fallbackIndex}` when no slug found.
  // We use a string that can't appear in frontmatter values.

  // Instead, re-implement the frontmatter check inline:
  const matter = require('gray-matter');
  let parsed;
  try {
    parsed = matter(content);
  } catch {
    return dirName;
  }

  const data = parsed.data || {};
  if (data.slug && typeof data.slug === 'string' && data.slug.trim() !== '') {
    return data.slug;
  }
  if (data.track && typeof data.track === 'string' && data.track.trim() !== '') {
    return data.track;
  }

  return dirName;
}

module.exports = { resolveArtifactMode, discoverTracks };
