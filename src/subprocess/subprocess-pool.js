'use strict';

/**
 * Manages subprocess concurrency limits.
 * Priorities: lead > reviewer > moderator
 *
 * Usage:
 *   const pool = new SubprocessPool({ maxTotal: 8, maxLead: 4, maxReviewer: 6, maxModerator: 4 });
 *   const release = await pool.acquire('lead');
 *   try { await doWork(); } finally { release(); }
 */
class SubprocessPool {
  constructor({
    maxTotal = 8,
    maxLead = 4,
    maxReviewer = 6,
    maxModerator = 4,
  } = {}) {
    this._limits = { lead: maxLead, reviewer: maxReviewer, moderator: maxModerator };
    this._maxTotal = maxTotal;
    this._counts = { lead: 0, reviewer: 0, moderator: 0 };
    this._totalCount = 0;
    // Each queue entry: { resolve: fn, type: string }
    this._queues = { lead: [], reviewer: [], moderator: [] };
  }

  /**
   * Acquire a slot for the given subprocess type.
   * Blocks until a slot is available.
   * Returns a release function — call it when the subprocess completes.
   *
   * @param {'lead'|'reviewer'|'moderator'} type
   * @returns {Promise<() => void>} release function
   */
  acquire(type) {
    return new Promise((resolve) => {
      const tryAcquire = () => {
        if (
          this._counts[type] < this._limits[type] &&
          this._totalCount < this._maxTotal
        ) {
          this._counts[type]++;
          this._totalCount++;
          const release = () => {
            this._counts[type]--;
            this._totalCount--;
            this._drain();
          };
          resolve(release);
          return true;
        }
        return false;
      };

      if (!tryAcquire()) {
        this._queues[type].push({ tryAcquire });
      }
    });
  }

  /**
   * Try to unblock waiting jobs in priority order: lead > reviewer > moderator.
   */
  _drain() {
    const priority = ['lead', 'reviewer', 'moderator'];
    for (const type of priority) {
      while (this._queues[type].length > 0) {
        const job = this._queues[type][0];
        if (job.tryAcquire()) {
          this._queues[type].shift();
        } else {
          break;
        }
      }
    }
  }

  get stats() {
    return {
      counts: { ...this._counts },
      totalCount: this._totalCount,
      queued: {
        lead: this._queues.lead.length,
        reviewer: this._queues.reviewer.length,
        moderator: this._queues.moderator.length,
      },
    };
  }
}

module.exports = { SubprocessPool };
