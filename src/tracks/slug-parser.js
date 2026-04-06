'use strict';

const matter = require('gray-matter');

/**
 * Reads YAML frontmatter from a lead output file and extracts the track slug.
 * Falls back to `track-{fallbackIndex}` if no slug in frontmatter.
 *
 * Looks for frontmatter field: `slug:` or `track:`
 *
 * @param {string} content - raw output.md content (may have YAML frontmatter)
 * @param {number} fallbackIndex - 1-based index used if no slug found
 * @returns {string} raw slug (not yet sanitized)
 */
function parseSlug(content, fallbackIndex) {
  let parsed;
  try {
    parsed = matter(content);
  } catch {
    return `track-${fallbackIndex}`;
  }

  const data = parsed.data || {};

  if (data.slug && typeof data.slug === 'string' && data.slug.trim() !== '') {
    return data.slug;
  }

  if (data.track && typeof data.track === 'string' && data.track.trim() !== '') {
    return data.track;
  }

  return `track-${fallbackIndex}`;
}

module.exports = { parseSlug };
