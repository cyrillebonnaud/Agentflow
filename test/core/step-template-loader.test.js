'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { loadStepTemplate, resolveStep } = require('../../src/core/step-template-loader');

// Helper: write a temp YAML file and return its path
function writeTmp(dir, filename, content) {
  const filepath = path.join(dir, filename);
  fs.writeFileSync(filepath, content, 'utf8');
  return filepath;
}

describe('loadStepTemplate', () => {
  let tmpDir;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentflow-test-'));
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('parses a YAML file and returns a plain object', async () => {
    const filepath = writeTmp(
      tmpDir,
      'template.yaml',
      `type: refine\nmax_iterations: 3\nreviewers:\n  - product-critic\n`
    );

    const result = await loadStepTemplate(filepath);

    assert.deepEqual(result, {
      type: 'refine',
      max_iterations: 3,
      reviewers: ['product-critic'],
    });
  });

  it('throws if the file does not exist', async () => {
    await assert.rejects(
      () => loadStepTemplate(path.join(tmpDir, 'nonexistent.yaml')),
      Error
    );
  });
});

describe('resolveStep – no extends', () => {
  it('returns the step unchanged when no extends key is present', async () => {
    const step = { id: 'my-step', lead: 'product-manager', reviewers: ['critic'] };
    const result = await resolveStep(step, { stepTemplatesDir: '/tmp', projectRoot: '/tmp' });
    assert.deepEqual(result, step);
    // Must be a copy, not the same reference
    assert.notEqual(result, step);
  });
});

describe('resolveStep – with extends', () => {
  let tmpDir;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentflow-resolve-'));
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('merges template with step (step fields win)', async () => {
    const templatePath = writeTmp(
      tmpDir,
      'standard-refine.yaml',
      `type: refine\nmoderator: moderator\nmax_iterations: 3\nmax_rounds: 2\n`
    );

    const step = {
      id: 'prd-writing',
      extends: templatePath,
      lead: 'product-manager',
      max_iterations: 5, // overrides template
    };

    const result = await resolveStep(step, { stepTemplatesDir: tmpDir, projectRoot: tmpDir });

    assert.equal(result.type, 'refine');              // from template
    assert.equal(result.moderator, 'moderator');      // from template
    assert.equal(result.max_rounds, 2);               // from template
    assert.equal(result.lead, 'product-manager');     // from step
    assert.equal(result.max_iterations, 5);           // step wins
  });

  it('step array replaces template array (not merged)', async () => {
    const templatePath = writeTmp(
      tmpDir,
      'array-template.yaml',
      `type: refine\nreviewers:\n  - product-critic\n`
    );

    const step = {
      id: 'prd-writing',
      extends: templatePath,
      reviewers: ['product-critic', 'tech-architect'],
    };

    const result = await resolveStep(step, { stepTemplatesDir: tmpDir, projectRoot: tmpDir });

    assert.deepEqual(result.reviewers, ['product-critic', 'tech-architect']);
  });

  it('removes the extends key from the result', async () => {
    const templatePath = writeTmp(
      tmpDir,
      'simple-template.yaml',
      `type: refine\n`
    );

    const step = { id: 'x', extends: templatePath };
    const result = await resolveStep(step, { stepTemplatesDir: tmpDir, projectRoot: tmpDir });

    assert.ok(!Object.prototype.hasOwnProperty.call(result, 'extends'), 'extends key must be removed');
  });

  it('resolves a relative template path from stepTemplatesDir', async () => {
    writeTmp(tmpDir, 'relative-template.yaml', `type: llm\nmax_tokens: 1000\n`);

    const step = {
      id: 'some-step',
      extends: 'relative-template.yaml',
    };

    const result = await resolveStep(step, { stepTemplatesDir: tmpDir, projectRoot: '/nonexistent' });

    assert.equal(result.type, 'llm');
    assert.equal(result.max_tokens, 1000);
  });

  it('falls back to projectRoot when template not found in stepTemplatesDir', async () => {
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentflow-proj-'));
    try {
      writeTmp(projectDir, 'proj-template.yaml', `type: human\n`);

      const step = {
        id: 'some-step',
        extends: 'proj-template.yaml',
      };

      const result = await resolveStep(step, {
        stepTemplatesDir: path.join(projectDir, 'nonexistent-subdir'),
        projectRoot: projectDir,
      });

      assert.equal(result.type, 'human');
    } finally {
      fs.rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it('throws if template file is not found anywhere', async () => {
    const step = { id: 'x', extends: 'totally-missing.yaml' };
    await assert.rejects(
      () => resolveStep(step, { stepTemplatesDir: tmpDir, projectRoot: tmpDir }),
      Error
    );
  });
});
