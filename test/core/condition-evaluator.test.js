'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { evaluateCondition } = require('../../src/core/condition-evaluator');

// Shared context used across most tests
const ctx = {
  surviving_tracks: { count: 2, names: ['track-a', 'track-b'] },
  flow: { input: 'enterprise solution needed', id: 'flow-1' },
  artifacts: { prd: 'This document covers compliance and security requirements.' },
  user_feedback: { 'ux-directions': { action: 'validate', decisions: {}, free: '' } },
  steps: { 'prd-writing': { status: 'done' } },
};

describe('evaluateCondition – numeric comparisons', () => {
  it('surviving_tracks.count > 1 returns true when count=2', () => {
    assert.equal(evaluateCondition('surviving_tracks.count > 1', ctx), true);
  });

  it('surviving_tracks.count > 1 returns false when count=1', () => {
    const c = { ...ctx, surviving_tracks: { count: 1, names: [] } };
    assert.equal(evaluateCondition('surviving_tracks.count > 1', c), false);
  });

  it('> 0 returns true when value is positive', () => {
    assert.equal(evaluateCondition('surviving_tracks.count > 0', ctx), true);
  });

  it('>= 2 returns true when count equals 2', () => {
    assert.equal(evaluateCondition('surviving_tracks.count >= 2', ctx), true);
  });

  it('>= 2 returns false when count is 1', () => {
    const c = { ...ctx, surviving_tracks: { count: 1, names: [] } };
    assert.equal(evaluateCondition('surviving_tracks.count >= 2', c), false);
  });

  it('< 5 returns true when count is 2', () => {
    assert.equal(evaluateCondition('surviving_tracks.count < 5', ctx), true);
  });

  it('< 5 returns false when count is 5', () => {
    const c = { ...ctx, surviving_tracks: { count: 5, names: [] } };
    assert.equal(evaluateCondition('surviving_tracks.count < 5', c), false);
  });

  it('== 3 (numeric) returns true', () => {
    const c = { ...ctx, surviving_tracks: { count: 3, names: [] } };
    assert.equal(evaluateCondition('surviving_tracks.count == 3', c), true);
  });

  it('== 3 (numeric) returns false when count is 2', () => {
    assert.equal(evaluateCondition('surviving_tracks.count == 3', ctx), false);
  });
});

describe('evaluateCondition – string contains', () => {
  it('flow.input contains enterprise returns true', () => {
    assert.equal(evaluateCondition("flow.input contains 'enterprise'", ctx), true);
  });

  it('flow.input contains enterprise returns false when absent', () => {
    const c = { ...ctx, flow: { input: 'standard solution', id: 'f1' } };
    assert.equal(evaluateCondition("flow.input contains 'enterprise'", c), false);
  });

  it('artifacts.prd contains compliance returns true', () => {
    assert.equal(evaluateCondition("artifacts.prd contains 'compliance'", ctx), true);
  });

  it('artifacts.prd contains compliance returns false when absent', () => {
    const c = { ...ctx, artifacts: { prd: 'No special requirements.' } };
    assert.equal(evaluateCondition("artifacts.prd contains 'compliance'", c), false);
  });
});

describe('evaluateCondition – string equality', () => {
  it("user_feedback.ux-directions.action == 'validate' returns true", () => {
    assert.equal(
      evaluateCondition("user_feedback.ux-directions.action == 'validate'", ctx),
      true
    );
  });

  it("user_feedback.ux-directions.action == 'approve' returns false", () => {
    assert.equal(
      evaluateCondition("user_feedback.ux-directions.action == 'approve'", ctx),
      false
    );
  });

  it("steps.prd-writing.status == 'done' returns true", () => {
    assert.equal(evaluateCondition("steps.prd-writing.status == 'done'", ctx), true);
  });

  it("steps.prd-writing.status == 'pending' returns false", () => {
    assert.equal(evaluateCondition("steps.prd-writing.status == 'pending'", ctx), false);
  });
});

describe('evaluateCondition – and / or operators', () => {
  it('and: both true => true', () => {
    assert.equal(
      evaluateCondition(
        "surviving_tracks.count > 1 and steps.prd-writing.status == 'done'",
        ctx
      ),
      true
    );
  });

  it('and: one false => false', () => {
    assert.equal(
      evaluateCondition(
        "surviving_tracks.count > 1 and steps.prd-writing.status == 'pending'",
        ctx
      ),
      false
    );
  });

  it('or: both true => true', () => {
    assert.equal(
      evaluateCondition(
        "surviving_tracks.count > 1 or steps.prd-writing.status == 'pending'",
        ctx
      ),
      true
    );
  });

  it('or: first false, second true => true', () => {
    const c = { ...ctx, surviving_tracks: { count: 1, names: [] } };
    assert.equal(
      evaluateCondition(
        "surviving_tracks.count > 1 or steps.prd-writing.status == 'done'",
        c
      ),
      true
    );
  });

  it('or: both false => false', () => {
    const c = { ...ctx, surviving_tracks: { count: 1, names: [] } };
    assert.equal(
      evaluateCondition(
        "surviving_tracks.count > 1 or steps.prd-writing.status == 'pending'",
        c
      ),
      false
    );
  });

  it('parentheses grouping works', () => {
    // (false or true) and true => true
    const c = { ...ctx, surviving_tracks: { count: 1, names: [] } };
    assert.equal(
      evaluateCondition(
        "(surviving_tracks.count > 1 or steps.prd-writing.status == 'done') and flow.input contains 'enterprise'",
        c
      ),
      true
    );
  });
});

describe('evaluateCondition – missing context keys', () => {
  it('missing top-level key returns false (not throw)', () => {
    assert.equal(evaluateCondition('nonexistent.field > 1', ctx), false);
  });

  it('missing nested key returns false (not throw)', () => {
    assert.equal(evaluateCondition("steps.missing-step.status == 'done'", ctx), false);
  });

  it('missing deeply nested key returns false (not throw)', () => {
    assert.equal(evaluateCondition("artifacts.nonexistent contains 'foo'", ctx), false);
  });
});

describe('evaluateCondition – invalid expressions', () => {
  it('unrecognised operator throws with helpful message', () => {
    assert.throws(
      () => evaluateCondition('surviving_tracks.count !== 1', ctx),
      (err) => {
        assert.ok(err instanceof Error);
        assert.ok(err.message.length > 0, 'error message should be non-empty');
        return true;
      }
    );
  });

  it('empty expression throws', () => {
    assert.throws(() => evaluateCondition('', ctx), Error);
  });

  it('unclosed parenthesis throws', () => {
    assert.throws(
      () => evaluateCondition('(surviving_tracks.count > 1', ctx),
      Error
    );
  });
});
