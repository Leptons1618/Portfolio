/**
 * Self-test for `mcp/portfolio-mcp.mjs`.
 *
 * It spawns the server and talks to it over a real pipe, because half of what
 * could be wrong here is not logic. A server that answers `initialize` with the
 * wrong shape, or writes one stray line to stdout, does not fail — it simply
 * never appears in the client, with no error anywhere that names the cause. So
 * this asserts the handshake, and it asserts that **every line the server emits
 * parses as JSON-RPC**, which is the guard against a `console.log` added later.
 *
 * The other half is the policy, and it is the reason this file is longer than the
 * handshake needs. Three gates stand between a conversation and this site, and
 * each one is a line somebody could delete while everything still worked:
 *
 *   - delete is *absent* unless switched on, not merely refused,
 *   - configuration is read-only unless switched on,
 *   - `apiKey` is refused whatever is switched on.
 *
 * All three are checked before any network call, which is what lets this run
 * against no site at all. The environment is pointed at a closed port and a
 * throwaway config directory so a bug here can never reach the real origin.
 */

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVER = fileURLToPath(new URL('../mcp/portfolio-mcp.mjs', import.meta.url));

/* Nowhere, and no credential: every assertion below is about a refusal that
   happens before a request is made, and pointing the test at the real site would
   be one bug away from writing to it. Port 9 is discard. */
const SAFE_ENV = {
  PORTFOLIO_SITE: 'http://127.0.0.1:9',
  PORTFOLIO_TOKEN: 'not-a-real-token',
  XDG_CONFIG_HOME: mkdtempSync(join(tmpdir(), 'portfolio-mcp-test-')),
};

let checks = 0;
const check = async (name, fn) => {
  await fn();
  checks += 1;
  process.stdout.write(`  ok  ${name}\n`);
};

/**
 * One server, one conversation.
 *
 * Returns a `send` that resolves with the matching response by id, plus the
 * collected stderr and a `lines` array of everything stdout carried.
 */
function connect(env = {}) {
  const child = spawn(process.execPath, [SERVER], {
    env: { ...process.env, ...SAFE_ENV, ...env },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  const pending = new Map();
  const lines = [];
  let errors = '';
  let buffer = '';

  child.stdout.setEncoding('utf8');
  child.stdout.on('data', chunk => {
    buffer += chunk;
    const parts = buffer.split('\n');
    buffer = parts.pop() ?? '';
    for (const line of parts) {
      if (!line.trim()) continue;
      lines.push(line);
      /* The guard against a stray log line: anything on stdout must be a
         JSON-RPC message, or the client sees a parse error and reports nothing. */
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        throw new Error(`server wrote a non-JSON line to stdout: ${line.slice(0, 120)}`);
      }
      assert.equal(message.jsonrpc, '2.0', 'every message declares jsonrpc 2.0');
      const settle = pending.get(message.id);
      if (settle) {
        pending.delete(message.id);
        settle(message);
      }
    }
  });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', chunk => {
    errors += chunk;
  });

  let nextId = 1;
  const send = (method, params) => {
    const id = nextId++;
    const wait = new Promise((resolve, reject) => {
      pending.set(id, resolve);
      setTimeout(() => reject(new Error(`no response to ${method} within 10s`)), 10_000).unref();
    });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    return wait;
  };
  const notify = method => child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method })}\n`);
  const raw = text => child.stdin.write(`${text}\n`);

  return {
    send,
    notify,
    raw,
    lines,
    stderr: () => errors,
    close: () => {
      child.stdin.end();
      return new Promise(resolve => child.on('exit', resolve));
    },
  };
}

/** A tools/call, unwrapped to the text the model would read. */
async function call(server, name, args) {
  const response = await server.send('tools/call', { name, arguments: args });
  assert.ok(response.result, `tools/call ${name} returned a result, not ${JSON.stringify(response.error)}`);
  return {
    isError: response.result.isError === true,
    text: response.result.content.map(part => part.text).join('\n'),
  };
}

const handshake = async server => {
  const response = await server.send('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'test', version: '0' },
  });
  server.notify('notifications/initialized');
  return response;
};

/* ---------- the handshake ---------- */

await check('initialize answers the shape a client expects', async () => {
  const server = connect();
  const { result } = await handshake(server);
  assert.equal(result.protocolVersion, '2025-06-18', 'a version we speak is echoed back');
  assert.ok(result.capabilities.tools, 'the tools capability is declared');
  assert.equal(result.serverInfo.name, 'portfolio');
  assert.match(result.instructions, /slug/i, 'the instructions carry the rules that matter');
  await server.close();
});

await check('an unknown protocol version is answered with ours, not refused', async () => {
  const server = connect();
  const { result } = await server.send('initialize', {
    protocolVersion: '1999-01-01',
    capabilities: {},
    clientInfo: { name: 'test', version: '0' },
  });
  assert.equal(result.protocolVersion, '2025-06-18');
  await server.close();
});

await check('a notification gets no reply, and ping does', async () => {
  const server = connect();
  await handshake(server);
  const before = server.lines.length;
  server.notify('notifications/initialized');
  const { result } = await server.send('ping');
  assert.deepEqual(result, {});
  assert.equal(server.lines.length, before + 1, 'exactly one message: the ping reply');
  await server.close();
});

await check('an unknown method is a JSON-RPC error, not a crash', async () => {
  const server = connect();
  await handshake(server);
  const response = await server.send('resources/list');
  assert.equal(response.error.code, -32601);
  // And the session is still usable afterwards.
  assert.deepEqual((await server.send('ping')).result, {});
  await server.close();
});

await check('a line that is not JSON does not end the session', async () => {
  const server = connect();
  await handshake(server);
  server.raw('this is not json');
  assert.deepEqual((await server.send('ping')).result, {});
  assert.match(server.stderr(), /could not parse/);
  await server.close();
});

/* ---------- the tool list ---------- */

await check('every tool is listed with a usable schema', async () => {
  const server = connect();
  await handshake(server);
  const { result } = await server.send('tools/list');
  const names = result.tools.map(tool => tool.name);
  assert.deepEqual(names.sort(), [
    'portfolio_create',
    'portfolio_get',
    'portfolio_list',
    'portfolio_logs',
    'portfolio_media',
    'portfolio_order',
    'portfolio_update',
    'portfolio_whoami',
  ]);
  for (const tool of result.tools) {
    assert.equal(tool.inputSchema.type, 'object', `${tool.name} has an object schema`);
    assert.ok(tool.description.length > 40, `${tool.name} says what it does`);
  }
  await server.close();
});

await check('delete is absent by default, not merely refused', async () => {
  /* Absent matters more than refused: a tool in the list is a tool a model will
     propose, and the owner then has to decline it every time. */
  const server = connect();
  await handshake(server);
  const { result } = await server.send('tools/list');
  assert.ok(!result.tools.some(tool => tool.name === 'portfolio_delete'));
  const refused = await call(server, 'portfolio_delete', { kind: 'journal', slug: 'x', confirm: true });
  assert.ok(refused.isError, 'and calling it anyway is refused');
  await server.close();
});

await check('delete appears when it is switched on, and still needs confirm', async () => {
  const server = connect({ PORTFOLIO_MCP_ALLOW_DELETE: '1' });
  await handshake(server);
  const { result } = await server.send('tools/list');
  const tool = result.tools.find(t => t.name === 'portfolio_delete');
  assert.ok(tool, 'listed once enabled');
  assert.match(tool.description, /NO COPY/, 'and it says the write cannot be undone');
  const unconfirmed = await call(server, 'portfolio_delete', { kind: 'journal', slug: 'a-post', confirm: false });
  assert.ok(unconfirmed.isError);
  assert.match(unconfirmed.text, /confirm/);
  await server.close();
});

/* ---------- the policy gates ---------- */

await check('configuration is read-only by default', async () => {
  const server = connect();
  await handshake(server);
  for (const [kind, slug] of [
    ['provider', 'openrouter'],
    ['doc', 'ai-assistant'],
    ['doc', 'journal-auto'],
  ]) {
    const refused = await call(server, 'portfolio_update', { kind, slug, fields: { label: 'x' } });
    assert.ok(refused.isError, `${kind}/${slug} is refused`);
    assert.match(refused.text, /configuration|read-only/i);
  }
  await server.close();
});

await check('content is not caught by the configuration gate', async () => {
  /* The gate has to let the actual job through. These get past policy and then
     fail on the network, which is the proof that policy was not what stopped
     them — the test points at a closed port on purpose. */
  const server = connect();
  await handshake(server);
  for (const [kind, slug] of [
    ['journal', 'a-post'],
    ['project', 'a-thing'],
    ['case-study', 'a-thing'],
    ['doc', 'resume'],
  ]) {
    const attempt = await call(server, 'portfolio_update', {
      kind,
      slug,
      ...(kind === 'doc' ? { fields: { summary: 'x' } } : { fields: { title: 'x' } }),
    });
    assert.ok(attempt.isError, 'it still fails — there is no site here');
    assert.doesNotMatch(attempt.text, /configuration|read-only/i, `${kind}/${slug} was not refused by policy`);
    assert.match(attempt.text, /reach|Not signed in/i, 'it got as far as the network');
  }
  await server.close();
});

await check('apiKey is refused even with configuration writes enabled', async () => {
  /* The one gate with no override. A credential should not travel through a
     conversation, and `PORTFOLIO_MCP_ALLOW_CONFIG` must not be read as consent
     to that. */
  const server = connect({ PORTFOLIO_MCP_ALLOW_CONFIG: '1' });
  await handshake(server);
  const refused = await call(server, 'portfolio_update', {
    kind: 'provider',
    slug: 'openrouter',
    fields: { apiKey: 'sk-should-never-be-sent' },
  });
  assert.ok(refused.isError);
  assert.match(refused.text, /will not write an API key/);
  // And the key itself is not echoed back into the transcript.
  assert.doesNotMatch(refused.text, /sk-should-never-be-sent/);
  // While an ordinary provider field now gets through policy to the network.
  const allowed = await call(server, 'portfolio_update', {
    kind: 'provider',
    slug: 'openrouter',
    fields: { label: 'Renamed' },
  });
  assert.doesNotMatch(allowed.text, /configuration|read-only/i);
  await server.close();
});

/* ---------- input validation, before the network ---------- */

await check('an unknown field is refused with the real list, never dropped', async () => {
  const server = connect();
  await handshake(server);
  const refused = await call(server, 'portfolio_create', {
    kind: 'project',
    slug: 'a-thing',
    fields: { repo_url: 'https://example.test' },
  });
  assert.ok(refused.isError);
  assert.match(refused.text, /Unknown field "repo_url"/);
  assert.match(refused.text, /repoUrl/, 'and it names what to write instead');
  await server.close();
});

await check('a malformed slug is refused before anything is written', async () => {
  const server = connect();
  await handshake(server);
  const refused = await call(server, 'portfolio_create', {
    kind: 'journal',
    slug: 'Not A Slug',
    fields: { title: 'x' },
  });
  assert.ok(refused.isError);
  assert.match(refused.text, /lowercase words joined by hyphens/);
  await server.close();
});

await check('an unknown tool is a protocol error naming it', async () => {
  const server = connect();
  await handshake(server);
  const response = await server.send('tools/call', { name: 'portfolio_drop_database', arguments: {} });
  assert.equal(response.error.code, -32602);
  assert.match(response.error.message, /Unknown tool/);
  await server.close();
});

await check('a documents update refuses a body rather than silently dropping it', async () => {
  const server = connect();
  await handshake(server);
  const refused = await call(server, 'portfolio_update', {
    kind: 'doc',
    slug: 'resume',
    fields: {},
    body: '## not a thing',
  });
  assert.ok(refused.isError);
  assert.match(refused.text, /no markdown body/);
  await server.close();
});

await check('nothing the server wrote to stdout was anything but protocol', async () => {
  /* Belt and braces: `connect()` throws on a non-JSON line as it arrives, so
     reaching here with lines collected is the assertion. This makes it explicit. */
  const server = connect();
  await handshake(server);
  await server.send('tools/list');
  assert.ok(server.lines.length >= 2);
  for (const line of server.lines) assert.doesNotThrow(() => JSON.parse(line));
  await server.close();
});

process.stdout.write(`\nmcp: ${checks} checks passed\n`);
