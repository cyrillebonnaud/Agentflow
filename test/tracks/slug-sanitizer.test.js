'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { sanitizeSlug, ensureUnique } = require('../../src/tracks/slug-sanitizer');

test('sanitizeSlug: lowercase conversion', () => {
  assert.equal(sanitizeSlug('Hello World'), 'hello-world');
  assert.equal(sanitizeSlug('FOO BAR'), 'foo-bar');
  assert.equal(sanitizeSlug('MixedCase'), 'mixedcase');
});

test('sanitizeSlug: spaces become hyphens', () => {
  assert.equal(sanitizeSlug('foo bar baz'), 'foo-bar-baz');
  assert.equal(sanitizeSlug('a b'), 'a-b');
});

test('sanitizeSlug: special chars become hyphens', () => {
  assert.equal(sanitizeSlug('hello!world'), 'hello-world');
  assert.equal(sanitizeSlug('foo@bar.baz'), 'foo-bar-baz');
  assert.equal(sanitizeSlug('a/b\\c'), 'a-b-c');
  assert.equal(sanitizeSlug('$pecial#chars'), 'pecial-chars');
});

test('sanitizeSlug: consecutive hyphens collapsed to one', () => {
  assert.equal(sanitizeSlug('foo--bar'), 'foo-bar');
  assert.equal(sanitizeSlug('a   b'), 'a-b');
  assert.equal(sanitizeSlug('hello!! world'), 'hello-world');
});

test('sanitizeSlug: leading and trailing hyphens trimmed', () => {
  assert.equal(sanitizeSlug('-foo-'), 'foo');
  assert.equal(sanitizeSlug('!leading'), 'leading');
  assert.equal(sanitizeSlug('trailing!'), 'trailing');
  assert.equal(sanitizeSlug('--both--'), 'both');
});

test('sanitizeSlug: truncated to 40 chars', () => {
  const long = 'this is a very long string that exceeds the forty character limit easily';
  const result = sanitizeSlug(long);
  assert.ok(result.length <= 40, `Expected length <= 40, got ${result.length}`);
});

test('sanitizeSlug: truncation at word boundary when possible', () => {
  // "word-boundary-truncation-should-happen-here" is 43 chars
  const input = 'word boundary truncation should happen here';
  const result = sanitizeSlug(input);
  assert.ok(result.length <= 40);
  // should not end with a partial word followed by hyphen
  assert.ok(!result.endsWith('-'), `Should not end with hyphen: "${result}"`);
});

test('sanitizeSlug: exact 40 chars passes through', () => {
  // 40 chars of lowercase letters
  const input = 'a'.repeat(40);
  assert.equal(sanitizeSlug(input), 'a'.repeat(40));
});

test('ensureUnique: returns original if not in set', () => {
  const existing = new Set(['foo', 'bar']);
  assert.equal(ensureUnique('baz', existing), 'baz');
  assert.equal(ensureUnique('qux', new Set()), 'qux');
});

test('ensureUnique: appends -2 on first conflict', () => {
  const existing = new Set(['my-slug']);
  assert.equal(ensureUnique('my-slug', existing), 'my-slug-2');
});

test('ensureUnique: appends -3 when -2 also conflicts', () => {
  const existing = new Set(['my-slug', 'my-slug-2']);
  assert.equal(ensureUnique('my-slug', existing), 'my-slug-3');
});

test('ensureUnique: keeps incrementing until unique', () => {
  const existing = new Set(['x', 'x-2', 'x-3', 'x-4']);
  assert.equal(ensureUnique('x', existing), 'x-5');
});
