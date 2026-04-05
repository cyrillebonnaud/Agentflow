'use strict';

class WriteQueue {
  constructor() {
    this._queue = [];
    this._running = false;
  }

  /**
   * Enqueue an async function. Returns a promise that resolves/rejects
   * with the function's result. Functions run one at a time in FIFO order.
   * @param {() => Promise<any>} fn
   * @returns {Promise<any>}
   */
  enqueue(fn) {
    return new Promise((resolve, reject) => {
      this._queue.push({ fn, resolve, reject });
      this._drain();
    });
  }

  /**
   * Number of items waiting to run (not counting the currently running item).
   */
  get size() {
    return this._queue.length;
  }

  _drain() {
    if (this._running) return;
    const item = this._queue.shift();
    if (!item) return;

    this._running = true;
    Promise.resolve()
      .then(() => item.fn())
      .then(
        (result) => {
          item.resolve(result);
          this._running = false;
          this._drain();
        },
        (err) => {
          item.reject(err);
          this._running = false;
          this._drain();
        }
      );
  }
}

module.exports = { WriteQueue };
