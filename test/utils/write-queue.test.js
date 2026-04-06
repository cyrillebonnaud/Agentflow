'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { WriteQueue } = require('../../src/utils/write-queue');

test('enqueued functions execute in FIFO order', async () => {
  const queue = new WriteQueue();
  const order = [];

  await Promise.all([
    queue.enqueue(async () => { order.push(1); }),
    queue.enqueue(async () => { order.push(2); }),
    queue.enqueue(async () => { order.push(3); }),
  ]);

  assert.deepEqual(order, [1, 2, 3]);
});

test('concurrent enqueues serialize execution', async () => {
  const queue = new WriteQueue();
  let running = 0;
  let maxConcurrent = 0;

  const fn = async () => {
    running++;
    maxConcurrent = Math.max(maxConcurrent, running);
    // Yield to event loop to allow other tasks to interleave if not serialized
    await new Promise(resolve => setImmediate(resolve));
    running--;
  };

  await Promise.all([
    queue.enqueue(fn),
    queue.enqueue(fn),
    queue.enqueue(fn),
    queue.enqueue(fn),
  ]);

  assert.equal(maxConcurrent, 1, 'only one function should run at a time');
});

test('a failing fn does not block subsequent items', async () => {
  const queue = new WriteQueue();
  const results = [];

  const p1 = queue.enqueue(async () => {
    throw new Error('intentional failure');
  });

  const p2 = queue.enqueue(async () => {
    results.push('second ran');
    return 'second';
  });

  // p1 should reject
  await assert.rejects(p1, /intentional failure/);
  // p2 should still resolve
  const val = await p2;
  assert.equal(val, 'second');
  assert.deepEqual(results, ['second ran']);
});

test('enqueue returns the value returned by fn', async () => {
  const queue = new WriteQueue();

  const result = await queue.enqueue(async () => 42);
  assert.equal(result, 42);

  const obj = { foo: 'bar' };
  const result2 = await queue.enqueue(async () => obj);
  assert.equal(result2, obj);
});

test('size reflects the number of pending (not-yet-started) items', async () => {
  const queue = new WriteQueue();
  const sizes = [];

  // Enqueue a slow first item that records sizes while it's running
  let resolveFirst;
  const firstDone = new Promise(r => { resolveFirst = r; });

  const p1 = queue.enqueue(async () => {
    // At this point p2 and p3 are enqueued but not yet started
    sizes.push(queue.size);
    resolveFirst();
  });

  // Enqueue two more immediately
  const p2 = queue.enqueue(async () => {});
  const p3 = queue.enqueue(async () => {});

  // Size should be 2 before the first item finishes (p2 and p3 pending)
  await firstDone;
  assert.equal(sizes[0], 2);

  await Promise.all([p1, p2, p3]);
  assert.equal(queue.size, 0);
});
