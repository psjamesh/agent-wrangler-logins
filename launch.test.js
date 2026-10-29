import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LoginStore } from './login-store.js';
import { prepare, launchContext, onBeforeDispatch, onFork, onPurge } from './launch.js';
import { AUTH_OVERRIDES } from './claude-config.js';
import { CODEX_CONFIG } from './codex-mirror.js';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-login-launch-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = new LoginStore(root); store.add('Personal'); store.add('Other');
  fs.writeFileSync(path.join(process.env.CODEX_HOME, 'config.toml'), 'fixture');
  const work = path.join(root, 'work'); fs.mkdirSync(work);
  const host = { stores: { logins: store }, sessions: { get: (sessionId) => ({ sessionId, cwd: work, worktree: null }) } };
  const give = (agent) => {
    return agent === 'claude' ? store.setUpClaude('personal') : store.setUpCodex('personal');
  };
  return { store, host, give, work, root };
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
    assert.deepEqual(prepare({ ...base, ownLaunch: true, runtime: 'cloud' }), { abort: `login "Personal" runs ${provider} only on the local runtime, not "cloud"` });
    assert.deepEqual(prepare({ ...base, ownLaunch: false, runtime: 'devcontainer' }), { abort: `login "Personal" runs ${provider} only on the local runtime, not "devcontainer"` });
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
    const expected = agent === 'claude' ? { env: { CLAUDE_CONFIG_DIR: dir }, refuseIfSet: AUTH_OVERRIDES } : { env: { CODEX_HOME: dir }, codexConfig: { cli_auth_credentials_store: 'keyring' } };
    for (const reason of ['dispatch', 'resume', 'fork']) {
      const args = { host, agent, reason, sid: reason === 'fork' ? 'child' : 'parent', parentId: reason === 'fork' ? 'parent' : undefined };
      assert.deepEqual(launchContext(args), expected);
      for (const runtime of ['devcontainer', 'cloud']) assert.deepEqual(launchContext({ ...args, runtime }), { refuse: `login "Personal" runs ${provider} only on the local runtime, not "${runtime}"` });
      assert.deepEqual(launchContext({ host, agent, reason, sid: 'unmapped', parentId: 'default' }), {});
    }
    if (agent === 'codex') assert.equal(fs.readlinkSync(path.join(dir, 'config.toml')), path.join(process.env.CODEX_HOME, 'config.toml'));
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

test('a Codex login launches only with the keyring override in its own fresh home; Default and Claude carry none', (t) => {
  const { store, host, root } = fixture(t);
  const old = path.join(store.oldCodexHome('personal'), 'auth.json');
  fs.mkdirSync(path.dirname(old)); fs.writeFileSync(old, 'fixture-private');
  store.bind('card', 'personal');
  assert.deepEqual(launchContext({ host, sid: 'card', agent: 'codex', reason: 'dispatch' }), { refuse: 'login "Personal" has no Codex login' });
  const home = store.setUpCodex('personal');
  for (const reason of ['dispatch', 'resume', 'fork']) {
    const context = launchContext({ host, sid: reason === 'fork' ? 'forked' : 'card', parentId: 'card', agent: 'codex', reason, runtime: 'local' });
    assert.deepEqual(context, { env: { CODEX_HOME: home }, codexConfig: CODEX_CONFIG });
    assert.notEqual(context.codexConfig, CODEX_CONFIG);
  }
  assert.deepEqual(CODEX_CONFIG, { cli_auth_credentials_store: 'keyring' });
  assert.deepEqual(launchContext({ host, sid: 'default-card', agent: 'codex', reason: 'dispatch' }), {});
  store.setUpClaude('personal');
  assert.equal(launchContext({ host, sid: 'card', agent: 'claude', reason: 'dispatch' }).codexConfig, undefined);
  assert.equal(fs.readFileSync(old, 'utf8'), 'fixture-private');
  assert.equal(fs.existsSync(path.join(home, 'auth.json')), false);
  assert.ok(!JSON.stringify(launchContext({ host, sid: 'card', agent: 'codex', reason: 'resume' })).includes(root + '/personal/codex-home'));
});

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
  const home = give('codex');
  fs.rmSync(home, { recursive: true });
  fs.writeFileSync(home, 'not a directory');
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

test('Claude settings for the launch folder refuse dispatch, resume and fork by name', (t) => {
  const { store, host, give, work, root } = fixture(t); const dir = give('claude');
  const repoRoot = path.join(root, 'repo'); const tree = path.join(root, 'tree');
  fs.mkdirSync(repoRoot); fs.mkdirSync(tree);
  onBeforeDispatch({ host, sessionId: 'card', ext: { login: 'personal' }, cwd: tree, worktree: { path: tree, repoRoot } });
  const settings = path.join(repoRoot, '.claude', 'settings.local.json');
  fs.mkdirSync(path.dirname(settings)); fs.writeFileSync(settings, JSON.stringify({ env: { ANTHROPIC_BASE_URL: 'http://fixture-private' } }));
  const named = `login "Personal": Claude settings ${settings} set ANTHROPIC_BASE_URL in env, which overrides the login's sign-in`;
  assert.deepEqual(launchContext({ host, agent: 'claude', reason: 'dispatch', sid: 'card' }), { refuse: named });
  fs.rmSync(settings);
  assert.equal(launchContext({ host, agent: 'claude', reason: 'dispatch', sid: 'card' }).env.CLAUDE_CONFIG_DIR, dir);
  const project = path.join(work, '.claude', 'settings.json');
  fs.mkdirSync(path.dirname(project)); fs.writeFileSync(project, JSON.stringify({ apiKeyHelper: '/bin/fixture-private' }));
  store.bind('parent', 'personal');
  const refused = { refuse: `login "Personal": Claude settings ${project} set apiKeyHelper, which overrides the login's sign-in` };
  for (const reason of ['resume', 'message', 'snooze-wake']) assert.deepEqual(launchContext({ host, agent: 'claude', reason, sid: 'parent' }), refused);
  assert.deepEqual(launchContext({ host, agent: 'claude', reason: 'fork', sid: 'child', parentId: 'parent' }), refused);
  for (const reason of ['assign', 'adopt', 'headless']) assert.equal(launchContext({ host, agent: 'claude', reason, sid: 'parent' }).env.CLAUDE_CONFIG_DIR, dir);
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ env: { CLAUDE_CODE_USE_BEDROCK: '1' } }));
  assert.deepEqual(launchContext({ host, agent: 'claude', reason: 'headless', sid: 'parent' }), { refuse: `login "Personal": Claude settings ${path.join(dir, 'settings.json')} set CLAUDE_CODE_USE_BEDROCK in env, which overrides the login's sign-in` });
  assert.deepEqual(launchContext({ host, agent: 'codex', reason: 'resume', sid: 'unmapped' }), {});
  onPurge({ sessionId: 'card', host });
});

test('an unknown or unreadable launch folder refuses instead of verifying', (t) => {
  const { store, host, give, work } = fixture(t); give('claude'); store.bind('card', 'personal');
  const blind = { stores: host.stores };
  for (const reason of ['resume', 'fork']) {
    assert.deepEqual(launchContext({ host: blind, agent: 'claude', reason, sid: reason === 'fork' ? 'child' : 'card', parentId: 'card' }), { refuse: 'login "Personal": the launch folder is not known, so its Claude settings cannot be checked' });
  }
  const gone = { stores: host.stores, sessions: { get: () => null } };
  assert.match(launchContext({ host: gone, agent: 'claude', reason: 'resume', sid: 'card' }).refuse, /launch folder is not known/);
  const settings = path.join(work, '.claude', 'settings.json');
  fs.mkdirSync(path.dirname(settings)); fs.writeFileSync(settings, '{broken');
  assert.deepEqual(launchContext({ host, agent: 'claude', reason: 'resume', sid: 'card' }), { refuse: `login "Personal": cannot read Claude settings ${settings}, so the login's sign-in cannot be verified` });
});
