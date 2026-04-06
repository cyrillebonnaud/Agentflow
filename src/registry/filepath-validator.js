'use strict';

const fs = require('node:fs/promises');

/**
 * Validate that a single file path exists and is readable.
 *
 * @param {string} filePath - Absolute (or resolvable) path to check
 * @param {string} label    - Human-readable label used in error messages
 * @returns {Promise<void>}
 * @throws {Error} with message `${label}: file not found: ${filePath}` if not accessible
 */
async function validatePath(filePath, label) {
  try {
    await fs.access(filePath, fs.constants.R_OK);
  } catch {
    throw new Error(`${label}: file not found: ${filePath}`);
  }
}

/**
 * Validate that all given file paths exist and are readable.
 * Collects ALL failures before throwing so the caller gets the full picture.
 *
 * @param {Array<{ path: string, label: string }>} entries
 * @returns {Promise<void>}
 * @throws {AggregateError} containing one Error per missing/unreadable path
 */
async function validatePaths(entries) {
  const results = await Promise.allSettled(
    entries.map(({ path, label }) => validatePath(path, label))
  );

  const errors = results
    .filter((r) => r.status === 'rejected')
    .map((r) => r.reason);

  if (errors.length > 0) {
    throw new AggregateError(errors, `${errors.length} file(s) not found`);
  }
}

module.exports = { validatePath, validatePaths };
