'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { parseFeedback, readFeedback } = require('../../src/interaction/feedback-parser');

const SAMPLE_FEEDBACK = `# User Feedback — step-onboarding / review / v1

## Decisions
- Skip email verification for SSO: yes
- Allow onboarding skip: no — mandatory for compliance

## Free feedback
Step 3 needs a progress indicator.

## Action
validate → launch v2
`;

test('parseFeedback parses ## Decisions section content', () => {
  const result = parseFeedback(SAMPLE_FEEDBACK);
  assert.ok(result.decisions.includes('Skip email verification for SSO: yes'));
  assert.ok(result.decisions.includes('Allow onboarding skip: no — mandatory for compliance'));
});

test('parseFeedback parses ## Free feedback section content', () => {
  const result = parseFeedback(SAMPLE_FEEDBACK);
  assert.ok(result.free.includes('Step 3 needs a progress indicator.'));
});

test('parseFeedback extracts action "validate" from "validate → launch v2"', () => {
  const result = parseFeedback(SAMPLE_FEEDBACK);
  assert.equal(result.action, 'validate');
});

test('parseFeedback extracts action "discard" from "discard → try again"', () => {
  const content = `# User Feedback — step-x / track / v1

## Decisions
- Some decision: yes

## Action
discard → try again
`;
  const result = parseFeedback(content);
  assert.equal(result.action, 'discard');
});

test('parseFeedback handles missing ## Free feedback section (returns empty string)', () => {
  const content = `# User Feedback — step-x / track / v1

## Decisions
- Some decision: yes

## Action
validate → go
`;
  const result = parseFeedback(content);
  assert.equal(result.free, '');
});

test('parseFeedback handles missing ## Action section (returns null)', () => {
  const content = `# User Feedback — step-x / track / v1

## Decisions
- Some decision: yes

## Free feedback
Some feedback here.
`;
  const result = parseFeedback(content);
  assert.equal(result.action, null);
});

test('readFeedback returns null for missing file', async () => {
  const result = await readFeedback('/nonexistent/path/user-feedback.md');
  assert.equal(result, null);
});

test('readFeedback reads and parses existing file', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'feedback-test-'));
  const feedbackPath = path.join(tmpDir, 'user-feedback.md');
  await fs.writeFile(feedbackPath, SAMPLE_FEEDBACK, 'utf8');

  const result = await readFeedback(feedbackPath);
  assert.ok(result !== null);
  assert.equal(result.action, 'validate');
  assert.ok(result.decisions.includes('Skip email verification for SSO: yes'));
});
