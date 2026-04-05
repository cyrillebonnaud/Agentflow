'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { SubprocessPool } = require('../../src/subprocess/subprocess-pool');

describe('SubprocessPool', () => {
  it('allows acquiring a slot when under limits', async () => {
    const pool = new SubprocessPool({ maxTotal: 4, maxLead: 2, maxReviewer: 2, maxModerator: 2 });
    const release = await pool.acquire('lead');
    assert.equal(pool.stats.counts.lead, 1);
    assert.equal(pool.stats.totalCount, 1);
    release();
    assert.equal(pool.stats.counts.lead, 0);
    assert.equal(pool.stats.totalCount, 0);
  });

  it('blocks when per-type limit is reached, unblocks on release', async () => {
    const pool = new SubprocessPool({ maxTotal: 10, maxLead: 1, maxReviewer: 4, maxModerator: 4 });

    const release1 = await pool.acquire('lead');
    assert.equal(pool.stats.counts.lead, 1);

    // This should queue because maxLead=1
    let release2Received = false;
    const p2 = pool.acquire('lead').then(r => {
      release2Received = true;
      return r;
    });

    await new Promise(r => setTimeout(r, 20));
    assert.equal(release2Received, false, 'should be blocked');

    release1(); // free up slot
    const release2 = await p2;
    assert.ok(release2Received, 'should unblock after release');
    release2();
  });

  it('blocks when total limit is reached', async () => {
    const pool = new SubprocessPool({ maxTotal: 2, maxLead: 4, maxReviewer: 4, maxModerator: 4 });

    const r1 = await pool.acquire('lead');
    const r2 = await pool.acquire('reviewer');
    assert.equal(pool.stats.totalCount, 2);

    let r3Received = false;
    const p3 = pool.acquire('moderator').then(r => {
      r3Received = true;
      return r;
    });

    await new Promise(r => setTimeout(r, 20));
    assert.equal(r3Received, false, 'should be blocked by total limit');

    r1(); // release one
    const r3 = await p3;
    assert.ok(r3Received, 'should unblock after a slot frees');
    r2(); r3();
  });

  it('processes queued jobs in priority order: lead before reviewer before moderator', async () => {
    const pool = new SubprocessPool({ maxTotal: 1, maxLead: 1, maxReviewer: 1, maxModerator: 1 });

    // Occupy the only slot
    const r0 = await pool.acquire('lead');

    const order = [];
    const pLead = pool.acquire('lead').then(r => { order.push('lead'); return r; });
    const pReviewer = pool.acquire('reviewer').then(r => { order.push('reviewer'); return r; });
    const pModerator = pool.acquire('moderator').then(r => { order.push('moderator'); return r; });

    await new Promise(r => setTimeout(r, 20));
    assert.deepEqual(order, [], 'nothing should run yet');

    r0(); // release slot — should unblock 'lead' first
    const rLead = await pLead;
    assert.deepEqual(order, ['lead'], 'lead should go first');
    rLead();

    const rReviewer = await pReviewer;
    assert.deepEqual(order, ['lead', 'reviewer'], 'reviewer second');
    rReviewer();

    const rModerator = await pModerator;
    assert.deepEqual(order, ['lead', 'reviewer', 'moderator'], 'moderator last');
    rModerator();
  });

  it('stats.queued reflects waiting jobs', async () => {
    const pool = new SubprocessPool({ maxTotal: 1, maxLead: 1, maxReviewer: 1, maxModerator: 1 });
    const r0 = await pool.acquire('lead');
    pool.acquire('reviewer'); // queued
    pool.acquire('moderator'); // queued
    await new Promise(r => setTimeout(r, 10));
    assert.equal(pool.stats.queued.reviewer, 1);
    assert.equal(pool.stats.queued.moderator, 1);
    r0();
  });
});
