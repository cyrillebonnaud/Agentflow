'use strict';

/**
 * Normalizes a raw string into a safe kebab-case filesystem slug.
 * - lowercase
 * - replace spaces and special chars (anything not a-z0-9) with hyphens
 * - collapse consecutive hyphens into one
 * - trim leading/trailing hyphens
 * - truncate to 40 chars (at word boundary if possible)
 *
 * @param {string} raw
 * @returns {string}
 */
function sanitizeSlug(raw) {
  let slug = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')   // non-alphanumeric runs → single hyphen
    .replace(/-+/g, '-')            // collapse consecutive hyphens
    .replace(/^-+|-+$/g, '');       // trim leading/trailing hyphens

  if (slug.length > 40) {
    // Try to truncate at a word boundary (last hyphen at or before position 40)
    const truncated = slug.slice(0, 40);
    const lastHyphen = truncated.lastIndexOf('-');
    if (lastHyphen > 0) {
      slug = truncated.slice(0, lastHyphen);
    } else {
      slug = truncated;
    }
    // Remove any trailing hyphens that may result
    slug = slug.replace(/-+$/g, '');
  }

  return slug;
}

/**
 * If slug is already in existingSlugs Set, append -2, -3, ... until unique.
 *
 * @param {string} slug
 * @param {Set<string>} existingSlugs
 * @returns {string}
 */
function ensureUnique(slug, existingSlugs) {
  if (!existingSlugs.has(slug)) {
    return slug;
  }
  let counter = 2;
  while (existingSlugs.has(`${slug}-${counter}`)) {
    counter++;
  }
  return `${slug}-${counter}`;
}

module.exports = { sanitizeSlug, ensureUnique };
