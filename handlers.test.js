import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LoginStore } from './login-store.js';
import { HANDLERS } from './handlers.js';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-login-handlers-'));
  const calls = []; const frames = []; const replies = []; const store = new LoginStore(root); const live = new Set();
  const host = {
    stores: { logins: store },
    terminals: { create: async (opts) => { calls.push(opts); const terminalId = `term-${calls.length}`; live.add(terminalId); return { terminalId, reused: false }; }, alive: async (id) => live.has(id) },
    rebuild: async () => { host.rebuilds++; }, rebuilds: 0, broadcast: (frame) => frames.push(frame),
  };
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const send = (type, msg = {}) => HANDLERS.find((h) => h.type === type).handler(msg, host, (frame) => replies.push(frame));
  return { store, host, calls, send, frames, replies, live };
}

test('management handlers add, forget and remove without erasing bindings', async (t) => {
  const { store, host, send } = fixture(t);
  await send('logins-add', { label: 'Personal' });
  assert.equal(host.rebuilds, 1);
  store.setUpClaude('personal');
  await send('logins-forget', { slug: 'personal', provider: 'claude' });
  assert.equal(store.get('personal').claude.present, false);
  store.bind('card', 'personal');
  await send('logins-remove', { slug: 'personal' });
  assert.equal(store.get('personal'), null);
  assert.equal(store.loginFor('card'), 'personal');
  assert.equal(HANDLERS.some((h) => h.type === 'logins-set-claude-token'), false);
});

test('Log in opens a keyed dialog with paths only; Claude runs native login in its own config dir', async (t) => {
  const { store, calls, send, replies } = fixture(t);
  await send('logins-add', { label: 'Personal' });
  await send('logins-login', { slug: 'personal', provider: 'codex' });
  assert.deepEqual({ ...calls[0], command: undefined }, { cwd: store.dir('personal'), command: undefined, presentation: 'dialog', title: 'Codex login: Personal', key: 'codex:personal' });
  const home = store.codexDir('personal');
  assert.ok(calls[0].command.endsWith(`login.js' 'codex' '${home}'`));
  assert.equal(replies.at(-1).logins[0].codex.present, true);
  assert.equal(fs.existsSync(path.join(home, 'auth.json')), false);
  await send('logins-login', { slug: 'personal', provider: 'claude' });
  const dir = store.claudeDir('personal');
  assert.equal(calls[1].presentation, 'dialog'); assert.equal(calls[1].key, 'claude:personal'); assert.equal(calls[1].title, 'Claude login: Personal');
  assert.ok(calls[1].command.endsWith(`login.js' 'claude' '${dir}'`));
  assert.doesNotMatch(calls[1].command, /setup-token|tee|TOKEN=/);
  assert.equal(replies.at(-1).logins[0].claude.present, true);
  await send('logins-login', { slug: 'personal', provider: 'claude' });
  assert.equal(store.claudeDir('personal'), dir);
  await send('logins-login', { slug: 'personal', provider: 'codex' });
  assert.equal(calls.at(-1).command, calls[0].command);
  await send('logins-forget', { slug: 'personal', provider: 'codex' });
  await send('logins-login', { slug: 'personal', provider: 'codex' });
  assert.notEqual(store.codexDir('personal'), home);
  await send('logins-login', { slug: 'absent', provider: 'claude' });
  assert.match(replies.at(-1).error, /no longer exists/);
  await send('logins-login', { slug: 'personal', provider: 'other' });
  assert.match(replies.at(-1).error, /Invalid login provider/);
});

test('metadata reports a live dialog terminal so Settings can offer Reopen', async (t) => {
  const { send, replies, live } = fixture(t);
  await send('logins-add', { label: 'Personal' });
  await send('logins-login', { slug: 'personal', provider: 'claude' });
  assert.equal(replies.at(-1).logins[0].claude.terminal, true);
  assert.equal(replies.at(-1).logins[0].codex.terminal, false);
  live.clear();
  await send('logins-get', { reqId: 'read' });
  assert.equal(replies.at(-1).logins[0].claude.terminal, false);
});

test('reads reply only to requester; mutations broadcast only sanitized metadata', async (t) => {
  const { send, store, frames, replies } = fixture(t);
  await send('logins-add', { label: 'Personal', reqId: 'add' });
  store.bind('private-card', 'personal');
  await send('logins-login', { slug: 'personal', provider: 'claude', reqId: 'login' });
  assert.equal(frames.at(-1).logins[0].claude.present, true);
  assert.equal(frames.at(-1).reqId, 'login');
  const before = frames.length;
  await send('logins-get', { reqId: 'read' });
  assert.equal(frames.length, before);
  assert.equal(replies.at(-1).reqId, 'read');
  for (const serialized of [JSON.stringify(frames), JSON.stringify(replies)]) {
    assert.ok(!serialized.includes(store.claudeDir('personal'))); assert.ok(!serialized.includes('private-card'));
  }
  await send('logins-add', { label: 'Personal', reqId: 'duplicate' });
  assert.equal(replies.at(-1).kind, 'logins-error');
  assert.equal(replies.at(-1).reqId, 'duplicate');
});

test('a non-macOS host refuses Log in by platform name before creating anything', async (t) => {
  const { store, calls, send, replies } = fixture(t);
  await send('logins-add', { label: 'Personal' });
  const platform = Object.getOwnPropertyDescriptor(process, 'platform');
  t.after(() => Object.defineProperty(process, 'platform', platform));
  Object.defineProperty(process, 'platform', { ...platform, value: 'linux' });
  for (const provider of ['claude', 'codex']) {
    await send('logins-login', { slug: 'personal', provider });
    assert.equal(replies.at(-1).kind, 'logins-error');
    assert.equal(replies.at(-1).error, 'login "Personal" works only on macOS, not Linux');
  }
  assert.deepEqual(calls, []);
  assert.deepEqual(fs.readdirSync(store.dir('personal')), ['login.json']);
});
