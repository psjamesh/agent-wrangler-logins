import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LoginStore } from './login-store.js';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-logins-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return new LoginStore(root);
}

test('slug names, duplicate slugs, fresh providers and safe paths', (t) => {
  const s = fixture(t);
  assert.equal(s.slugFor('Personal '), 'personal');
  assert.equal(s.slugFor('Side  Project!'), 'side-project');
  assert.throws(() => s.slugFor(''), /A login needs a name/);
  assert.deepEqual(s.add('Personal'), { slug: 'personal', label: 'Personal' });
  assert.throws(() => s.add('personal'), { message: 'A login called "personal" already exists' });
  assert.deepEqual(s.list()[0].claude, { present: false, plaintext: false, oldToken: false });
  assert.deepEqual(s.list()[0].codex, { present: false, oldAuth: false });
  for (const slug of ['../escape', '/tmp/escape', '', '__proto__']) assert.throws(() => s.dir(slug));
});

test('Claude setup makes one canonical, stable config dir per login', (t) => {
  const s = fixture(t); s.add('Personal'); s.add('Other');
  assert.equal(s.claudeDir('personal'), null);
  const dir = s.setUpClaude('personal');
  assert.equal(dir, fs.realpathSync(dir));
  assert.ok(dir.startsWith(fs.realpathSync(s.dir('personal')) + path.sep));
  assert.equal(fs.statSync(dir).mode & 0o777, 0o700);
  assert.equal(s.setUpClaude('personal'), dir);
  assert.equal(new LoginStore(s.root).claudeDir('personal'), dir);
  assert.notEqual(s.setUpClaude('other'), dir);
  assert.deepEqual(s.get('personal').claude, { present: true, plaintext: false, oldToken: false });
  fs.writeFileSync(path.join(dir, '.credentials.json'), 'fixture-private');
  assert.equal(s.get('personal').claude.plaintext, true);
  assert.ok(!JSON.stringify(s.snapshot()).includes(dir));
});

test('a symlinked data dir resolves to the same canonical Claude dir', (t) => {
  const real = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-logins-real-'));
  const link = `${real}-link`;
  fs.symlinkSync(real, link);
  t.after(() => { fs.unlinkSync(link); fs.rmSync(real, { recursive: true, force: true }); });
  const viaLink = new LoginStore(link); viaLink.add('Personal');
  const dir = viaLink.setUpClaude('personal');
  assert.ok(dir.startsWith(fs.realpathSync(real)));
  assert.equal(new LoginStore(real).claudeDir('personal'), dir);
  assert.equal(new LoginStore(real).setUpClaude('personal'), dir);
});

test('forgetting Claude removes only its config dir, keeps the old token file and the default folder, and a new setup gets a new dir', (t) => {
  const s = fixture(t); s.add('Personal');
  fs.writeFileSync(s.claudeTokenPath('personal'), 'fixture-private', { mode: 0o600 });
  const shared = path.join(process.env.CLAUDE_CONFIG_DIR, 'projects', 'kept.jsonl');
  fs.writeFileSync(shared, '{}');
  const dir = s.setUpClaude('personal');
  assert.equal(s.get('personal').claude.oldToken, true);
  s.forget('personal', 'claude');
  assert.equal(fs.existsSync(dir), false);
  assert.equal(fs.existsSync(shared), true);
  assert.equal(fs.readFileSync(s.claudeTokenPath('personal'), 'utf8'), 'fixture-private');
  assert.deepEqual(s.get('personal').claude, { present: false, plaintext: false, oldToken: true });
  const next = s.setUpClaude('personal');
  assert.notEqual(next, dir);
  s.remove('personal');
  assert.equal(fs.existsSync(next), false);
  assert.equal(fs.existsSync(shared), true);
});

test('a Claude config entry replaced by a link is refused and never followed by Forget', (t) => {
  const s = fixture(t); s.add('Personal');
  const dir = s.setUpClaude('personal');
  const keep = path.join(process.env.CLAUDE_CONFIG_DIR, 'keep.txt'); fs.writeFileSync(keep, 'fixture');
  t.after(() => fs.rmSync(keep, { force: true }));
  fs.rmSync(dir, { recursive: true });
  fs.symlinkSync(process.env.CLAUDE_CONFIG_DIR, dir);
  assert.throws(() => s.claudeDir('personal'), /not a directory/);
  assert.throws(() => s.forget('personal', 'claude'), /not a directory/);
  assert.equal(fs.readFileSync(keep, 'utf8'), 'fixture');
  fs.unlinkSync(dir);
});

test('setup refuses when the default folder cannot provide required links or readable settings', (t) => {
  const s = fixture(t); s.add('Personal');
  const settings = path.join(process.env.CLAUDE_CONFIG_DIR, 'settings.json');
  fs.writeFileSync(settings, '{broken');
  t.after(() => fs.rmSync(settings, { force: true }));
  assert.throws(() => s.setUpClaude('personal'), /Cannot read .*settings\.json/);
  assert.deepEqual(fs.readdirSync(s.dir('personal')), ['login.json']);
  fs.rmSync(settings);
  const sessions = path.join(process.env.CLAUDE_CONFIG_DIR, 'sessions');
  fs.renameSync(sessions, `${sessions}.moved`);
  t.after(() => fs.renameSync(`${sessions}.moved`, sessions));
  assert.throws(() => s.setUpClaude('personal'), /Claude sessions cannot be shared/);
});

test('Codex setup makes one fresh, canonical, stable home per login that mirrors the default config', (t) => {
  const s = fixture(t); s.add('Personal'); s.add('Other');
  fs.writeFileSync(path.join(process.env.CODEX_HOME, 'config.toml'), 'fixture');
  assert.equal(s.codexDir('personal'), null);
  const dir = s.setUpCodex('personal');
  assert.equal(dir, fs.realpathSync(dir));
  assert.match(path.basename(dir), /^codex-[0-9a-f]{16}$/);
  assert.notEqual(dir, fs.realpathSync(s.dir('personal')) + path.sep + 'codex-home');
  assert.equal(fs.statSync(dir).mode & 0o777, 0o700);
  assert.equal(s.setUpCodex('personal'), dir);
  assert.equal(new LoginStore(s.root).codexDir('personal'), dir);
  assert.notEqual(s.setUpCodex('other'), dir);
  assert.equal(fs.readlinkSync(path.join(dir, 'config.toml')), path.join(process.env.CODEX_HOME, 'config.toml'));
  assert.equal(fs.existsSync(path.join(dir, 'auth.json')), false);
  assert.deepEqual(s.get('personal').codex, { present: true, oldAuth: false });
  assert.ok(!JSON.stringify(s.snapshot()).includes(dir));
});

test('an earlier codex-home auth.json is reported by existence only and survives setup, forget and a new setup', (t) => {
  const s = fixture(t); s.add('Personal');
  const old = path.join(s.oldCodexHome('personal'), 'auth.json');
  fs.mkdirSync(path.dirname(old)); fs.writeFileSync(old, 'fixture-private', { mode: 0o000 });
  assert.deepEqual(s.get('personal').codex, { present: false, oldAuth: true });
  const dir = s.setUpCodex('personal');
  assert.notEqual(dir, fs.realpathSync(s.oldCodexHome('personal')));
  assert.deepEqual(s.get('personal').codex, { present: true, oldAuth: true });
  assert.ok(!JSON.stringify(s.snapshot()).includes('fixture-private'));
  const shared = path.join(process.env.CODEX_HOME, 'config.toml');
  fs.writeFileSync(shared, 'fixture');
  s.forget('personal', 'codex');
  assert.equal(fs.existsSync(dir), false);
  assert.deepEqual(s.get('personal').codex, { present: false, oldAuth: true });
  assert.equal(fs.readFileSync(shared, 'utf8'), 'fixture');
  const next = s.setUpCodex('personal');
  assert.notEqual(next, dir);
  assert.equal(fs.readlinkSync(path.join(next, 'config.toml')), shared);
  fs.chmodSync(old, 0o600);
  assert.equal(fs.readFileSync(old, 'utf8'), 'fixture-private');
  s.remove('personal');
  assert.equal(fs.existsSync(next), false);
  assert.equal(fs.readFileSync(shared, 'utf8'), 'fixture');
});

test('a Codex home replaced by a link is refused and never followed by Forget', (t) => {
  const s = fixture(t); s.add('Personal');
  const dir = s.setUpCodex('personal');
  const keep = path.join(process.env.CODEX_HOME, 'keep.txt'); fs.writeFileSync(keep, 'fixture');
  t.after(() => fs.rmSync(keep, { force: true }));
  fs.rmSync(dir, { recursive: true });
  fs.symlinkSync(process.env.CODEX_HOME, dir);
  assert.throws(() => s.codexDir('personal'), /Codex home is not a directory/);
  assert.throws(() => s.forget('personal', 'codex'), /not a directory/);
  assert.equal(fs.readFileSync(keep, 'utf8'), 'fixture');
  fs.unlinkSync(dir);
});

test('bindings persist; removal retains a named tombstone until purge', (t) => {
  const s = fixture(t); s.add('Personal'); s.bind('card', 'personal');
  const reload = new LoginStore(s.root);
  assert.equal(reload.loginFor('card'), 'personal');
  s.remove('personal');
  assert.equal(fs.existsSync(s.dir('personal')), false);
  assert.equal(reload.loginFor('card'), 'personal');
  assert.equal(s.get('personal'), null);
  assert.equal(s.labelFor('personal'), 'Personal');
  assert.throws(() => s.add('Personal'), /already exists/);
  s.unbind('card');
  assert.equal(reload.loginFor('card'), null);
  assert.deepEqual(s.snapshot(), { logins: [], sessions: {} });
  assert.deepEqual(s.add('Personal'), { slug: 'personal', label: 'Personal' });
});

test('corrupt bindings throw rather than becoming Default', (t) => {
  const s = fixture(t);
  fs.writeFileSync(path.join(s.root, 'sessions.json'), '{broken');
  assert.throws(() => s.loginFor('card'));
});

test('default storage expands AW_DATA_DIR and survives new store instances', (t) => {
  const previous = process.env.AW_DATA_DIR;
  t.after(() => { process.env.AW_DATA_DIR = previous; });
  process.env.AW_DATA_DIR = '~/isolated-wrangler';
  const store = new LoginStore();
  assert.equal(store.root, path.join(os.homedir(), 'isolated-wrangler', 'logins'));
  store.add('Portable'); store.bind('portable-card', 'portable');
  assert.equal(new LoginStore().loginFor('portable-card'), 'portable');
});

test('private atomic writes replace files without leftover temporary files', async (t) => {
  const s = fixture(t);
  const { writeJsonAtomic } = await import('./persistence.js');
  const file = path.join(s.root, 'state.json');
  writeJsonAtomic(file, { first: true });
  writeJsonAtomic(file, { second: true });
  assert.deepEqual(JSON.parse(fs.readFileSync(file)), { second: true });
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.deepEqual(fs.readdirSync(s.root), ['state.json']);
});

test('malformed metadata cannot be forwarded as arbitrary Settings data', (t) => {
  const s = fixture(t); s.add('Personal');
  fs.writeFileSync(path.join(s.dir('personal'), 'login.json'), JSON.stringify({ label: { secret: 'fixture-private' } }));
  assert.throws(() => s.list(), /Invalid login metadata/);
  fs.writeFileSync(path.join(s.dir('personal'), 'login.json'), JSON.stringify({ label: 'Personal', claudeDir: '../../escape' }));
  assert.throws(() => s.list(), /Invalid login metadata/);
  for (const codexDir of ['../../escape', 'codex-home', 'claude-0123456789abcdef']) {
    fs.writeFileSync(path.join(s.dir('personal'), 'login.json'), JSON.stringify({ label: 'Personal', codexDir }));
    assert.throws(() => s.list(), /Invalid login metadata/);
  }
  fs.writeFileSync(path.join(s.dir('personal'), 'login.json'), JSON.stringify({ label: 'Personal' }));
  fs.writeFileSync(path.join(s.root, 'removed.json'), JSON.stringify({ personal: { secret: 'fixture-private' } }));
  assert.throws(() => s.snapshot(), /Invalid login/);
});
