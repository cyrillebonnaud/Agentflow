'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { generateRunId, generateStepDirName } = require('../../src/utils/id-generator');

test('generateRunId includes flowId and today\'s date in YYYYMMDD format', () => {
  const flowId = 'ux-brief';
  const id = generateRunId(flowId);

  // Today's date in YYYYMMDD
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const dateStr = `${yyyy}${mm}${dd}`;

  assert.ok(id.includes(flowId), `Expected id to include flowId "${flowId}", got "${id}"`);
  assert.ok(id.includes(dateStr), `Expected id to include date "${dateStr}", got "${id}"`);
});

test('generateRunId output is unique across calls', () => {
  const ids = new Set();
  for (let i = 0; i < 20; i++) {
    ids.add(generateRunId('my-flow'));
  }
  assert.equal(ids.size, 20, 'All generated IDs should be unique');
});

test('generateRunId matches expected format: flowId-YYYYMMDD-hex', () => {
  const id = generateRunId('my-flow');
  // e.g. "my-flow-20260405-a1b2c3"
  assert.match(id, /^my-flow-\d{8}-[0-9a-f]+$/);
});

test('generateStepDirName returns "stepId/track/vN" format', () => {
  const result = generateStepDirName('step-id', 'track-slug', 1);
  assert.equal(result, 'step-id/track-slug/v1');
});

test('generateStepDirName with different version numbers', () => {
  assert.equal(generateStepDirName('analyze', 'main', 3), 'analyze/main/v3');
  assert.equal(generateStepDirName('review', 'alt', 10), 'review/alt/v10');
});

test('generateStepDirName sanitizes slashes in inputs', () => {
  // Slashes in stepId or track should not create extra path segments
  const result = generateStepDirName('step/with/slashes', 'track/with/slashes', 1);
  // Slashes should be replaced so result still has exactly 2 slashes (3 parts)
  const parts = result.split('/');
  assert.equal(parts.length, 3, `Expected 3 parts, got ${parts.length}: "${result}"`);
  // Ensure the version part is correct
  assert.equal(parts[2], 'v1');
});
