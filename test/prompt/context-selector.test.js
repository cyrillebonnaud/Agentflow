'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const { selectContext } = require('../../src/prompt/context-selector');

async function makeTmpDir() {
  const dir = path.join(os.tmpdir(), `af-cs-test-${crypto.randomBytes(4).toString('hex')}`);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

describe('selectContext', () => {
  let runDir;

  before(async () => {
    runDir = await makeTmpDir();
    await fs.mkdir(path.join(runDir, 'artifacts'), { recursive: true });
    await fs.mkdir(path.join(runDir, 'steps', 'user-research'), { recursive: true });
    await fs.mkdir(path.join(runDir, 'steps', 'ux-directions'), { recursive: true });

    // Artifact files
    await fs.writeFile(
      path.join(runDir, 'artifacts', 'user-research.md'),
      '# User Research\nFindings here.',
      'utf8'
    );
    await fs.writeFile(
      path.join(runDir, 'artifacts', 'ux-directions-minimalist.md'),
      '# UX Directions Minimalist\nMinimalist content.',
      'utf8'
    );
    await fs.writeFile(
      path.join(runDir, 'artifacts', 'ux-directions-bold.md'),
      '# UX Directions Bold\nBold content.',
      'utf8'
    );

    // User feedback files
    await fs.writeFile(
      path.join(runDir, 'steps', 'user-research', 'user-feedback.md'),
      '## Decisions\nApprove the research approach\n## Free feedback\nLooks great!',
      'utf8'
    );
  });

  after(async () => {
    await fs.rm(runDir, { recursive: true, force: true });
  });

  function makeRunState(overrides = {}) {
    return {
      steps: {
        'user-research': {
          status: 'done',
          artifact_path: 'artifacts/user-research.md',
          ...overrides['user-research'],
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
          ...overrides['ux-directions'],
        },
      },
    };
  }

  it('resolves artifacts.user-research → artifact content', async () => {
    const runState = makeRunState();
    const result = await selectContext(
      ['artifacts.user-research'],
      { runDir, runState, trackSlug: 'minimalist' }
    );

    assert.ok(result.artifacts['user-research'], 'user-research artifact should be in result');
    assert.ok(result.artifacts['user-research'].includes('User Research'), 'should contain artifact content');
    assert.deepEqual(result.userFeedback, {});
  });

  it('resolves artifacts.ux-directions.{{track}} with trackSlug substitution', async () => {
    const runState = makeRunState();
    const result = await selectContext(
      ['artifacts.ux-directions.{{track}}'],
      { runDir, runState, trackSlug: 'minimalist' }
    );

    assert.ok(result.artifacts['ux-directions'], 'ux-directions artifact should be in result');
    assert.ok(result.artifacts['ux-directions'].includes('Minimalist'), 'should use minimalist track content');
  });

  it('resolves artifacts.ux-directions.{{track}} substituting bold track', async () => {
    const runState = makeRunState();
    const result = await selectContext(
      ['artifacts.ux-directions.{{track}}'],
      { runDir, runState, trackSlug: 'bold' }
    );

    assert.ok(result.artifacts['ux-directions'], 'ux-directions artifact should be in result');
    assert.ok(result.artifacts['ux-directions'].includes('Bold'), 'should use bold track content');
  });

  it('resolves user_feedback.step-id.decisions → feedback content', async () => {
    const runState = makeRunState();
    const result = await selectContext(
      ['user_feedback.user-research.decisions'],
      { runDir, runState, trackSlug: 'minimalist' }
    );

    assert.deepEqual(result.artifacts, {});
    assert.ok(result.userFeedback['user-research'], 'user-research feedback should be present');
    assert.ok(
      result.userFeedback['user-research'].decisions.includes('Approve'),
      'decisions should contain approval text'
    );
  });

  it('skips missing artifacts silently (no error thrown)', async () => {
    const runState = makeRunState();
    // 'nonexistent-step' is not in run state at all
    const result = await selectContext(
      ['artifacts.nonexistent-step', 'artifacts.user-research'],
      { runDir, runState, trackSlug: 'minimalist' }
    );

    assert.ok(!result.artifacts['nonexistent-step'], 'missing step should be silently skipped');
    assert.ok(result.artifacts['user-research'], 'valid step should still be resolved');
  });

  it('handles empty contextDeclarations → returns empty objects', async () => {
    const runState = makeRunState();
    const result = await selectContext([], { runDir, runState, trackSlug: 'minimalist' });

    assert.deepEqual(result.artifacts, {});
    assert.deepEqual(result.userFeedback, {});
  });

  it('resolves multiple declarations at once', async () => {
    const runState = makeRunState();
    const result = await selectContext(
      ['artifacts.user-research', 'artifacts.ux-directions.{{track}}'],
      { runDir, runState, trackSlug: 'minimalist' }
    );

    assert.ok(result.artifacts['user-research'], 'user-research should be present');
    assert.ok(result.artifacts['ux-directions'], 'ux-directions should be present');
  });
});
