'use strict';

const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');

/**
 * Watches a sentinel directory for .done or .failed files.
 * Emits "done" or "failed" events with the parsed sentinel content.
 *
 * Usage:
 *   const watcher = new SentinelWatcher();
 *   watcher.watch(sentinelDir);
 *   watcher.on('done', ({ sentinelDir, content }) => { ... });
 *   watcher.on('failed', ({ sentinelDir, content }) => { ... });
 *   watcher.stop();
 */
class SentinelWatcher extends EventEmitter {
  constructor() {
    super();
    this._watchers = new Map(); // sentinelDir -> fs.FSWatcher
  }

  /**
   * Start watching a sentinel directory.
   * Also does an immediate check in case the sentinel was already written.
   * @param {string} sentinelDir
   */
  watch(sentinelDir) {
    if (this._watchers.has(sentinelDir)) return;

    // Immediate check
    this._check(sentinelDir).catch(() => {});

    try {
      const watcher = fsSync.watch(sentinelDir, async (event, filename) => {
        if (filename === '.done' || filename === '.failed') {
          await this._check(sentinelDir);
        }
      });
      watcher.on('error', () => this._unwatch(sentinelDir));
      this._watchers.set(sentinelDir, watcher);
    } catch {
      // Directory might not exist yet — polling fallback via poll()
    }
  }

  /**
   * Poll a sentinel directory at an interval (fallback for environments where fs.watch is unreliable).
   * @param {string} sentinelDir
   * @param {number} intervalMs
   */
  poll(sentinelDir, intervalMs = 1000) {
    if (this._watchers.has(sentinelDir)) return;
    const interval = setInterval(async () => {
      const resolved = await this._check(sentinelDir);
      if (resolved) clearInterval(interval);
    }, intervalMs);
    // Store as a pseudo-watcher (has a close method)
    this._watchers.set(sentinelDir, { close: () => clearInterval(interval) });
  }

  /**
   * Stop watching all sentinel directories.
   */
  stop() {
    for (const [, watcher] of this._watchers) {
      try { watcher.close(); } catch {}
    }
    this._watchers.clear();
  }

  /**
   * Stop watching a specific sentinel directory.
   */
  _unwatch(sentinelDir) {
    const watcher = this._watchers.get(sentinelDir);
    if (watcher) {
      try { watcher.close(); } catch {}
      this._watchers.delete(sentinelDir);
    }
  }

  /**
   * Check if .done or .failed exists in sentinelDir, emit event if found.
   * @returns {boolean} true if a sentinel was found
   */
  async _check(sentinelDir) {
    for (const sentinel of ['.done', '.failed']) {
      const filePath = path.join(sentinelDir, sentinel);
      try {
        const raw = await fs.readFile(filePath, 'utf8');
        let content = {};
        try { content = JSON.parse(raw); } catch {}
        this._unwatch(sentinelDir);
        this.emit(sentinel === '.done' ? 'done' : 'failed', { sentinelDir, content });
        return true;
      } catch {
        // File doesn't exist yet
      }
    }
    return false;
  }
}

module.exports = { SentinelWatcher };
