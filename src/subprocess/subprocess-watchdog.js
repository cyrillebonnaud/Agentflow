'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

/**
 * Monitors subprocess PIDs and enforces timeouts.
 * Writes .failed sentinel if a process dies without leaving a sentinel,
 * or if the timeout elapses.
 *
 * Usage:
 *   const watchdog = new Watchdog({ pollIntervalMs: 5000 });
 *   watchdog.register(sentinelDir, timeoutMs);
 *   watchdog.start();
 *   // later:
 *   watchdog.deregister(sentinelDir);
 *   watchdog.stop();
 */
class Watchdog {
  constructor({ pollIntervalMs = 5000 } = {}) {
    this._pollIntervalMs = pollIntervalMs;
    this._entries = new Map(); // sentinelDir -> { timeoutMs, registeredAt }
    this._interval = null;
  }

  /**
   * Register a sentinel directory for watchdog monitoring.
   * @param {string} sentinelDir
   * @param {number} timeoutMs
   */
  register(sentinelDir, timeoutMs) {
    this._entries.set(sentinelDir, {
      timeoutMs,
      registeredAt: Date.now(),
    });
  }

  /**
   * Deregister a sentinel directory (subprocess completed normally).
   * @param {string} sentinelDir
   */
  deregister(sentinelDir) {
    this._entries.delete(sentinelDir);
  }

  /**
   * Start the watchdog polling loop.
   */
  start() {
    if (this._interval) return;
    this._interval = setInterval(() => this._tick(), this._pollIntervalMs);
  }

  /**
   * Stop the watchdog.
   */
  stop() {
    if (this._interval) {
      clearInterval(this._interval);
      this._interval = null;
    }
  }

  /**
   * Check all registered entries for dead processes or timeouts.
   */
  async _tick() {
    const now = Date.now();
    for (const [sentinelDir, entry] of this._entries) {
      // Skip if already has a sentinel
      const hasSentinel = await this._hasSentinel(sentinelDir);
      if (hasSentinel) {
        this.deregister(sentinelDir);
        continue;
      }

      // Check timeout
      const elapsed = now - entry.registeredAt;
      if (elapsed >= entry.timeoutMs) {
        await this._killAndFail(sentinelDir, 'timeout');
        continue;
      }

      // Check if PID is still alive
      const pid = await this._readPid(sentinelDir);
      if (pid !== null && !isAlive(pid)) {
        await this._killAndFail(sentinelDir, 'process_died');
      }
    }
  }

  async _hasSentinel(sentinelDir) {
    for (const s of ['.done', '.failed']) {
      try {
        await fs.access(path.join(sentinelDir, s));
        return true;
      } catch {}
    }
    return false;
  }

  async _readPid(sentinelDir) {
    try {
      const raw = await fs.readFile(path.join(sentinelDir, '.pid'), 'utf8');
      const pid = parseInt(raw.trim(), 10);
      return isNaN(pid) ? null : pid;
    } catch {
      return null;
    }
  }

  async _killAndFail(sentinelDir, reason) {
    const pid = await this._readPid(sentinelDir);
    if (pid !== null) {
      try { process.kill(pid, 'SIGTERM'); } catch {}
    }
    this.deregister(sentinelDir);
    const failedPath = path.join(sentinelDir, '.failed');
    await fs.writeFile(
      failedPath,
      JSON.stringify({ reason, pid }, null, 2),
      'utf8'
    ).catch(() => {});
  }
}

/**
 * Check if a process is alive by sending signal 0.
 */
function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

module.exports = { Watchdog };
