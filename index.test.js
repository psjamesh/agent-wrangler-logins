import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import extension from './index.js';
import { LoginStore } from './login-store.js';

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(fn) {
  for (let i = 0; i < 80; i++) { if (fn()) return; await pause(50); }
  assert.fail('Timed out waiting for metadata');
}
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'logins-manifest-'));
  const store = new LoginStore(root); const frames = [];
  const host = { stores: { logins: store }, broadcast: (msg) => frames.push(msg), rebuild: async () => {} };
  t.after(() => { extension.deactivate({ host }); fs.rmSync(root, { recursive: true, force: true }); });
  return { store, host, frames };
}

test('package and runtime manifest disclose matching capabilities and host API', () => {
  const pkg = JSON.parse(fs.readFileSync(new URL('./package.json', import.meta.url)));
  for (const key of ['id', 'label', 'description', 'author', 'requires', 'engines']) assert.deepEqual(extension[key], pkg.wranglerExtension[key]);
  assert.equal(extension.id, 'logins'); assert.equal(extension.defaultEnabled, false);
  assert.equal(extension.engines.wranglerApi, '^1.54.0');
  assert.equal(pkg.engines.node, '>=20');
  assert.equal(pkg.type, 'module');
  assert.equal(pkg.dependencies, undefined);
});

test('graph remains sanitized while scoped Settings metadata omits bindings', (t) => {
  const { store, host } = fixture(t);
  assert.deepEqual(extension.graph({ host }), { logins: { logins: [], sessions: {} } });
  store.add('Personal'); const dir = store.setUpClaude('personal'); store.bind('card', 'personal');
  assert.ok(!JSON.stringify(extension.graph({ host })).includes(dir));
});

test('production static imports stay inside this package and use only Node builtins', () => {
  const dir = path.dirname(fileURLToPath(import.meta.url)); const seen = new Set();
  const visit = (file) => {
    if (seen.has(file)) return; seen.add(file);
    for (const match of fs.readFileSync(file, 'utf8').matchAll(/(?:from\s*|import\s*\()\s*['"]([^'"]+)['"]/g)) {
      if (match[1].startsWith('node:')) continue;
      assert.ok(match[1].startsWith('./'), match[1]);
      const target = path.resolve(path.dirname(file), match[1]); assert.ok(target.startsWith(`${dir}/`), target); visit(target);
    }
  };
  visit(path.join(dir, 'index.js')); visit(path.join(dir, 'public/index.js'));
});

test('setup and a plaintext fallback publish Claude and Codex metadata to all tabs and deactivation closes watches', async (t) => {
  const { store, host, frames } = fixture(t); store.add('Personal');
  extension.activate({ host });
  const send = (type, msg) => extension.handlers.find((h) => h.type === type).handler(msg, host, () => {});
  host.terminals = { create: async () => ({ terminalId: 'term', reused: false }), alive: async () => true };
  await send('logins-login', { slug: 'personal', provider: 'claude' });
  await until(() => frames.some((f) => f.logins?.[0]?.claude.present));
  fs.writeFileSync(path.join(store.claudeDir('personal'), '.credentials.json'), 'fixture-private');
  await until(() => frames.some((f) => f.logins?.[0]?.claude.plaintext));
  await send('logins-login', { slug: 'personal', provider: 'codex' });
  await until(() => frames.some((f) => f.logins?.[0]?.codex.present));
  host.terminals.alive = async () => false;
  await until(() => frames.at(-1).logins?.[0]?.claude.terminal === false);
  assert.ok(!JSON.stringify(frames).includes('fixture-private'));
  assert.ok(frames.every((f) => !('sessions' in f)));
  extension.deactivate({ host }); await pause(200); const count = frames.length;
  store.forget('personal', 'codex'); await pause(200); assert.equal(frames.length, count);
});
