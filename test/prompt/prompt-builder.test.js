'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const { buildPrompt, interpolateVariables } = require('../../src/prompt/prompt-builder');

// Helper to create a tmp dir with fixture files
async function makeTmpDir() {
  const dir = path.join(os.tmpdir(), `af-test-${crypto.randomBytes(4).toString('hex')}`);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

describe('interpolateVariables', () => {
  it('replaces {{flow.input}}', () => {
    const result = interpolateVariables('Input: {{flow.input}}', { flow: { input: 'hello world' } });
    assert.equal(result, 'Input: hello world');
  });

  it('replaces {{step.id}}', () => {
    const result = interpolateVariables('Step: {{step.id}}', { step: { id: 'ux-directions' } });
    assert.equal(result, 'Step: ux-directions');
  });

  it('replaces {{track.name}}', () => {
    const result = interpolateVariables('Track: {{track.name}}', { track: { name: 'minimalist-progressive' } });
    assert.equal(result, 'Track: minimalist-progressive');
  });

  it('leaves unknown variables as-is', () => {
    const result = interpolateVariables('Hello {{unknown.var}}', {});
    assert.equal(result, 'Hello {{unknown.var}}');
  });

  it('replaces multiple variables in one string', () => {
    const result = interpolateVariables(
      'Flow: {{flow.id}}, Step: {{step.id}}',
      { flow: { id: 'ux-brief' }, step: { id: 'directions' } }
    );
    assert.equal(result, 'Flow: ux-brief, Step: directions');
  });
});

describe('buildPrompt', () => {
  let tmpDir;
  let agentFile, skillFile, contextFile, templateFile;

  before(async () => {
    tmpDir = await makeTmpDir();
    agentFile = path.join(tmpDir, 'ux-designer.md');
    skillFile = path.join(tmpDir, 'heuristic-review.md');
    contextFile = path.join(tmpDir, 'design-system.md');
    templateFile = path.join(tmpDir, 'ux-direction.md');

    await fs.writeFile(agentFile, '# UX Designer\nI am a senior UX Designer.');
    await fs.writeFile(skillFile, '# Heuristic Review\nEvaluate against Nielsen heuristics.');
    await fs.writeFile(contextFile, '# Design System\nWe use an 8px grid.');
    await fs.writeFile(templateFile, '# UX Direction Template\nDocument your direction here.');
  });

  after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('includes agent content under Identity section', async () => {
    const prompt = await buildPrompt({
      agentPath: agentFile,
      skillPaths: [],
      contextPaths: [],
      templatePath: null,
      flowContext: { flow: { input: 'test', id: 'ux-brief' }, step: { id: 'directions' }, track: {} },
      artifacts: {},
      userFeedback: {},
    });
    assert.ok(prompt.includes('## Identity and posture'), 'missing Identity section');
    assert.ok(prompt.includes('I am a senior UX Designer.'), 'missing agent content');
  });

  it('includes skill content under Skills section', async () => {
    const prompt = await buildPrompt({
      agentPath: agentFile,
      skillPaths: [skillFile],
      contextPaths: [],
      templatePath: null,
      flowContext: { flow: { input: 'test', id: 'ux-brief' }, step: { id: 'directions' }, track: {} },
      artifacts: {},
      userFeedback: {},
    });
    assert.ok(prompt.includes('## Skills'), 'missing Skills section');
    assert.ok(prompt.includes('Evaluate against Nielsen heuristics.'), 'missing skill content');
  });

  it('includes context content under Business context section', async () => {
    const prompt = await buildPrompt({
      agentPath: agentFile,
      skillPaths: [],
      contextPaths: [contextFile],
      templatePath: null,
      flowContext: { flow: { input: 'test', id: 'ux-brief' }, step: { id: 'directions' }, track: {} },
      artifacts: {},
      userFeedback: {},
    });
    assert.ok(prompt.includes('## Business context'), 'missing Business context section');
    assert.ok(prompt.includes('We use an 8px grid.'), 'missing context content');
  });

  it('includes artifact content under Flow context section', async () => {
    const prompt = await buildPrompt({
      agentPath: agentFile,
      skillPaths: [],
      contextPaths: [],
      templatePath: null,
      flowContext: { flow: { input: 'Research this topic', id: 'ux-brief' }, step: { id: 'ux-detail' }, track: {} },
      artifacts: { 'user-research': 'User research findings here.' },
      userFeedback: {},
    });
    assert.ok(prompt.includes('## Flow context'), 'missing Flow context section');
    assert.ok(prompt.includes('Research this topic'), 'missing flow input');
    assert.ok(prompt.includes('User research findings here.'), 'missing artifact content');
  });

  it('includes template content under Output structure section', async () => {
    const prompt = await buildPrompt({
      agentPath: agentFile,
      skillPaths: [],
      contextPaths: [],
      templatePath: templateFile,
      flowContext: { flow: { input: 'test', id: 'ux-brief' }, step: { id: 'directions' }, track: {} },
      artifacts: {},
      userFeedback: {},
    });
    assert.ok(prompt.includes('## Output structure'), 'missing Output structure section');
    assert.ok(prompt.includes('Document your direction here.'), 'missing template content');
  });

  it('interpolates variables in the assembled prompt', async () => {
    const prompt = await buildPrompt({
      agentPath: agentFile,
      skillPaths: [],
      contextPaths: [],
      templatePath: null,
      flowContext: {
        flow: { input: 'Mobile onboarding', id: 'ux-brief' },
        step: { id: 'ux-directions' },
        track: { name: 'minimalist', index: 1, total: 3 },
      },
      artifacts: {},
      userFeedback: {},
    });
    assert.ok(prompt.includes('Mobile onboarding'), 'flow.input not interpolated');
  });

  it('omits sections with no content (no skills = no Skills section)', async () => {
    const prompt = await buildPrompt({
      agentPath: agentFile,
      skillPaths: [],
      contextPaths: [],
      templatePath: null,
      flowContext: { flow: { input: 'test', id: 'x' }, step: { id: 'y' }, track: {} },
      artifacts: {},
      userFeedback: {},
    });
    assert.ok(!prompt.includes('## Skills'), 'Skills section should be absent when no skills');
  });

  it('includes user feedback decisions when present', async () => {
    const prompt = await buildPrompt({
      agentPath: agentFile,
      skillPaths: [],
      contextPaths: [],
      templatePath: null,
      flowContext: { flow: { input: 'test', id: 'x' }, step: { id: 'y' }, track: {} },
      artifacts: {},
      userFeedback: { 'user-research': { decisions: 'Skip SSO verification: yes', free: '' } },
    });
    assert.ok(prompt.includes('Skip SSO verification: yes'), 'user feedback decisions missing');
  });
});
