'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { validatePath, validatePaths } = require('../../src/registry/filepath-validator');

async function makeTmpFile() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'filepath-validator-test-'));
  const filePath = path.join(dir, 'exists.txt');
  await fs.writeFile(filePath, 'hello', 'utf8');
  return filePath;
}

test('validatePath resolves for an existing file', async () => {
  const filePath = await makeTmpFile();
  // Should not throw
  await assert.doesNotReject(() => validatePath(filePath, 'my-label'));
});

test('validatePath throws with label in message for missing file', async () => {
  const missing = '/tmp/agentflow-nonexistent-file-xyz123.txt';
  await assert.rejects(
    () => validatePath(missing, 'my-label'),
    (err) => {
      assert.ok(err instanceof Error);
      assert.ok(
        err.message.includes('my-label'),
        `Expected label in error message, got: ${err.message}`
      );
      assert.ok(
        err.message.includes(missing),
        `Expected file path in error message, got: ${err.message}`
      );
      return true;
    }
  );
});

test('validatePaths collects ALL errors, not just first', async () => {
  const missing1 = '/tmp/agentflow-missing-a-xyz.txt';
  const missing2 = '/tmp/agentflow-missing-b-xyz.txt';

  await assert.rejects(
    () =>
      validatePaths([
        { path: missing1, label: 'file-a' },
        { path: missing2, label: 'file-b' },
      ]),
    (err) => {
      assert.ok(err instanceof AggregateError, `Expected AggregateError, got ${err.constructor.name}`);
      assert.equal(err.errors.length, 2, `Expected 2 errors, got ${err.errors.length}`);
      const messages = err.errors.map((e) => e.message);
      assert.ok(messages.some((m) => m.includes('file-a')), 'Should include error for file-a');
      assert.ok(messages.some((m) => m.includes('file-b')), 'Should include error for file-b');
      return true;
    }
  );
});

test('validatePaths resolves when all paths exist', async () => {
  const file1 = await makeTmpFile();
  const file2 = await makeTmpFile();

  await assert.doesNotReject(() =>
    validatePaths([
      { path: file1, label: 'first' },
      { path: file2, label: 'second' },
    ])
  );
});
