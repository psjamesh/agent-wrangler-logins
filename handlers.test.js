import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LoginStore } from './login-store.js';
import { HANDLERS, stopCaptures } from './handlers.js';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-login-handlers-'));
  const calls = []; const frames = []; const replies = []; const store = new LoginStore(root);
  const host = { stores: { logins: store }, terminals: { create: async (opts) => calls.push(opts) }, rebuild: async () => { host.rebuilds++; }, rebuilds: 0, broadcast: (frame) => frames.push(frame) };
  t.after(() => { stopCaptures(store); fs.rmSync(root, { recursive: true, force: true }); });
  const send = (type, msg = {}) => HANDLERS.find((h) => h.type === type).handler(msg, host, (frame) => replies.push(frame));
  return { store, host, calls, send, frames, replies };
}

test('management handlers add, forget and remove without erasing bindings', async (t) => {
  const { store, host, send, replies } = fixture(t);
  await send('logins-add', { label: 'Personal' });
  assert.equal(host.rebuilds, 1);
  const token = 'sk-ant-oat01-fixture_abcdefghijklmnopqr';
  await send('logins-set-claude-token', { slug: 'personal', token: 'bad' });
  assert.equal(replies.at(-1).error, 'That does not look like a Claude setup-token');
  assert.equal(store.get('personal').claude.present, false);
  await send('logins-set-claude-token', { slug: 'personal', token });
  assert.equal(store.readClaudeToken('personal'), token);
  await send('logins-forget', { slug: 'personal', provider: 'claude' });
  assert.equal(store.get('personal').claude.present, false);
  store.bind('card', 'personal');
  await send('logins-remove', { slug: 'personal' });
  assert.equal(store.get('personal'), null);
  assert.equal(store.loginFor('card'), 'personal');
});

test('login opens isolated Codex and Claude commands; capture files are private', async (t) => {
  const { store, calls, send, replies } = fixture(t);
  await send('logins-add', { label: 'Personal' });
  await send('logins-login', { slug: 'personal', provider: 'codex' });
  assert.match(calls[0].command, /^CODEX_HOME=/);
  assert.ok(calls[0].command.includes(store.codexHome('personal')));
  assert.equal(fs.existsSync(store.codexHome('personal')), true);
  await send('logins-login', { slug: 'personal', provider: 'claude' });
  assert.match(calls[1].command, /setup-token.*tee/);
  assert.equal(fs.statSync(path.join(store.dir('personal'), 'claude-capture.txt')).mode & 0o777, 0o600);
  await send('logins-login', { slug: 'absent', provider: 'claude' });
  assert.match(replies.at(-1).error, /no longer exists/);
  await send('logins-login', { slug: 'personal', provider: 'other' });
  assert.match(replies.at(-1).error, /Invalid login provider/);
});

test('reads reply only to requester; mutations broadcast only sanitized metadata', async (t) => {
  const { send, store, frames, replies } = fixture(t);
  await send('logins-add', { label: 'Personal', reqId: 'add' });
  store.bind('private-card', 'personal');
  const token = 'sk-ant-oat01-fixture_abcdefghijklmnopqr';
  await send('logins-set-claude-token', { slug: 'personal', token, reqId: 'token' });
  assert.equal(frames.at(-1).logins[0].claude.present, true);
  assert.equal(frames.at(-1).reqId, 'token');
  const before = frames.length;
  await send('logins-get', { reqId: 'read' });
  assert.equal(frames.length, before);
  assert.deepEqual(replies.at(-1), { kind: 'logins', reqId: 'read', logins: store.list() });
  for (const serialized of [JSON.stringify(frames), JSON.stringify(replies)]) {
    assert.ok(!serialized.includes(token)); assert.ok(!serialized.includes('private-card'));
  }
  await send('logins-add', { label: 'Personal', reqId: 'duplicate' });
  assert.equal(replies.at(-1).kind, 'logins-error');
  assert.equal(replies.at(-1).reqId, 'duplicate');
});
