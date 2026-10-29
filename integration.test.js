import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { pathToFileURL } from 'node:url';
const checkout = process.env.AW_HOST_CHECKOUT;
if (!checkout || !path.isAbsolute(checkout)) throw new Error('Set AW_HOST_CHECKOUT to an absolute host checkout with API 1.54.0 and installed dependencies');
const hostModule = (file) => import(pathToFileURL(path.join(checkout, file)).href);
const home = os.homedir();
const { default: extension } = await import('./index.js');
const { LoginStore } = await import('./login-store.js');
const { loadExtensions, hookPayloadFor, SESSION_HOOKS } = await hostModule('server/extensions/index.js');
const { SessionManager } = await hostModule('server/session-manager.js');
const { collectPrepare } = await hostModule('server/session-prepare.js');
const { collectLaunchContext } = await hostModule('server/launch-context.js');
const { buildHostApi } = await hostModule('server/host-api/index.js');
const { createEventBus } = await hostModule('server/events.js');
const { runArchiveReview, ARCHIVE_REVIEW_COMPLETED } = await hostModule('server/archive-review-runner.js');

const KEYRING = `'-c' 'cli_auth_credentials_store="keyring"'`;

function fixture(t, enabled = true) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-login-integration-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = new LoginStore(path.join(root, 'logins')); store.add('Personal');
  store.setUpClaude('personal');
  store.setUpCodex('personal');
  const registry = loadExtensions({ cfg: { extensions: { logins: enabled } }, builtin: [extension] });
  const sm = new SessionManager(); sm.map.clear(); sm._save = () => {}; sm.refreshAlive = async () => {}; sm.killForSession = async () => {};
  const host = buildHostApi({ id: 'logins', requires: extension.requires, range: extension.engines.wranglerApi, stores: { logins: store }, core: { sessionManager: sm, taskStore: { taskFor: () => null } } });
  const options = { ext: registry, hostApiFor: () => host };
  sm._ensureClaudeTrust = async () => {}; sm._ensureCodexTrust = async () => {};
  const commands = [];
  sm._newSession = async (_tmux, _cwd, cmd) => { commands.push(cmd); };
  sm._prepare = (p) => collectPrepare(p, options);
  sm._launchContext = (p) => collectLaunchContext(p, options);
  for (const name of SESSION_HOOKS) sm._extHooks[name] = registry.sessionHooks[name].map(({ extId, fn }) => (p) => fn({ ...hookPayloadFor(extId, p), host }));
  const api = buildHostApi({ id: 'launcher', requires: ['sessions:spawn', 'sessions:env'], core: { sessionManager: sm, taskStore: { taskFor: () => null } }, launchContext: sm._launchContext });
  return { sm, api, store, commands, root, options };
}

for (const agent of ['claude', 'codex']) {
  test(`${agent}: host API spawn ext binds a real card, resume and fork retain env, and agent children inherit Default`, async (t) => {
    const { sm, api, store, commands, root } = fixture(t);
    const card = await api.sessions.spawn({ cwd: root, intent: 'fixture', agent, ext: { logins: { login: 'personal' } } });
    assert.equal(store.loginFor(card.sessionId), 'personal');
    const marker = agent === 'claude' ? `CLAUDE_CONFIG_DIR='${store.claudeDir('personal')}'` : `CODEX_HOME='${store.codexDir('personal')}'`;
    assert.ok(commands[0].includes(marker));
    if (agent === 'codex') assert.ok(commands[0].includes(KEYRING));
    else assert.ok(!commands[0].includes('cli_auth_credentials_store'));
    if (agent === 'claude') {
      assert.match(commands[0], /\/bin\/sh -c .*CLAUDE_SECURESTORAGE_CONFIG_DIR\+x.* && /);
      assert.doesNotMatch(commands[0], /TOKEN=|API_KEY=|fixture-private/);
    }
    const liveId = `${card.sessionId}-live`;
    sm.map.get(card.sessionId).liveSessionId = liveId;
    if (agent === 'claude') {
      const bucket = path.join(home, '.claude', 'projects', card.sessionId);
      fs.mkdirSync(bucket, { recursive: true });
      fs.writeFileSync(path.join(bucket, `${liveId}.jsonl`), JSON.stringify({ cwd: root }) + '\n');
    }
    await sm.resume(card.sessionId, root);
    assert.ok(commands[1].includes(marker));
    const fork = await sm.fork({ sourceId: liveId, parentId: card.sessionId, parentEntry: sm.entryFor(card.sessionId), cwd: root });
    assert.ok(commands[2].includes(marker));
    if (agent === 'codex') for (const cmd of commands.slice(0, 3)) assert.ok(cmd.includes(KEYRING));
    assert.equal(store.loginFor(fork.sessionId), 'personal');
    const child = await sm.dispatch({ cwd: root, agent, spawnedBy: 'default-parent', ext: { logins: { login: 'personal' } } });
    assert.equal(store.loginFor(child.sessionId), null);
    assert.ok(!commands[3].includes(marker));
    assert.ok(!commands[3].includes('cli_auth_credentials_store'));
    store.remove('personal');
    await assert.rejects(sm.resume(card.sessionId, root), /login "Personal" no longer exists/);
    await assert.rejects(sm.fork({ sourceId: liveId, parentId: card.sessionId, parentEntry: sm.entryFor(card.sessionId), cwd: root }), /login "Personal" no longer exists/);
  });

  test(`${agent}: disabling Logins leaves dispatch, resume and fork free of login environment`, async (t) => {
    const { sm, api, store, commands, root } = fixture(t, false);
    const card = await api.sessions.spawn({ cwd: root, intent: 'fixture', agent, ext: { logins: { login: 'personal' } } });
    store.bind(card.sessionId, 'personal');
    const liveId = `${card.sessionId}-live`;
    sm.map.get(card.sessionId).liveSessionId = liveId;
    if (agent === 'claude') {
      const bucket = path.join(home, '.claude', 'projects', card.sessionId);
      fs.mkdirSync(bucket, { recursive: true });
      fs.writeFileSync(path.join(bucket, `${liveId}.jsonl`), JSON.stringify({ cwd: root }) + '\n');
    }
    await sm.resume(card.sessionId, root);
    await sm.fork({ sourceId: liveId, parentId: card.sessionId, parentEntry: sm.entryFor(card.sessionId), cwd: root });
    assert.equal(commands.length, 3);
    for (const cmd of commands) {
      assert.ok(!cmd.includes(store.codexDir('personal')));
      assert.ok(!cmd.includes('CLAUDE_CONFIG_DIR='));
      assert.ok(!cmd.includes('CLAUDE_SECURESTORAGE_CONFIG_DIR'));
      assert.ok(!cmd.includes('CODEX_HOME='));
      assert.ok(!cmd.includes('cli_auth_credentials_store'));
    }
  });
}

test('codex: the real host refuses a Codex login on a non-local runtime at dispatch, resume and fork', async (t) => {
  const { store, options } = fixture(t);
  store.bind('card', 'personal');
  for (const runtime of ['devcontainer', 'cloud']) {
    const refused = `login "Personal" runs Codex only on the local runtime, not "${runtime}"`;
    assert.deepEqual(await collectPrepare({ sessionId: 'new', agent: 'codex', ext: { logins: { login: 'personal' } }, runtime, ownLaunch: runtime === 'cloud' }, options), { abort: refused, warnings: [] });
    for (const reason of ['dispatch', 'resume', 'fork']) {
      await assert.rejects(collectLaunchContext({ sid: reason === 'fork' ? 'forked' : 'card', parentId: 'card', agent: 'codex', runtime, reason }, options), { message: refused });
    }
  }
  assert.deepEqual(await collectPrepare({ sessionId: 'new', agent: 'codex', ext: { logins: { login: 'personal' } }, runtime: 'local', ownLaunch: false }, options), { abort: null, warnings: [] });
  assert.deepEqual(await collectPrepare({ sessionId: 'new', agent: 'codex', ext: null, runtime: 'devcontainer', ownLaunch: false }, options), { abort: null, warnings: [] });
});

test('codex: a Codex login launch never touches an earlier codex-home auth.json and writes none of its own', async (t) => {
  const { api, store, commands, root } = fixture(t);
  const old = path.join(store.oldCodexHome('personal'), 'auth.json');
  fs.mkdirSync(path.dirname(old)); fs.writeFileSync(old, 'fixture-private');
  await api.sessions.spawn({ cwd: root, intent: 'fixture', agent: 'codex', ext: { logins: { login: 'personal' } } });
  assert.ok(!commands[0].includes('codex-home'));
  assert.ok(!commands[0].includes('fixture-private'));
  assert.equal(fs.readFileSync(old, 'utf8'), 'fixture-private');
  assert.equal(fs.existsSync(path.join(store.codexDir('personal'), 'auth.json')), false);
});

test('archive review uses the mapped Claude config dir; a Codex-only login skips with a named refusal', async (t) => {
  const { store, sm, options } = fixture(t);
  store.bind('review-card', 'personal');
  const events = createEventBus(); events.on(ARCHIVE_REVIEW_COMPLETED, () => {}, 'memory');
  const calls = []; const logs = [];
  const deps = {
    events, isEnabled: () => true, findTranscriptFn: async () => 'fixture',
    readLinesFn: async () => [{ type: 'user', message: { role: 'user', content: 'Remember this fixture' } }],
    launchContext: (p) => collectLaunchContext(p, options),
    review: async (_text, opts) => { calls.push(opts); return { text: 'NONE', liveSessionId: 'review-live', error: null }; },
    onError: (msg) => logs.push(msg),
  };
  const entry = { agent: 'claude', liveSessionId: 'fixture-live' };
  assert.equal(await runArchiveReview('review-card', entry, { id: 'task' }, deps), 'none');
  assert.deepEqual(calls, [{ env: { CLAUDE_CONFIG_DIR: store.claudeDir('personal') } }]);
  store.forget('personal', 'claude');
  assert.equal(await runArchiveReview('review-card', entry, { id: 'task' }, deps), 'skipped');
  assert.equal(calls.length, 1);
  assert.match(logs[0], /archive review skipped for review-card: login "Personal" has no Claude login/);
  await assert.rejects(sm.dispatch({ cwd: os.tmpdir(), agent: 'claude', spawnedBy: 'review-card' }), /login "Personal" has no Claude login/);
});

test('real host validates the standalone manifest and hosts independent Login dispatch fields', async () => {
  const { validateManifest } = await hostModule('server/extensions/index.js');
  assert.doesNotThrow(() => validateManifest(extension));
  const { createSlots } = await hostModule('public/slots.js');
  const { default: client } = await import('./public/index.js');
  const { dom } = await import('./test/dom.js');
  const document = dom(); const errors = [];
  const slots = createSlots({ document, storage: null, onError: (e) => errors.push(e) });
  const api = { send() {}, runtimes: () => [{ id: 'cloud', label: 'Cloud', ownLaunch: true }] };
  client.register(slots.forExtension('logins', api));
  const make = () => document.createElement('div');
  const model = make(); const advanced = make();
  slots.syncHosts('dispatch.field', [{ host: model, at: 'model' }, { host: advanced, at: 'advanced' }], api);
  const ctx = { mode: 'launcher', draft: { agent: 'codex' } };
  const graph = { logins: { logins: [{ slug: 'personal', label: 'Personal', claude: { present: true }, codex: { present: false } }], sessions: {} } };
  const both = { logins: { logins: [{ slug: 'personal', label: 'Personal', claude: { present: true }, codex: { present: true } }], sessions: {} } };
  slots.update('dispatch.field', ctx, graph);
  const root = make(); const handle = slots.forExtension('launcher', api).api.dispatchFields.mount(root, ctx);
  handle.update(ctx, graph);
  const walk = (el) => el.tagName === 'SELECT' ? el : el.children.map(walk).find(Boolean);
  assert.deepEqual(walk(root).children.map((o) => o.textContent), ['Default', 'Personal']);
  walk(root).value = 'personal';
  assert.equal(handle.validate(), '"Personal" has no Codex login');
  assert.deepEqual(handle.read(), { ext: { logins: { login: 'personal' } } });
  assert.equal(walk(model), undefined);
  assert.equal(walk(advanced).value, '');
  handle.update({ mode: 'launcher', draft: { agent: 'claude', runtime: 'cloud' } }, graph);
  assert.equal(handle.validate(), '"Personal" runs Claude only on the local runtime, not "Cloud"');
  handle.update({ mode: 'launcher', draft: { agent: 'codex', runtime: 'cloud' } }, both);
  assert.equal(handle.validate(), '"Personal" runs Codex only on the local runtime, not "Cloud"');
  handle.unmount(); assert.equal(root.children.length, 0); assert.deepEqual(errors, []);
});

test('host install, update, uninstall and reinstall preserve stored logins and bindings', async (t) => {
  const { extInstallHandler, extConsentHandler, extUninstallHandler, _setInstallRunnersForTests, _resetInstallLockForTests } = await hostModule('server/control/handlers/extensions-install.js');
  const { registerExtension, unregisterExtension } = await hostModule('server/extensions/index.js');
  const { externalDir, readProvenance } = await hostModule('server/extensions/provenance.js');
  const { fileURLToPath } = await import('node:url');
  const source = path.dirname(fileURLToPath(import.meta.url));
  _resetInstallLockForTests();
  t.after(() => { _setInstallRunnersForTests(); _resetInstallLockForTests(); });
  _setInstallRunnersForTests({ clone: async (_url, dest) => {
    fs.cpSync(source, dest, { recursive: true, filter: (file) => !['.git', 'node_modules', 'host'].includes(path.basename(file)) });
  }, head: async () => 'a'.repeat(40), npm: async () => {}, commits: async () => ({ commits: [], truncated: false }) });
  const registry = loadExtensions({ cfg: {}, builtin: [] }); const replies = [];
  const ctx = {
    ext: { list: registry.list, manifests: registry._manifests,
      register: (m, opts) => registerExtension(registry, m, opts), unregister: (id, opts) => unregisterExtension(registry, id, opts),
      activate() {}, deactivate() {}, changed() {}, quarantine() {},
    }, reply: (frame) => replies.push(frame), broadcast() {}, rebuild: async () => {},
  };
  const url = 'https://github.com/psjamesh/agent-wrangler-logins.git';
  const install = async () => {
    replies.length = 0;
    await extInstallHandler.handler({ type: 'ext-install', url }, ctx);
    const disclosure = replies.find((f) => f.type === 'ext-install-disclosure');
    assert.ok(disclosure);
    assert.equal(disclosure.id, 'logins');
    assert.deepEqual(disclosure.capabilities, extension.requires);
    const { readDeclaration } = await hostModule('server/extensions/install.js');
    assert.equal(readDeclaration(source).range, '^1.54.0');
    await extConsentHandler.handler({ type: 'ext-consent', tempId: disclosure.tempId, approve: true }, ctx);
    assert.equal(replies.find((f) => f.type === 'ext-install-done')?.installed, true);
  };
  await install();
  const { default: installed } = await import(pathToFileURL(path.join(externalDir(), 'logins', 'index.js')));
  const store = installed.stores.logins(); store.add('Retained'); const claudeDir = store.setUpClaude('retained'); store.bind('retained-card', 'retained');
  fs.writeFileSync(store.claudeTokenPath('retained'), 'fixture-private', { mode: 0o600 });
  const assertPreserved = () => {
    assert.equal(new LoginStore().loginFor('retained-card'), 'retained');
    assert.equal(new LoginStore().claudeDir('retained'), claudeDir);
    assert.equal(fs.statSync(claudeDir).mode & 0o777, 0o700);
    assert.equal(fs.readFileSync(store.claudeTokenPath('retained'), 'utf8'), 'fixture-private');
  };
  await install(); assertPreserved();
  await extUninstallHandler.handler({ type: 'ext-uninstall', id: 'logins' }, ctx);
  assert.equal(fs.existsSync(path.join(externalDir(), 'logins')), false);
  assert.equal(readProvenance().logins, undefined); assertPreserved();
  await install(); assertPreserved();
  await extUninstallHandler.handler({ type: 'ext-uninstall', id: 'logins' }, ctx);
});

test('Claude settings in the real host launch folder refuse dispatch, resume and fork by name', async (t) => {
  const { sm, api, store, commands, root } = fixture(t);
  const settings = path.join(root, '.claude', 'settings.local.json');
  const named = new RegExp(`login "Personal": Claude settings ${settings.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} set ANTHROPIC_BASE_URL in env`);
  fs.mkdirSync(path.dirname(settings));
  fs.writeFileSync(settings, JSON.stringify({ env: { ANTHROPIC_BASE_URL: 'http://fixture-private' } }));
  await assert.rejects(api.sessions.spawn({ cwd: root, intent: 'fixture', agent: 'claude', ext: { logins: { login: 'personal' } } }), named);
  assert.equal(commands.length, 0);
  fs.rmSync(settings);
  const card = await api.sessions.spawn({ cwd: root, intent: 'fixture', agent: 'claude', ext: { logins: { login: 'personal' } } });
  const liveId = `${card.sessionId}-live`;
  sm.map.get(card.sessionId).liveSessionId = liveId;
  const bucket = path.join(home, '.claude', 'projects', card.sessionId);
  fs.mkdirSync(bucket, { recursive: true });
  fs.writeFileSync(path.join(bucket, `${liveId}.jsonl`), JSON.stringify({ cwd: root }) + '\n');
  fs.writeFileSync(settings, JSON.stringify({ env: { ANTHROPIC_BASE_URL: 'http://fixture-private' } }));
  await assert.rejects(sm.resume(card.sessionId, root), named);
  await assert.rejects(sm.fork({ sourceId: liveId, parentId: card.sessionId, parentEntry: sm.entryFor(card.sessionId), cwd: root }), named);
  assert.equal(commands.length, 1);
  assert.equal(store.loginFor(card.sessionId), 'personal');
});

test('pane shell: an auth override set by the pane shell refuses the real host launch before claude runs', async (t) => {
  const { api, commands, root } = fixture(t);
  await api.sessions.spawn({ cwd: root, intent: 'fixture', agent: 'claude', ext: { logins: { login: 'personal' } } });
  const bin = path.join(root, 'bin'); const marker = path.join(root, 'claude-ran');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'claude'), `#!/bin/sh\necho ran > '${marker}'\n`, { mode: 0o755 });
  const { spawnSync } = await import('node:child_process');
  const base = { PATH: `${bin}:/usr/bin:/bin`, HOME: root };
  const run = (shell, env) => {
    fs.rmSync(marker, { force: true });
    const out = spawnSync(shell, ['-c', commands[0]], { cwd: root, env: { ...base, ...env }, encoding: 'utf8' });
    return { status: out.status, stderr: out.stderr, ran: fs.existsSync(marker) };
  };
  assert.deepEqual(run('/bin/sh', {}), { status: 0, stderr: '', ran: true });
  for (const [name, value] of [['CLAUDE_SECURESTORAGE_CONFIG_DIR', ''], ['ANTHROPIC_API_KEY', 'fixture-private'], ['CLAUDE_CODE_USE_MANTLE', '1'], ['CLAUDE_CODE_MANAGED_SETTINGS_PATH', root]]) {
    const refused = run('/bin/sh', { [name]: value });
    assert.equal(refused.status, 1, name);
    assert.equal(refused.ran, false, name);
    assert.match(refused.stderr, new RegExp(`refused this launch: ${name} is set`));
    assert.ok(!refused.stderr.includes('fixture-private'));
  }
  const zdotdir = path.join(root, 'zdot'); fs.mkdirSync(zdotdir);
  fs.writeFileSync(path.join(zdotdir, '.zshenv'), 'export ANTHROPIC_BASE_URL=http://fixture-private\n');
  const zsh = run('/bin/zsh', { ZDOTDIR: zdotdir });
  assert.equal(zsh.status, 1);
  assert.equal(zsh.ran, false);
  assert.match(zsh.stderr, /refused this launch: ANTHROPIC_BASE_URL is set in the pane environment/);
  fs.writeFileSync(path.join(zdotdir, '.zshenv'), '');
  assert.equal(run('/bin/zsh', { ZDOTDIR: zdotdir }).ran, true);
});
