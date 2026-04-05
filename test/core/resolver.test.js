'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { buildRegistry, resolveAgent, resolveTemplate } = require('../../src/registry/resolver');

/**
 * Creates a temporary plugin directory with the given structure.
 * structure: { agents: ['name.md'], skills: [], context: [], templates: ['tpl.md'] }
 */
async function makePlugin(pluginName, structure = {}) {
  const suffix = crypto.randomBytes(4).toString('hex');
  const pluginDir = path.join(os.tmpdir(), `resolver-test-${suffix}`, pluginName);

  const subdirs = ['agents', 'skills', 'context', 'templates'];
  for (const sub of subdirs) {
    await fs.mkdir(path.join(pluginDir, sub), { recursive: true });
  }

  for (const [subdir, files] of Object.entries(structure)) {
    for (const file of files) {
      await fs.writeFile(path.join(pluginDir, subdir, file), `# ${file}`, 'utf8');
    }
  }

  return pluginDir;
}

async function makeTmpDir() {
  const suffix = crypto.randomBytes(4).toString('hex');
  const dir = path.join(os.tmpdir(), `resolver-local-${suffix}`);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

test('buildRegistry discovers agents from pluginDirs', async () => {
  const plugin = await makePlugin('plugin-a', {
    agents: ['writer.md', 'reviewer.md'],
  });

  const registry = await buildRegistry({ pluginDirs: [plugin], localTemplatesDir: null });

  assert.ok(registry.agents instanceof Map);
  assert.ok(registry.agents.has('writer'), 'should have agent "writer"');
  assert.ok(registry.agents.has('reviewer'), 'should have agent "reviewer"');

  const writer = registry.agents.get('writer');
  assert.equal(writer.plugin, path.basename(plugin));
  assert.ok(writer.path.endsWith('writer.md'));
});

test('buildRegistry discovers templates from multiple plugins', async () => {
  const plugin1 = await makePlugin('plugin-1', {
    templates: ['brief.md'],
  });
  const plugin2 = await makePlugin('plugin-2', {
    templates: ['report.html'],
  });

  const registry = await buildRegistry({ pluginDirs: [plugin1, plugin2], localTemplatesDir: null });

  assert.ok(registry.templates.has('brief'), 'should have template "brief"');
  assert.ok(registry.templates.has('report'), 'should have template "report"');
});

test('local templates override plugin templates with same id', async () => {
  const plugin = await makePlugin('plugin-b', {
    templates: ['shared.md'],
  });

  const localDir = await makeTmpDir();
  await fs.writeFile(path.join(localDir, 'shared.md'), '# local version', 'utf8');

  const registry = await buildRegistry({
    pluginDirs: [plugin],
    localTemplatesDir: localDir,
  });

  const tpl = registry.templates.get('shared');
  assert.ok(tpl, 'template "shared" should exist');
  assert.equal(tpl.plugin, 'local', 'local template should have plugin = "local"');
  assert.ok(tpl.path.startsWith(localDir), 'path should point to local dir');
});

test('resolveAgent throws for unknown agent', async () => {
  const plugin = await makePlugin('plugin-c', { agents: ['known.md'] });
  const registry = await buildRegistry({ pluginDirs: [plugin], localTemplatesDir: null });

  await assert.rejects(
    () => resolveAgent(registry, 'unknown-agent'),
    (err) => {
      assert.ok(err instanceof Error);
      assert.ok(
        err.message.includes('unknown-agent'),
        `Expected agent id in error: ${err.message}`
      );
      return true;
    }
  );
});

test('resolveTemplate with namespace "plugin/file.md" finds correct template', async () => {
  const plugin1 = await makePlugin('alpha', { templates: ['report.md'] });
  const plugin2 = await makePlugin('beta', { templates: ['report.md'] });

  const registry = await buildRegistry({
    pluginDirs: [plugin1, plugin2],
    localTemplatesDir: null,
  });

  // Use full namespace to pick the one from beta
  const alphaName = path.basename(plugin1);
  const betaName = path.basename(plugin2);

  const result = await resolveTemplate(registry, `${betaName}/report.md`);
  assert.ok(result, 'should find template');
  assert.equal(result.plugin, betaName, `Expected plugin "${betaName}", got "${result.plugin}"`);
});

test('resolveTemplate without namespace returns first match', async () => {
  const plugin1 = await makePlugin('first', { templates: ['summary.md'] });
  const plugin2 = await makePlugin('second', { templates: ['summary.md'] });

  const registry = await buildRegistry({
    pluginDirs: [plugin1, plugin2],
    localTemplatesDir: null,
  });

  // Without namespace, should return whichever was registered first (plugin1)
  const result = await resolveTemplate(registry, 'summary.md');
  assert.ok(result, 'should find template');
  // First plugin wins
  const firstName = path.basename(plugin1);
  assert.equal(result.plugin, firstName, `Expected first plugin "${firstName}", got "${result.plugin}"`);
});
