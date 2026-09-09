#!/usr/bin/env node
/**
 * `npm run dev` — the app plus its Headroom proxy, in one command.
 *
 * The assistant's prompt compression (`src/lib/headroom.ts`) talks to a
 * Headroom proxy at `HEADROOM_BASE_URL` and is a no-op without one, so a dev
 * loop that never starts the proxy is a dev loop that never exercises the
 * compression path. This launcher starts `headroom proxy` next to `astro
 * dev`, points the Worker's env at it, and tears it down on exit.
 *
 * Behaviour, in order:
 *
 *   1. `HEADROOM_PROXY=off` skips everything and runs the app alone.
 *   2. `.dev.vars` (gitignored, read by `platformProxy` and `wrangler dev`)
 *      gains `HEADROOM_BASE_URL=http://localhost:<port>` — appended only,
 *      and only when the key appears in no form at all. A commented-out key
 *      reads as a deliberate disable and is left alone, as is anyone's own
 *      value pointing somewhere else.
 *   3. `headroom proxy --port <port>` starts. Missing CLI is not an error:
 *      one hint line, app runs uncompressed. A proxy that never opens its
 *      port (already running elsewhere, slow model download) is the same —
 *      the SDK's `fallback: true` means calls still answer.
 *   4. `astro dev` runs with any extra args passed after `--`.
 *
 * Knobs: `HEADROOM_PORT` (default 8787), `HEADROOM_PROXY=off`,
 * `--setup-only` (env wiring without starting anything, for smoke tests),
 * `--self-test` (exercises the `.dev.vars` editing against a temp dir).
 */

import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.HEADROOM_PORT) || 8787;
const BASE_URL = `http://localhost:${PORT}`;
const DISABLED = (process.env.HEADROOM_PROXY ?? '').trim().toLowerCase() === 'off';
const SETUP_ONLY = process.argv.includes('--setup-only');
const SELF_TEST = process.argv.includes('--self-test');
const EXTRA_ARGS = (() => {
  const cut = process.argv.indexOf('--');
  return cut === -1 ? [] : process.argv.slice(cut + 1);
})();

const say = (tag, text) => process.stdout.write(`[${tag}] ${text}\n`);

/** Whether `line` sets the key, commented or not — either form means hands off. */
const mentions = (line, key) => new RegExp(`^\\s*#?\\s*${key}\\s*=`).test(line);

/**
 * Make sure `dir/.dev.vars` points at the proxy, without touching anything
 * already there. Returns what happened, for the log line.
 */
export function ensureDevVars(dir, url, key = 'HEADROOM_BASE_URL') {
  const file = join(dir, '.dev.vars');
  const present = existsSync(file) ? readFileSync(file, 'utf8') : '';
  if (present.split('\n').some(line => mentions(line, key))) return 'kept';
  appendFileSync(file, `${present.endsWith('\n') || !present ? '' : '\n'}${key}=${url}\n`);
  return 'added';
}

const cliAvailable = () => {
  try {
    return spawnSync('headroom', ['--version'], { stdio: 'ignore' }).status === 0;
  } catch {
    return false;
  }
};

const waitForPort = (port, timeoutMs) =>
  new Promise(resolve => {
    const started = Date.now();
    const probe = () => {
      const socket = net.connect(port, '127.0.0.1');
      socket.once('connect', () => {
        socket.end();
        resolve(true);
      });
      socket.once('error', () => {
        socket.destroy();
        if (Date.now() - started > timeoutMs) resolve(false);
        else setTimeout(probe, 250);
      });
    };
    probe();
  });

/** Prefix a child's output so proxy lines and app lines stay tellable apart. */
function tagged(child, tag) {
  for (const [stream, source] of [['stdout', child.stdout], ['stderr', child.stderr]]) {
    if (!source) continue;
    let tail = '';
    source.on('data', chunk => {
      const lines = (tail + chunk.toString()).split('\n');
      tail = lines.pop() ?? '';
      for (const line of lines) process[stream].write(`[${tag}] ${line}\n`);
    });
  }
}

async function main() {
  if (DISABLED) {
    say('dev', 'HEADROOM_PROXY=off — proxy skipped, assistant runs uncompressed.');
    return runApp();
  }

  say('dev', `.dev.vars HEADROOM_BASE_URL ${ensureDevVars(root, BASE_URL)}.`);
  if (SETUP_ONLY) return;

  let proxy = null;
  if (!cliAvailable()) {
    say('dev', 'no `headroom` CLI found — app runs uncompressed.');
    say('dev', 'to enable: uv tool install --python 3.13 "headroom-ai[all]"');
  } else {
    proxy = spawn('headroom', ['proxy', '--port', String(PORT)], { cwd: root });
    tagged(proxy, 'headroom');
    proxy.once('exit', code => {
      /* An immediate exit usually means the port is already taken — quite
         possibly by a proxy from an earlier session, in which case everything
         below still works. Either way the app starts regardless. */
      proxy = null;
      say('dev', `proxy exited (code ${code}) — continuing, assistant runs uncompressed unless one is already up.`);
    });
    const up = await waitForPort(PORT, 20_000);
    say('dev', up ? `proxy up at ${BASE_URL}.` : `proxy did not open :${PORT} in time — continuing anyway.`);
  }

  await runApp(proxy);
}

/** Run `astro dev` to completion, taking the proxy down with it. */
function runApp(proxy) {
  return new Promise(resolve => {
    const app = spawn(process.execPath, [join(root, 'node_modules', 'astro', 'astro.js'), 'dev', ...EXTRA_ARGS], {
      cwd: root,
      stdio: 'inherit',
    });
    const stop = () => {
      try {
        proxy?.kill();
      } catch {
        /* Already gone. */
      }
    };
    process.once('SIGINT', () => {
      stop();
      app.kill('SIGINT');
    });
    process.once('SIGTERM', () => {
      stop();
      app.kill('SIGTERM');
    });
    app.once('exit', code => {
      stop();
      resolve(code ?? 0);
    });
  }).then(code => process.exit(code));
}

function selfTest() {
  const assert = (cond, name) => {
    if (!cond) {
      process.stderr.write(`self-test failed: ${name}\n`);
      process.exit(1);
    }
    say('self-test', `ok — ${name}`);
  };
  const dir = mkdtempSync(join(tmpdir(), 'dev-headroom-'));
  try {
    assert(ensureDevVars(dir, BASE_URL) === 'added', 'creates .dev.vars with the URL');
    assert(ensureDevVars(dir, BASE_URL) === 'kept', 'leaves an existing value alone');
    writeFileSync(join(dir, '.dev.vars'), '#HEADROOM_BASE_URL=\n');
    assert(ensureDevVars(dir, BASE_URL) === 'kept', 'a commented-out key reads as deliberate');
    writeFileSync(join(dir, '.dev.vars'), 'OTHER=1\n');
    assert(ensureDevVars(dir, BASE_URL) === 'added', 'appends without disturbing other vars');
    const text = readFileSync(join(dir, '.dev.vars'), 'utf8');
    assert(text.includes('OTHER=1') && text.includes(`HEADROOM_BASE_URL=${BASE_URL}`), 'both lines survive');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  say('self-test', 'all passed');
}

if (SELF_TEST) selfTest();
else await main();
