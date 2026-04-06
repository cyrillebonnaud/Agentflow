'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const { injectAllArtifacts, injectArtifact } = require('../../src/prompt/artifact-injector');

async function makeTmpDir() {
  const dir = path.join(os.tmpdir(), `af-ai-test-${crypto.randomBytes(4).toString('hex')}`);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

describe('artifact-injector', () => {
  let runDir;

  before(async () => {
    runDir = await makeTmpDir();
    await fs.mkdir(path.join(runDir, 'artifacts'), { recursive: true });

    // Create artifact files
    await fs.writeFile(path.join(runDir, 'artifacts', 'user-research.md'), '# User Research\nFindings here.', 'utf8');
    await fs.writeFile(path.join(runDir, 'artifacts', 'prd.md'), '# PRD\nProduct requirements.', 'utf8');
    await fs.writeFile(path.join(runDir, 'artifacts', 'partial.md'), '# Partial\nThis exists.', 'utf8');
  });

  after(async () => {
    await fs.rm(runDir, { recursive: true, force: true });
  });

  it('injectAllArtifacts returns content for all done steps with artifact_path', async () => {
    const runState = {
      steps: {
        'user-research': { status: 'done', artifact_path: 'artifacts/user-research.md' },
        'prd-writing':   { status: 'done', artifact_path: 'artifacts/prd.md' },
      },
    };

    const result = await injectAllArtifacts(runDir, runState);

    assert.equal(typeof result, 'object');
    assert.ok('user-research' in result, 'user-research should be in result');
    assert.ok('prd-writing' in result, 'prd-writing should be in result');
    assert.ok(result['user-research'].includes('User Research'), 'should include artifact content');
    assert.ok(result['prd-writing'].includes('PRD'), 'should include prd content');
  });

  it('injectAllArtifacts skips steps without artifact_path', async () => {
    const runState = {
      steps: {
        'user-research': { status: 'done', artifact_path: 'artifacts/user-research.md' },
        'no-artifact':   { status: 'done' }, // no artifact_path
      },
    };

    const result = await injectAllArtifacts(runDir, runState);

    assert.ok('user-research' in result, 'user-research should be present');
    assert.ok(!('no-artifact' in result), 'no-artifact should be skipped');
  });

  it('injectAllArtifacts skips steps that are not done', async () => {
    const runState = {
      steps: {
        'user-research': { status: 'done',    artifact_path: 'artifacts/user-research.md' },
        'pending-step':  { status: 'pending', artifact_path: 'artifacts/partial.md' },
        'running-step':  { status: 'running', artifact_path: 'artifacts/partial.md' },
        'skipped-step':  { status: 'skipped', artifact_path: 'artifacts/partial.md' },
      },
    };

    const result = await injectAllArtifacts(runDir, runState);

    assert.ok('user-research' in result, 'done step should be included');
    assert.ok(!('pending-step' in result), 'pending step should be skipped');
    assert.ok(!('running-step' in result), 'running step should be skipped');
    assert.ok(!('skipped-step' in result), 'skipped step should be skipped');
  });

  it('injectAllArtifacts returns empty object when no steps', async () => {
    const runState = { steps: {} };
    const result = await injectAllArtifacts(runDir, runState);
    assert.deepEqual(result, {});
  });

  it('injectArtifact reads correct file content', async () => {
    const content = await injectArtifact(runDir, 'artifacts/user-research.md');
    assert.ok(content.includes('User Research'), 'should read file content');
    assert.ok(content.includes('Findings here.'), 'should include full content');
  });

  it('injectArtifact reads prd artifact correctly', async () => {
    const content = await injectArtifact(runDir, 'artifacts/prd.md');
    assert.ok(content.includes('PRD'), 'should read prd content');
    assert.ok(content.includes('Product requirements.'), 'should include full content');
  });
});
