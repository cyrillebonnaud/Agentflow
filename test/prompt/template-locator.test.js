'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const { locateTemplate } = require('../../src/prompt/template-locator');

async function makeTmpDir() {
  const dir = path.join(os.tmpdir(), `af-tl-test-${crypto.randomBytes(4).toString('hex')}`);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

describe('locateTemplate', () => {
  let tmpDir;
  let localTemplatesDir;
  let pluginTemplatesDir;

  before(async () => {
    tmpDir = await makeTmpDir();
    localTemplatesDir = path.join(tmpDir, 'templates');
    pluginTemplatesDir = path.join(tmpDir, 'plugin-templates');
    await fs.mkdir(localTemplatesDir, { recursive: true });
    await fs.mkdir(pluginTemplatesDir, { recursive: true });

    // Write a template in local dir
    await fs.writeFile(path.join(localTemplatesDir, 'prd.md'), '# PRD Template (local)', 'utf8');
    // Write a same-named template in plugin dir (should be shadowed by local)
    await fs.writeFile(path.join(pluginTemplatesDir, 'prd.md'), '# PRD Template (plugin)', 'utf8');
    // Write a template only in plugin dir
    await fs.writeFile(path.join(pluginTemplatesDir, 'ux-brief.md'), '# UX Brief Template (plugin)', 'utf8');
    // Write a namespaced plugin template
    await fs.writeFile(path.join(pluginTemplatesDir, 'design-guide.md'), '# Design Guide (plugin)', 'utf8');
  });

  after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('returns local template path when it exists (priority over plugin)', async () => {
    // Build registry that also has prd.md in plugin
    const { buildRegistry } = require('../../src/registry/resolver');
    const registry = await buildRegistry({
      pluginDirs: [tmpDir],  // plugin root has templates subdir
      localTemplatesDir,
    });

    const result = await locateTemplate('prd.md', { localTemplatesDir, registry });
    assert.equal(result, path.join(localTemplatesDir, 'prd.md'));
  });

  it('falls back to registry template when not in local dir', async () => {
    const { buildRegistry } = require('../../src/registry/resolver');
    // Create a fake plugin dir with a templates/ subdir
    const pluginDir = path.join(tmpDir, 'myplugin');
    const pluginTmplDir = path.join(pluginDir, 'templates');
    await fs.mkdir(pluginTmplDir, { recursive: true });
    await fs.writeFile(path.join(pluginTmplDir, 'ux-brief.md'), '# UX Brief (plugin)', 'utf8');

    const registry = await buildRegistry({
      pluginDirs: [pluginDir],
      localTemplatesDir,
    });

    const result = await locateTemplate('ux-brief.md', { localTemplatesDir, registry });
    assert.ok(result, 'should return a non-null path');
    assert.equal(result, path.join(pluginTmplDir, 'ux-brief.md'));
  });

  it('returns null when template not found anywhere', async () => {
    const { buildRegistry } = require('../../src/registry/resolver');
    const registry = await buildRegistry({
      pluginDirs: [],
      localTemplatesDir,
    });

    const result = await locateTemplate('nonexistent.md', { localTemplatesDir, registry });
    assert.equal(result, null);
  });

  it('handles namespaced ref "pluginName/file.md" via registry', async () => {
    const { buildRegistry } = require('../../src/registry/resolver');
    const pluginDir = path.join(tmpDir, 'design-team');
    const pluginTmplDir = path.join(pluginDir, 'templates');
    await fs.mkdir(pluginTmplDir, { recursive: true });
    await fs.writeFile(path.join(pluginTmplDir, 'ux-brief.md'), '# UX Brief (design-team plugin)', 'utf8');

    const registry = await buildRegistry({
      pluginDirs: [pluginDir],
      localTemplatesDir,
    });

    // 'design-team/ux-brief.md' should resolve to the plugin template
    const result = await locateTemplate('design-team/ux-brief.md', { localTemplatesDir, registry });
    assert.ok(result, 'should return a path for namespaced ref');
    assert.equal(result, path.join(pluginTmplDir, 'ux-brief.md'));
  });

  it('returns null when templateRef is null', async () => {
    const { buildRegistry } = require('../../src/registry/resolver');
    const registry = await buildRegistry({ pluginDirs: [], localTemplatesDir });

    const result = await locateTemplate(null, { localTemplatesDir, registry });
    assert.equal(result, null);
  });

  it('uses absolute path as-is when accessible', async () => {
    const absFile = path.join(tmpDir, 'absolute-template.md');
    await fs.writeFile(absFile, '# Absolute Template', 'utf8');

    const { buildRegistry } = require('../../src/registry/resolver');
    const registry = await buildRegistry({ pluginDirs: [], localTemplatesDir });

    const result = await locateTemplate(absFile, { localTemplatesDir, registry });
    assert.equal(result, absFile);
  });
});
