import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LoginStore } from './login-store.js';
import { prepare, launchContext, onBeforeDispatch, onFork, onPurge } from './launch.js';
import { AUTH_OVERRIDES } from './claude-config.js';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-login-launch-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = new LoginStore(root); store.add('Personal'); store.add('Other');
  fs.writeFileSync(path.join(process.env.CODEX_HOME, 'config.toml'), 'fixture');
  const host = { stores: { logins: store } };
  const give = (agent) => {
    if (agent === 'claude') return store.setUpClaude('personal');
    else { fs.mkdirSync(store.codexHome('personal'), { recursive: true }); fs.writeFileSync(path.join(store.codexHome('personal'), 'auth.json'), '{}'); }
  };
  return { store, host, give };
}

for (const agent of ['claude', 'codex']) {
  const provider = agent === 'claude' ? 'Claude' : 'Codex';
  test(`${agent}: dispatch validates provider and runtime; spawned children inherit including Default`, (t) => {
    const { store, host, give } = fixture(t);
    const base = { agent, host, runtime: 'local', ext: { login: 'personal' } };
    assert.equal(prepare({ agent, host }), undefined);
    assert.deepEqual(prepare(base), { abort: `login "Personal" has no ${provider} login` });
    give(agent);
    assert.equal(prepare(base), undefined);
    if (agent === 'claude') {
      assert.deepEqual(prepare({ ...base, ownLaunch: true, runtime: 'cloud' }), { abort: 'login "Personal" runs Claude only on the local runtime, not "cloud"' });
      assert.deepEqual(prepare({ ...base, ownLaunch: false, runtime: 'devcontainer' }), { abort: 'login "Personal" runs Claude only on the local runtime, not "devcontainer"' });
    } else {
      assert.deepEqual(prepare({ ...base, ownLaunch: true, runtime: 'cloud' }), { abort: 'login "Personal" cannot be used with runtime "cloud"' });
      assert.equal(prepare({ ...base, ownLaunch: false, runtime: 'devcontainer' }), undefined);
    }
    assert.deepEqual(prepare({ ...base, ext: { login: 'missing' } }), { abort: 'login "missing" no longer exists' });
    store.bind('parent', 'personal');
    assert.equal(prepare({ ...base, spawnedBy: 'parent', ext: { login: 'other' } }), undefined);
    onBeforeDispatch({ ...base, sessionId: 'child', spawnedBy: 'parent', ext: { login: 'other' } });
    assert.equal(store.loginFor('child'), 'personal');
    assert.equal(prepare({ ...base, spawnedBy: 'default-parent', ext: { login: 'other' } }), undefined);
    onBeforeDispatch({ ...base, sessionId: 'default-child', spawnedBy: 'default-parent' });
    assert.equal(store.loginFor('default-child'), null);
    onBeforeDispatch({ ...base, sessionId: 'human' });
    assert.equal(store.loginFor('human'), 'personal');
    onBeforeDispatch({ host, sessionId: 'plain' });
    assert.equal(store.loginFor('plain'), null);
  });

  test(`${agent}: dispatch, resume and fork inject only the bound provider environment`, (t) => {
    const { store, host, give } = fixture(t); const dir = give(agent); store.bind('parent', 'personal');
    const expected = agent === 'claude' ? { env: { CLAUDE_CONFIG_DIR: dir }, refuseIfSet: AUTH_OVERRIDES } : { env: { CODEX_HOME: store.codexHome('personal') } };
    for (const reason of ['dispatch', 'resume', 'fork']) {
      const args = { host, agent, reason, sid: reason === 'fork' ? 'child' : 'parent', parentId: reason === 'fork' ? 'parent' : undefined };
      assert.deepEqual(launchContext(args), expected);
      if (agent === 'claude') assert.deepEqual(launchContext({ ...args, runtime: 'devcontainer' }), { refuse: 'login "Personal" runs Claude only on the local runtime, not "devcontainer"' });
      else assert.deepEqual(launchContext({ ...args, runtime: 'devcontainer' }), expected);
      assert.deepEqual(launchContext({ host, agent, reason, sid: 'unmapped', parentId: 'default' }), {});
    }
    if (agent === 'codex') assert.equal(fs.readlinkSync(path.join(store.codexHome('personal'), 'config.toml')), path.join(process.env.CODEX_HOME, 'config.toml'));
    onFork({ sessionId: 'child', parentId: 'parent', host });
    assert.equal(store.loginFor('child'), 'personal');
    onPurge({ sessionId: 'child', host });
    assert.equal(store.loginFor('child'), null);
  });

  test(`${agent}: a non-macOS host refuses login launches by platform name and leaves Default alone`, (t) => {
    const { store, host, give } = fixture(t); give(agent); store.bind('card', 'personal');
    const platform = Object.getOwnPropertyDescriptor(process, 'platform');
    t.after(() => Object.defineProperty(process, 'platform', platform));
    for (const [id, name] of [['linux', 'Linux'], ['win32', 'Windows'], ['plan9', 'plan9']]) {
      Object.defineProperty(process, 'platform', { ...platform, value: id });
      const refused = `login "Personal" works only on macOS, not ${name}`;
      assert.deepEqual(prepare({ host, agent, runtime: 'local', ext: { login: 'personal' } }), { abort: refused });
      for (const reason of ['dispatch', 'resume', 'fork', 'headless']) assert.deepEqual(launchContext({ host, agent, reason, sid: reason === 'fork' ? 'child' : 'card', parentId: 'card' }), { refuse: refused });
      assert.equal(prepare({ host, agent, runtime: 'local' }), undefined);
      assert.deepEqual(launchContext({ host, agent, reason: 'dispatch', sid: 'unmapped' }), {});
    }
  });

  test(`${agent}: removal and forgotten credentials refuse dispatch, resume, fork and headless`, (t) => {
    const { store, host, give } = fixture(t); give(agent); store.bind('parent', 'personal');
    store.forget('personal', agent);
    assert.deepEqual(prepare({ host, agent, spawnedBy: 'parent' }), { abort: `login "Personal" has no ${provider} login` });
    for (const reason of ['resume', 'fork', 'headless']) {
      assert.deepEqual(launchContext({ host, agent, reason, sid: reason === 'fork' ? 'child' : 'parent', parentId: 'parent' }), { refuse: `login "Personal" has no ${provider} login` });
    }
    store.remove('personal');
    assert.deepEqual(prepare({ host, agent, spawnedBy: 'parent' }), { abort: 'login "Personal" no longer exists' });
    for (const reason of ['resume', 'fork']) assert.deepEqual(launchContext({ host, agent, reason, sid: reason === 'fork' ? 'child' : 'parent', parentId: 'parent' }), { refuse: 'login "Personal" no longer exists' });
  });
}

test('headless resolves card before ext, refuses Codex-only Claude review, uses ext without a mapping', (t) => {
  const { store, host, give } = fixture(t); const dir = give('claude'); store.bind('card', 'personal');
  const expected = { env: { CLAUDE_CONFIG_DIR: dir }, refuseIfSet: AUTH_OVERRIDES };
  assert.deepEqual(launchContext({ host, sid: 'card', agent: 'claude', reason: 'headless', ext: { login: 'other' } }), expected);
  for (const sid of [null, 'unmapped']) assert.deepEqual(launchContext({ host, sid, agent: 'claude', reason: 'headless', ext: { login: 'personal' } }), expected);
  assert.deepEqual(launchContext({ host, sid: null, agent: 'claude', reason: 'headless' }), {});
  store.forget('personal', 'claude'); give('codex');
  assert.deepEqual(launchContext({ host, sid: 'card', agent: 'claude', reason: 'headless' }), { refuse: 'login "Personal" has no Claude login' });
});

test('a launch carries only the config path; headless refuses server-side overrides by name', (t) => {
  const { store, host, give } = fixture(t); const dir = give('claude'); store.bind('card', 'personal');
  const context = launchContext({ host, sid: 'card', agent: 'claude', reason: 'dispatch' });
  assert.deepEqual(Object.keys(context.env), ['CLAUDE_CONFIG_DIR']);
  assert.ok(path.isAbsolute(context.env.CLAUDE_CONFIG_DIR));
  assert.ok(context.refuseIfSet.includes('CLAUDE_SECURESTORAGE_CONFIG_DIR'));
  for (const name of ['CLAUDE_SECURESTORAGE_CONFIG_DIR', 'ANTHROPIC_API_KEY']) {
    process.env[name] = '';
    t.after(() => { delete process.env[name]; });
    assert.deepEqual(launchContext({ host, sid: 'card', agent: 'claude', reason: 'headless' }), { refuse: `login "Personal": the Agent Wrangler server environment sets ${name}` });
    delete process.env[name];
  }
  assert.equal(launchContext({ host, sid: 'card', agent: 'claude', reason: 'headless' }).env.CLAUDE_CONFIG_DIR, dir);
});

test('a plaintext credential file warns in the launch log and the launch still runs', (t) => {
  const { store, host, give } = fixture(t); const dir = give('claude'); store.bind('card', 'personal');
  fs.writeFileSync(path.join(dir, '.credentials.json'), 'fixture-private', { mode: 0o000 });
  const warnings = []; const warn = console.warn; console.warn = (msg) => warnings.push(msg); t.after(() => { console.warn = warn; });
  assert.equal(launchContext({ host, sid: 'card', agent: 'claude', reason: 'resume' }).env.CLAUDE_CONFIG_DIR, dir);
  assert.deepEqual(warnings, ['[logins] login "Personal" keeps its Claude credential in a plaintext .credentials.json']);
  assert.ok(!warnings.join().includes('fixture-private'));
});

test('missing config dirs, unshareable required links, corrupt bindings and mirror errors fail closed', (t) => {
  const { store, host, give } = fixture(t); const dir = give('claude'); store.bind('card', 'personal');
  fs.unlinkSync(path.join(dir, 'sessions')); fs.mkdirSync(path.join(dir, 'sessions'));
  assert.deepEqual(launchContext({ host, sid: 'card', agent: 'claude' }), { refuse: 'login "Personal": Claude sessions cannot be shared from the default Claude folder' });
  fs.rmSync(dir, { recursive: true });
  assert.deepEqual(launchContext({ host, sid: 'card', agent: 'claude' }), { refuse: 'login "Personal" has no Claude login' });
  assert.deepEqual(prepare({ host, spawnedBy: 'card', agent: 'claude' }), { abort: 'login "Personal" has no Claude login' });
  give('codex');
  fs.rmSync(path.join(store.codexHome('personal'), 'auth.json'));
  fs.rmSync(store.codexHome('personal'), { recursive: true });
  fs.writeFileSync(store.codexHome('personal'), 'not a directory');
  assert.ok(launchContext({ host, sid: 'card', agent: 'codex' }).refuse);
  fs.writeFileSync(path.join(store.root, 'sessions.json'), '{broken');
  assert.ok(launchContext({ host, sid: 'card', agent: 'claude' }).refuse);
  assert.ok(prepare({ host, spawnedBy: 'card', agent: 'claude' }).abort);
});

test('a binding write failure refuses dispatch and fork instead of losing the login', (t) => {
  const { store, host, give } = fixture(t); give('claude'); store.bind('parent', 'personal');
  store.bind = () => { throw new Error('binding write failed'); };
  try { onBeforeDispatch({ host, sessionId: 'new', ext: { login: 'personal' } }); } catch {}
  assert.match(launchContext({ host, sid: 'new', reason: 'dispatch', agent: 'claude' }).refuse, /binding write failed/);
  assert.match(launchContext({ host, sid: 'fork', parentId: 'parent', reason: 'fork', agent: 'claude' }).refuse, /binding write failed/);
});

test('a transient lineage read failure cannot turn a spawned login into Default', (t) => {
  const { store, host, give } = fixture(t); give('claude'); store.bind('parent', 'personal');
  const original = store.loginFor.bind(store);
  let first = true;
  store.loginFor = (sid) => { if (first) { first = false; throw new Error('binding read failed'); } return original(sid); };
  try { onBeforeDispatch({ host, sessionId: 'child', spawnedBy: 'parent' }); } catch {}
  assert.match(launchContext({ host, sid: 'child', reason: 'dispatch', agent: 'claude' }).refuse, /binding read failed/);
});
