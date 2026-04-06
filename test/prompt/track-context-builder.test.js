'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const { buildTrackContext } = require('../../src/prompt/track-context-builder');

async function makeTmpDir() {
  const dir = path.join(os.tmpdir(), `af-tcb-${crypto.randomBytes(4).toString('hex')}`);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

async function makeRunDir(tmpDir) {
  const runDir = path.join(tmpDir, 'my-run');
  await fs.mkdir(path.join(runDir, 'artifacts'), { recursive: true });
  await fs.mkdir(path.join(runDir, 'steps'), { recursive: true });
  return runDir;
}

describe('buildTrackContext', () => {
  let tmpDir;
  before(async () => { tmpDir = await makeTmpDir(); });
  after(async () => { await fs.rm(tmpDir, { recursive: true, force: true }); });

  it('injects all done artifacts when no contextDecls', async () => {
    const runDir = await makeRunDir(tmpDir);
    await fs.writeFile(path.join(runDir, 'artifacts', 'user-research.md'), '# User Research\nFindings here.');

    const runState = {
      flow_input: 'test input',
      flow_id: 'ux-brief',
      steps: {
        'user-research': { status: 'done', artifact_path: 'artifacts/user-research.md' },
      },
    };

    const result = await buildTrackContext({
      runDir, runState,
      stepId: 'ux-detail', trackSlug: 'minimalist', trackIndex: 1, trackTotal: 3,
    });

    assert.ok(result.artifacts['user-research'].includes('Findings here.'));
    assert.equal(result.flowContext.track.name, 'minimalist');
    assert.equal(result.flowContext.track.index, 1);
    assert.equal(result.flowContext.track.total, 3);
  });

  it('resolves artifacts.{{track}} with track substitution', async () => {
    const runDir = await makeRunDir(tmpDir);
    const trackDir = path.join(runDir, 'artifacts', 'ux-directions');
    await fs.mkdir(trackDir, { recursive: true });
    await fs.writeFile(path.join(trackDir, 'minimalist.md'), '# Minimalist Direction');

    const runState = {
      flow_input: 'test',
      flow_id: 'ux-brief',
      steps: {
        'ux-directions': { status: 'done', artifact_path: 'artifacts/ux-directions/minimalist.md' },
      },
    };

    const result = await buildTrackContext({
      runDir, runState,
      stepId: 'ux-detail', trackSlug: 'minimalist', trackIndex: 1, trackTotal: 2,
      contextDecls: ['artifacts.ux-directions.{{track}}'],
    });

    assert.ok(result.artifacts['ux-directions'].includes('Minimalist Direction'));
  });

  it('skips missing artifacts silently', async () => {
    const runDir = await makeRunDir(tmpDir);
    const runState = {
      flow_input: 'test',
      flow_id: 'x',
      steps: {
        'missing-step': { status: 'done', artifact_path: 'artifacts/missing-step.md' },
      },
    };

    const result = await buildTrackContext({
      runDir, runState,
      stepId: 'next', trackSlug: 'main', trackIndex: 1, trackTotal: 1,
      contextDecls: ['artifacts.missing-step'],
    });

    assert.equal(Object.keys(result.artifacts).length, 0, 'missing artifact should be skipped');
  });

  it('resolves user_feedback decisions', async () => {
    const runDir = await makeRunDir(tmpDir);
    const feedbackDir = path.join(runDir, 'steps', 'user-research');
    await fs.mkdir(feedbackDir, { recursive: true });
    await fs.writeFile(path.join(feedbackDir, 'user-feedback.md'), `# Feedback

## Decisions
- Use SSO flow: yes
- Skip verification: no

## Free feedback
Make it simpler.

## Action
validate
`);

    const runState = {
      flow_input: 'test', flow_id: 'x',
      steps: { 'user-research': { status: 'done' } },
    };

    const result = await buildTrackContext({
      runDir, runState,
      stepId: 'ux-detail', trackSlug: 'main', trackIndex: 1, trackTotal: 1,
      contextDecls: ['user_feedback.user-research.decisions'],
    });

    assert.ok(result.userFeedback['user-research'].decisions.includes('Use SSO flow: yes'));
  });

  it('includes flow context with track info', async () => {
    const runDir = await makeRunDir(tmpDir);
    const runState = { flow_input: 'Mobile onboarding', flow_id: 'ux-brief', steps: {} };

    const result = await buildTrackContext({
      runDir, runState,
      stepId: 'ux-detail', trackSlug: 'contextual', trackIndex: 2, trackTotal: 3,
    });

    assert.equal(result.flowContext.flow.input, 'Mobile onboarding');
    assert.equal(result.flowContext.step.id, 'ux-detail');
    assert.equal(result.flowContext.track.name, 'contextual');
    assert.equal(result.flowContext.track.index, 2);
    assert.equal(result.flowContext.track.total, 3);
  });
});
