'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { validateContextSelectors } = require('../../src/prompt/context-validator');

function makeRunState(stepsOverride = {}) {
  return {
    steps: {
      'user-research': {
        status: 'done',
        artifact_path: 'artifacts/user-research.md',
      },
      'prd-writing': {
        status: 'done',
        artifact_path: 'artifacts/prd.md',
      },
      'ux-directions': {
        status: 'done',
        tracks: {
          minimalist: {
            status: 'done',
            artifact_path: 'artifacts/ux-directions-minimalist.md',
          },
          bold: {
            status: 'done',
            artifact_path: 'artifacts/ux-directions-bold.md',
          },
        },
      },
      'skipped-step': {
        status: 'skipped',
        artifact_path: null,
      },
      'pending-step': {
        status: 'pending',
      },
      ...stepsOverride,
    },
  };
}

describe('validateContextSelectors', () => {
  it('returns valid=true when all artifact selectors resolve', () => {
    const runState = makeRunState();
    const result = validateContextSelectors(
      ['artifacts.user-research', 'artifacts.prd-writing'],
      runState,
      'minimalist'
    );

    assert.equal(result.valid, true);
    assert.deepEqual(result.errors, []);
  });

  it('returns errors for missing step artifacts (step not in run state)', () => {
    const runState = makeRunState();
    const result = validateContextSelectors(
      ['artifacts.nonexistent-step'],
      runState,
      'minimalist'
    );

    assert.equal(result.valid, false);
    assert.equal(result.errors.length, 1);
    assert.ok(result.errors[0].includes('nonexistent-step'), 'error should mention the step id');
    assert.ok(result.errors[0].includes('not found'), 'error should say not found');
  });

  it('reports step status when step exists but artifact is missing (no artifact_path)', () => {
    const runState = makeRunState();
    const result = validateContextSelectors(
      ['artifacts.pending-step'],
      runState,
      'minimalist'
    );

    assert.equal(result.valid, false);
    assert.equal(result.errors.length, 1);
    assert.ok(result.errors[0].includes('pending-step'), 'error should mention step id');
    assert.ok(result.errors[0].includes('pending'), 'error should mention current step status');
  });

  it('reports skipped status when step is skipped and has no artifact', () => {
    const runState = makeRunState();
    const result = validateContextSelectors(
      ['artifacts.skipped-step'],
      runState,
      'minimalist'
    );

    assert.equal(result.valid, false);
    assert.ok(result.errors[0].includes('skipped'), 'error should mention skipped status');
  });

  it('{{track}} substitution works in validation — valid when track artifact exists', () => {
    const runState = makeRunState();
    const result = validateContextSelectors(
      ['artifacts.ux-directions.{{track}}'],
      runState,
      'minimalist'
    );

    assert.equal(result.valid, true);
    assert.deepEqual(result.errors, []);
  });

  it('{{track}} substitution fails when track not found in step tracks', () => {
    const runState = makeRunState();
    const result = validateContextSelectors(
      ['artifacts.ux-directions.{{track}}'],
      runState,
      'nonexistent-track'
    );

    assert.equal(result.valid, false);
    assert.ok(result.errors.length > 0, 'should have errors for missing track');
  });

  it('user_feedback selectors validated against run state — valid when step exists', () => {
    const runState = makeRunState();
    const result = validateContextSelectors(
      ['user_feedback.user-research.decisions'],
      runState,
      'minimalist'
    );

    assert.equal(result.valid, true);
    assert.deepEqual(result.errors, []);
  });

  it('user_feedback selectors fail when step not in run state', () => {
    const runState = makeRunState();
    const result = validateContextSelectors(
      ['user_feedback.nonexistent.decisions'],
      runState,
      'minimalist'
    );

    assert.equal(result.valid, false);
    assert.ok(result.errors.length > 0, 'should have errors for missing step');
    assert.ok(result.errors[0].includes('nonexistent'), 'error should mention step id');
  });

  it('returns valid=true for empty declarations', () => {
    const runState = makeRunState();
    const result = validateContextSelectors([], runState, 'minimalist');

    assert.equal(result.valid, true);
    assert.deepEqual(result.errors, []);
  });

  it('accumulates multiple errors', () => {
    const runState = makeRunState();
    const result = validateContextSelectors(
      ['artifacts.ghost-a', 'artifacts.ghost-b'],
      runState,
      'minimalist'
    );

    assert.equal(result.valid, false);
    assert.equal(result.errors.length, 2);
  });
});
