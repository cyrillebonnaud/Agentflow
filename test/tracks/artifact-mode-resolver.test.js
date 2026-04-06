'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { resolveArtifactMode, discoverTracks } = require('../../src/tracks/artifact-mode-resolver');

async function makeTmpDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'artifact-mode-test-'));
}

// --- resolveArtifactMode tests ---

test('resolveArtifactMode: returns delegated when artifact_type is set', () => {
  const step = { artifact_type: 'md', name: 'My Step' };
  assert.equal(resolveArtifactMode(step), 'delegated');
});

test('resolveArtifactMode: returns delegated for any artifact_type value', () => {
  assert.equal(resolveArtifactMode({ artifact_type: 'html' }), 'delegated');
  assert.equal(resolveArtifactMode({ artifact_type: 'txt' }), 'delegated');
});

test('resolveArtifactMode: returns declarative when artifacts array is set', () => {
  const step = { artifacts: [{ name: 'report', path: 'report.md' }] };
  assert.equal(resolveArtifactMode(step), 'declarative');
});

test('resolveArtifactMode: returns declarative for non-empty artifacts array', () => {
  const step = { artifacts: ['a.md', 'b.md'] };
  assert.equal(resolveArtifactMode(step), 'declarative');
});

test('resolveArtifactMode: throws when neither artifact_type nor artifacts set', () => {
  const step = { name: 'Incomplete Step' };
  assert.throws(
    () => resolveArtifactMode(step),
    /artifact_type|artifacts/i,
  );
});

test('resolveArtifactMode: throws when artifacts is an empty array', () => {
  const step = { artifacts: [] };
  assert.throws(
    () => resolveArtifactMode(step),
    /artifact_type|artifacts/i,
  );
});

test('resolveArtifactMode: artifact_type takes precedence over artifacts when both present', () => {
  const step = { artifact_type: 'md', artifacts: [{ name: 'x' }] };
  assert.equal(resolveArtifactMode(step), 'delegated');
});

// --- discoverTracks tests ---

test('discoverTracks: finds output.md files in track subdirs', async () => {
  const tmp = await makeTmpDir();
  const stepDir = path.join(tmp, 'step-01');

  // Create track-a with v1/lead/output.md
  const trackADir = path.join(stepDir, 'track-a', 'v1', 'lead');
  await fs.mkdir(trackADir, { recursive: true });
  await fs.writeFile(path.join(trackADir, 'output.md'), '# Track A\nSome content.', 'utf8');

  // Create track-b with v1/lead/output.md
  const trackBDir = path.join(stepDir, 'track-b', 'v1', 'lead');
  await fs.mkdir(trackBDir, { recursive: true });
  await fs.writeFile(path.join(trackBDir, 'output.md'), '# Track B\nOther content.', 'utf8');

  const sanitizeFn = (s) => s.toLowerCase();
  const tracks = await discoverTracks(stepDir, sanitizeFn, () => new Set());

  assert.equal(tracks.length, 2);
  const slugs = tracks.map((t) => t.sanitizedSlug).sort();
  assert.deepEqual(slugs, ['track-a', 'track-b']);
});

test('discoverTracks: reads slug from frontmatter when present', async () => {
  const tmp = await makeTmpDir();
  const stepDir = path.join(tmp, 'step-02');

  const trackDir = path.join(stepDir, 'subdir-001', 'v1', 'lead');
  await fs.mkdir(trackDir, { recursive: true });
  const content = `---
slug: my-custom-slug
---
# Content
`;
  await fs.writeFile(path.join(trackDir, 'output.md'), content, 'utf8');

  const sanitizeFn = (s) => s.toLowerCase().replace(/\s+/g, '-');
  const tracks = await discoverTracks(stepDir, sanitizeFn, () => new Set());

  assert.equal(tracks.length, 1);
  assert.equal(tracks[0].rawSlug, 'my-custom-slug');
  assert.equal(tracks[0].sanitizedSlug, 'my-custom-slug');
});

test('discoverTracks: falls back to dir name when no frontmatter slug', async () => {
  const tmp = await makeTmpDir();
  const stepDir = path.join(tmp, 'step-03');

  const trackDir = path.join(stepDir, 'my-track-dir', 'v1', 'lead');
  await fs.mkdir(trackDir, { recursive: true });
  await fs.writeFile(
    path.join(trackDir, 'output.md'),
    '# No frontmatter\nJust content.',
    'utf8',
  );

  const sanitizeFn = (s) => s;
  const tracks = await discoverTracks(stepDir, sanitizeFn, () => new Set());

  assert.equal(tracks.length, 1);
  assert.equal(tracks[0].rawSlug, 'my-track-dir');
  assert.equal(tracks[0].sanitizedSlug, 'my-track-dir');
});

test('discoverTracks: skips subdirs without v1/lead/output.md', async () => {
  const tmp = await makeTmpDir();
  const stepDir = path.join(tmp, 'step-04');

  // valid track
  const validDir = path.join(stepDir, 'valid-track', 'v1', 'lead');
  await fs.mkdir(validDir, { recursive: true });
  await fs.writeFile(path.join(validDir, 'output.md'), '# Valid', 'utf8');

  // dir without the expected structure
  const emptyDir = path.join(stepDir, 'no-output');
  await fs.mkdir(emptyDir, { recursive: true });

  // dir with wrong structure
  const wrongDir = path.join(stepDir, 'wrong-struct', 'v1');
  await fs.mkdir(wrongDir, { recursive: true });
  await fs.writeFile(path.join(wrongDir, 'output.md'), '# Wrong location', 'utf8');

  const sanitizeFn = (s) => s;
  const tracks = await discoverTracks(stepDir, sanitizeFn, () => new Set());

  assert.equal(tracks.length, 1);
  assert.equal(tracks[0].sanitizedSlug, 'valid-track');
});

test('discoverTracks: returns outputPath for each track', async () => {
  const tmp = await makeTmpDir();
  const stepDir = path.join(tmp, 'step-05');

  const trackDir = path.join(stepDir, 'alpha', 'v1', 'lead');
  await fs.mkdir(trackDir, { recursive: true });
  await fs.writeFile(path.join(trackDir, 'output.md'), '# Alpha', 'utf8');

  const sanitizeFn = (s) => s;
  const tracks = await discoverTracks(stepDir, sanitizeFn, () => new Set());

  assert.equal(tracks.length, 1);
  assert.equal(tracks[0].outputPath, path.join(trackDir, 'output.md'));
});
