'use strict';

const fs = require('node:fs/promises');

/**
 * Extract content of a named ## Section from markdown.
 * Splits on ## headings and finds the matching section.
 * Returns trimmed content or null if section not found.
 * @param {string} markdown
 * @param {string} sectionName
 * @returns {string|null}
 */
function extractSection(markdown, sectionName) {
  // Split the document on "## <heading>" lines
  const parts = markdown.split(/^##\s+/m);
  // Each part (except possibly the first) starts with the heading text
  for (const part of parts) {
    const newlineIdx = part.indexOf('\n');
    if (newlineIdx === -1) continue;
    const heading = part.slice(0, newlineIdx).trim();
    if (heading === sectionName) {
      return part.slice(newlineIdx).trim();
    }
  }
  return null;
}

/**
 * Parse a user-feedback.md markdown string into structured fields.
 * @param {string} markdownContent
 * @returns {{ decisions: string, free: string, action: string|null }}
 */
function parseFeedback(markdownContent) {
  const decisions = extractSection(markdownContent, 'Decisions') ?? '';
  const free = extractSection(markdownContent, 'Free feedback') ?? '';

  const actionSection = extractSection(markdownContent, 'Action');
  let action = null;
  if (actionSection !== null && actionSection.length > 0) {
    // Extract first word before → (or end of line)
    const firstLine = actionSection.split('\n')[0].trim();
    const arrowMatch = firstLine.match(/^(\S+)\s*→/);
    if (arrowMatch) {
      action = arrowMatch[1];
    } else {
      // No arrow — take first word
      const wordMatch = firstLine.match(/^(\S+)/);
      action = wordMatch ? wordMatch[1] : null;
    }
  }

  return { decisions, free, action };
}

/**
 * Read a user-feedback.md file and parse it.
 * @param {string} feedbackPath  Absolute path to the feedback file
 * @returns {Promise<{ decisions: string, free: string, action: string|null }|null>}
 */
async function readFeedback(feedbackPath) {
  try {
    const content = await fs.readFile(feedbackPath, 'utf8');
    return parseFeedback(content);
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

module.exports = { parseFeedback, readFeedback };
