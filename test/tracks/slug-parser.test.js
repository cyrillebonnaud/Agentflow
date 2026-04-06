'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseSlug } = require('../../src/tracks/slug-parser');

test('parseSlug: extracts slug field from frontmatter', () => {
  const content = `---
slug: my-track-slug
title: Some Title
---
# Content here
`;
  assert.equal(parseSlug(content, 1), 'my-track-slug');
});

test('parseSlug: extracts track field from frontmatter when no slug field', () => {
  const content = `---
track: my-track-name
title: Another Title
---
# Content
`;
  assert.equal(parseSlug(content, 2), 'my-track-name');
});

test('parseSlug: slug takes precedence over track field', () => {
  const content = `---
slug: slug-wins
track: track-loses
---
Body
`;
  assert.equal(parseSlug(content, 1), 'slug-wins');
});

test('parseSlug: returns track-{index} when no frontmatter at all', () => {
  const content = `# Just a plain markdown file
No frontmatter here.
`;
  assert.equal(parseSlug(content, 1), 'track-1');
  assert.equal(parseSlug(content, 5), 'track-5');
});

test('parseSlug: returns track-{index} when frontmatter has no slug or track field', () => {
  const content = `---
title: No slug here
author: Someone
---
Body text
`;
  assert.equal(parseSlug(content, 3), 'track-3');
});

test('parseSlug: handles content with no frontmatter at all (no dashes)', () => {
  const content = 'Just plain text without any frontmatter markers.';
  assert.equal(parseSlug(content, 7), 'track-7');
});

test('parseSlug: handles empty string content', () => {
  assert.equal(parseSlug('', 2), 'track-2');
});

test('parseSlug: handles frontmatter with empty slug value', () => {
  const content = `---
slug:
---
Body
`;
  // empty/null slug should fall back to track-{index}
  assert.equal(parseSlug(content, 4), 'track-4');
});
