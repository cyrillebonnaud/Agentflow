'use strict';

const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');

/**
 * Spawns a subprocess (Claude or a test stand-in), writes sentinel files.
 *
 * The subprocess is expected to write a single JSON line to stdout:
 *   { type: "result", subtype: "success"|"error", is_error: boolean, result: string }
 *
 * Files written to sentinelDir:
 *   prompt.md   — the promptContent, written before spawn
 *   .pid        — the subprocess PID, written immediately after spawn
 *   output.md   — result text from subprocess (on success)
 *   .done       — JSON { result, cost_usd, session_id } on success
 *   .failed     — JSON { reason, error, exit_code } on failure/timeout
 *
 * @param {object} opts
 * @param {string}   opts.sentinelDir   - directory where all files are written
 * @param {string}   opts.promptContent - content to write to prompt.md
 * @param {string}   [opts.command]     - executable to spawn (default: 'claude')
 * @param {string[]} [opts.args]        - arguments to pass to the command
 * @param {number}   [opts.timeout]     - timeout in ms (default: 120000)
 * @returns {Promise<void>} resolves when subprocess completes (success or failure)
 */
async function spawnSubprocess({
  sentinelDir,
  promptContent,
  command = 'claude',
  args = ['--print', '--output-format', 'json', '--tools', ''],
  timeout = 120000,
}) {
  // Write prompt.md before spawning
  await fs.writeFile(path.join(sentinelDir, 'prompt.md'), promptContent, 'utf8');

  return new Promise((resolve) => {
    const proc = spawn(command, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      // Run in the sentinelDir (outside the project git repo) so that
      // any git-checking hooks don't fire for the parent repo.
      cwd: sentinelDir,
    });

    // Feed the prompt via stdin then close it
    proc.stdin.write(promptContent, 'utf8');
    proc.stdin.end();

    // Write .pid immediately
    fs.writeFile(path.join(sentinelDir, '.pid'), String(proc.pid), 'utf8').catch(() => {});

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(async () => {
      timedOut = true;
      try { proc.kill('SIGTERM'); } catch {}
      await writeFailed(sentinelDir, { reason: 'timeout', pid: proc.pid });
      resolve();
    }, timeout);

    proc.stdout.on('data', chunk => { stdout += chunk; });
    proc.stderr.on('data', chunk => { stderr += chunk; });

    proc.on('close', async (code) => {
      if (timedOut) return;
      clearTimeout(timer);

      // Try to parse JSON result from stdout
      let parsed = null;
      try {
        const line = stdout.trim().split('\n').pop();
        parsed = JSON.parse(line);
      } catch {
        // not valid JSON
      }

      if (parsed && !parsed.is_error) {
        const resultText = parsed.result ?? '';
        await fs.writeFile(path.join(sentinelDir, 'output.md'), resultText, 'utf8');
        await writeDone(sentinelDir, {
          result: resultText,
          cost_usd: parsed.total_cost_usd ?? 0,
          session_id: parsed.session_id ?? null,
        });
      } else if (parsed && parsed.is_error) {
        await writeFailed(sentinelDir, {
          reason: 'error_result',
          error: parsed.result ?? 'Unknown error',
          exit_code: code,
        });
      } else {
        await writeFailed(sentinelDir, {
          reason: code === 0 ? 'invalid_output' : 'non_zero_exit',
          error: stderr.trim() || stdout.trim() || `Process exited with code ${code}`,
          exit_code: code,
        });
      }
      resolve();
    });

    proc.on('error', async (err) => {
      if (timedOut) return;
      clearTimeout(timer);
      await writeFailed(sentinelDir, { reason: 'spawn_error', error: err.message });
      resolve();
    });
  });
}

async function writeDone(sentinelDir, data) {
  await fs.writeFile(path.join(sentinelDir, '.done'), JSON.stringify(data, null, 2), 'utf8');
}

async function writeFailed(sentinelDir, data) {
  await fs.writeFile(path.join(sentinelDir, '.failed'), JSON.stringify(data, null, 2), 'utf8');
}

module.exports = { spawnSubprocess };
